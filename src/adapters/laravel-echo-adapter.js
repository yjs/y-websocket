/**
 * @module adapters/laravel-echo-adapter
 */

import { BaseAdapter } from './base-adapter.js'
import { base64ToUint8Array, uint8ArrayToBase64 } from '../utils/base64.js'

// Message chunking configuration
const CHUNK_SIZE = 10 * 1000 // ~9.5kb in bytes

// YJS protocol message types (first byte of message)
const YJS_MESSAGE_TYPE = {
  SYNC: 0,
  AWARENESS: 1,
  AUTH: 2,
  QUERY_AWARENESS: 3
}

/**
 * Generate a unique ID for message fragments
 * Simple nanoid-like implementation
 * @return {string} Random ID
 */
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

/**
 * Laravel Echo adapter that handles real-time collaboration through Laravel Echo
 * presence channels with message chunking support.
 */
export class LaravelEchoAdapter extends BaseAdapter {
  /**
   * @param {Object} echo - Laravel Echo instance
   * @param {string} channelName - Name of the Echo presence channel
   * @param {Object} options - Configuration options
   * @param {string} [options.messageEvent='yjs-message'] - Event name for sync messages
   * @param {string} [options.awarenessEvent='yjs-awareness'] - Event name for awareness messages
   * @param {Function} [options.onHere=null] - Callback when receiving initial users list
   * @param {Function} [options.onJoining=null] - Callback when a user joins
   * @param {Function} [options.onLeaving=null] - Callback when a user leaves
   */
  constructor (
    echo,
    channelName,
    options = {}
  ) {
    const {
      messageEvent = 'yjs-message',
      awarenessEvent = 'yjs-awareness',
      onHere = null,
      onJoining = null,
      onLeaving = null
    } = options
    super()
    this.echo = echo
    this.channelName = channelName
    this.messageEvent = messageEvent
    this.awarenessEvent = awarenessEvent
    this.onHereCallback = onHere
    this.onJoiningCallback = onJoining
    this.onLeavingCallback = onLeaving
    this.channel = null
    /** @type {number} */
    this._readyState = BaseAdapter.CLOSED
    this.usersInChannel = new Set()
    this.chunkBuffers = new Map()
    this.chunkMetadata = new Map()
    this.sendQueue = []
    this.sendInterval = 25 // 25ms between sends (40 messages/sec max)
    this.isSending = false

    // Retry config
    this.maxSendRetries = 5
    this.baseRetryDelayMs = 250
    this.maxRetryDelayMs = 2000
  }

  /**
   * Check if a message is an awareness message based on YJS protocol
   * @param {Uint8Array} uint8Array - Message data
   * @return {boolean} True if awareness message
   * @private
   */
  _isAwarenessMessage (uint8Array) {
    const messageType = uint8Array.length > 0 ? uint8Array[0] : 0
    return messageType === YJS_MESSAGE_TYPE.AWARENESS || messageType === YJS_MESSAGE_TYPE.QUERY_AWARENESS
  }

  /**
   * Create a fragment message object
   * @param {string} id - Unique message ID
   * @param {number} index - Fragment index
   * @param {number} total - Total number of fragments
   * @param {string} data - Base64 encoded fragment data
   * @return {Object} Fragment message
   * @private
   */
  _createFragmentMessage (id, index, total, data) {
    return { id, index, total, data }
  }

  /**
   * Split a large message into fragments and queue for sending
   * @param {string} base64Data - Base64 encoded message data
   * @param {string} eventName - Event name to use when sending
   * @private
   */
  _sendAsFragments (base64Data, eventName) {
    const id = generateId()
    const total = Math.max(1, Math.ceil(base64Data.length / CHUNK_SIZE))
    for (let index = 0; index < total; index++) {
      const start = index * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, base64Data.length)
      const chunkData = base64Data.substring(start, end)
      const message = this._createFragmentMessage(id, index, total, chunkData)
      this.sendQueue.push({ data: JSON.stringify(message), eventName, attempts: 0 })
    }
    this._processSendQueue()
  }

  /**
   * Retry a failed send with exponential backoff
   * @param {Object} item - Queue item to retry
   * @param {*} error - Error that caused the retry
   * @private
   */
  _retrySend (item, error) {
    if (item.attempts >= this.maxSendRetries) {
      console.error('Max send retries reached. Dropping fragment.', { error })
      if (this.onerror) {
        // @ts-ignore - Creating error event
        this.onerror({ type: 'error', error: error || new Error('Max retries reached') })
      }
      return
    }

    const nextAttempts = item.attempts + 1
    const delay = Math.min(this.baseRetryDelayMs * Math.pow(2, item.attempts), this.maxRetryDelayMs)

    setTimeout(() => {
      // Put it back at the front so it goes out next
      this.sendQueue.unshift({ ...item, attempts: nextAttempts })
      this._processSendQueue()
    }, delay)
  }

  /**
   * Process the send queue with rate limiting
   * @private
   */
  _processSendQueue () {
    if (this.isSending || this.sendQueue.length === 0 || !this.channel) {
      return
    }

    this.isSending = true
    const item = this.sendQueue.shift()

    if (item) {
      try {
        // If Echo whisper doesn't support callback, it will be ignored
        this.channel.whisper(item.eventName, JSON.parse(item.data), (error) => {
          if (error) {
            // Release the lock and retry this item
            this.isSending = false
            this._retrySend(item, error)
            return
          }
        })
      } catch (error) {
        console.error('Error sending message fragment:', error)
        // Release the lock and retry this item
        this.isSending = false
        this._retrySend(item, error)
        if (this.onerror) {
          // @ts-ignore - Creating error event
          this.onerror({ type: 'error', error })
        }
        return
      }
    }

    setTimeout(() => {
      this.isSending = false
      if (this.sendQueue.length > 0) {
        this._processSendQueue()
      }
    }, this.sendInterval)
  }

  /**
   * Store a received fragment
   * @param {string} id - Message ID
   * @param {number} index - Fragment index
   * @param {number} total - Total fragments
   * @param {string} data - Fragment data
   * @private
   */
  _storeFragment (id, index, total, data) {
    if (!this.chunkBuffers.has(id)) {
      this.chunkBuffers.set(id, new Map())
      this.chunkMetadata.set(id, { total, received: 0 })
    }
    const fragments = this.chunkBuffers.get(id)
    const meta = this.chunkMetadata.get(id)
    if (!fragments.has(index)) {
      fragments.set(index, data)
      meta.received++
    }
  }

  /**
   * Try to reassemble a complete message from fragments
   * @param {string} id - Message ID
   * @return {Uint8Array|null} Reassembled message or null if incomplete
   * @private
   */
  _tryReassemble (id) {
    const fragments = this.chunkBuffers.get(id)
    const meta = this.chunkMetadata.get(id)
    if (!fragments || !meta || meta.received !== meta.total) return null

    let joined = ''
    for (let i = 0; i < meta.total; i++) joined += fragments.get(i) || ''

    this.chunkBuffers.delete(id)
    this.chunkMetadata.delete(id)

    return base64ToUint8Array(joined)
  }

  /**
   * Process an incoming fragment message
   * @param {Object} event - Fragment message event
   * @return {Uint8Array|null} Complete message if reassembled, null otherwise
   * @private
   */
  _processIncomingMessage (event) {
    if (!event) {
      return null
    }

    const { id, index, total, data } = event
    this._storeFragment(id, index, total, data)
    return this._tryReassemble(id)
  }

  /**
   * Connect to the Laravel Echo channel
   * @param {string} _url - Not used for Echo adapter
   * @param {Array<string>} _protocols - Not used for Echo adapter
   */
  connect (_url, _protocols) {
    this._readyState = BaseAdapter.CONNECTING

    try {
      this.channel = this.echo.join(this.channelName)

      this.channel.here((users) => {
        this._readyState = BaseAdapter.OPEN
        this.usersInChannel.clear()
        users.forEach((user) => this.usersInChannel.add(user.id))
        if (this.onHereCallback) this.onHereCallback(users)
        // @ts-ignore - Creating open event
        if (this.onopen) this.onopen({ type: 'open', users })
      })

      this.channel.error((error) => {
        this._readyState = BaseAdapter.CLOSED
        // @ts-ignore - Creating error event
        if (this.onerror) this.onerror({ type: 'error', error })
      })

      this.channel.listenForWhisper(this.messageEvent, (event) => {
        if (this.onmessage && event) {
          const data = this._processIncomingMessage(event)
          // @ts-ignore - Creating message event
          if (data) this.onmessage({ type: 'message', data: data.buffer })
        }
      })

      this.channel.listenForWhisper(this.awarenessEvent, (event) => {
        if (this.onmessage && event) {
          const data = this._processIncomingMessage(event)
          // @ts-ignore - Creating message event
          if (data) this.onmessage({ type: 'message', data: data.buffer })
        }
      })

      this.channel.joining((user) => {
        this.usersInChannel.add(user.id)
        if (this.onJoiningCallback) this.onJoiningCallback(user)
      })

      this.channel.leaving((user) => {
        this.usersInChannel.delete(user.id)
        if (this.onLeavingCallback) this.onLeavingCallback(user)
      })
    } catch (error) {
      this._readyState = BaseAdapter.CLOSED
      // @ts-ignore - Creating error event
      if (this.onerror) this.onerror({ type: 'error', error })
    }
  }

  /**
   * Send data through the Laravel Echo channel
   * @param {Uint8Array | ArrayBuffer} data - Binary data to send
   */
  send (data) {
    if (!this._canSend()) return
    try {
      const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data)
      const base64Data = uint8ArrayToBase64(uint8Array)
      const eventName = this._isAwarenessMessage(uint8Array) ? this.awarenessEvent : this.messageEvent
      this._sendAsFragments(base64Data, eventName)
    } catch (error) {
      // @ts-ignore - Creating error event
      if (this.onerror) this.onerror({ type: 'error', error })
    }
  }

  /**
   * Check if the adapter can send messages
   * @return {boolean} True if ready to send
   * @private
   */
  _canSend () {
    return this._readyState === BaseAdapter.OPEN && this.channel !== null && this.usersInChannel.size > 1
  }

  /**
   * Close the connection and clean up
   */
  close () {
    if (this.channel) {
      this.echo.leave(this.channelName)
      this.channel = null
    }
    this.sendQueue = []
    this.isSending = false
    this._readyState = BaseAdapter.CLOSED
    // @ts-ignore - Creating close event
    if (this.onclose) this.onclose({ type: 'close' })
  }

  /**
   * Get the current connection state
   * @return {number} Connection state
   */
  get readyState () {
    return this._readyState
  }
}
