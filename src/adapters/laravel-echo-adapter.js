/**
 * @module adapters/laravel-echo-adapter
 */

import { BaseAdapter } from './base-adapter.js'

/**
 * Laravel Echo adapter using Presence Channels for real-time communication.
 *
 * This adapter allows y-websocket to work with Laravel's broadcasting system
 * through Laravel Echo and Presence Channels.
 *
 * @example
 * import Echo from 'laravel-echo'
 * import Pusher from 'pusher-js'
 * import * as Y from 'yjs'
 * import { WebsocketProvider } from '@y/websocket'
 * import { LaravelEchoAdapter } from '@y/websocket/adapters/laravel-echo-adapter'
 *
 * window.Pusher = Pusher
 *
 * const echo = new Echo({
 *   broadcaster: 'pusher',
 *   key: process.env.PUSHER_APP_KEY,
 *   cluster: process.env.PUSHER_APP_CLUSTER,
 *   forceTLS: true
 * })
 *
 * const doc = new Y.Doc()
 * const adapter = new LaravelEchoAdapter(echo, 'document-room')
 * const provider = new WebsocketProvider(null, null, doc, {
 *   adapter: adapter
 * })
 */
export class LaravelEchoAdapter extends BaseAdapter {
  /**
   * @param {any} echo - Laravel Echo instance
   * @param {string} channelName - Presence channel name (e.g., 'document.123')
   * @param {object} [options] - Additional options
   * @param {string} [options.messageEvent] - Event name for messages (default: 'yjs-message')
   * @param {string} [options.awarenessEvent] - Event name for awareness updates (default: 'yjs-awareness')
   */
  constructor (echo, channelName, { messageEvent = 'yjs-message', awarenessEvent = 'yjs-awareness' } = {}) {
    super()
    this.echo = echo
    this.channelName = channelName
    this.messageEvent = messageEvent
    this.awarenessEvent = awarenessEvent
    this.channel = null
    this._readyState = BaseAdapter.CLOSED
    this._listeners = new Map()
  }

  /**
   * Connect to the Laravel Echo presence channel
   * @param {string} _url - Not used for Echo adapter (uses channelName from constructor)
   * @param {Array<string>} _protocols - Not used for Echo adapter
   */
  connect (_url, _protocols) {
    this._readyState = BaseAdapter.CONNECTING

    try {
      // Join the presence channel
      this.channel = this.echo.join(this.channelName)

      // Handle successful connection
      this.channel.here((users) => {
        this._readyState = BaseAdapter.OPEN
        if (this.onopen) {
          this.onopen({ type: 'open', users })
        }
      })

      // Handle errors
      this.channel.error((error) => {
        this._readyState = BaseAdapter.CLOSED
        if (this.onerror) {
          this.onerror({ type: 'error', error })
        }
      })

      // Listen for Yjs sync messages
      this.channel.listen(`.${this.messageEvent}`, (event) => {
        if (this.onmessage && event.data) {
          // Convert base64 string back to Uint8Array
          const data = this._base64ToUint8Array(event.data)
          this.onmessage({ type: 'message', data: data.buffer })
        }
      })

      // Listen for awareness updates
      this.channel.listen(`.${this.awarenessEvent}`, (event) => {
        if (this.onmessage && event.data) {
          // Convert base64 string back to Uint8Array
          const data = this._base64ToUint8Array(event.data)
          this.onmessage({ type: 'message', data: data.buffer })
        }
      })

      // Handle user joining
      this.channel.joining((user) => {
        // User joined - awareness will be handled via events
      })

      // Handle user leaving
      this.channel.leaving((user) => {
        // User left - awareness will be handled via events
      })
    } catch (error) {
      this._readyState = BaseAdapter.CLOSED
      if (this.onerror) {
        this.onerror({ type: 'error', error })
      }
    }
  }

  /**
   * Send data through the Laravel Echo channel
   * @param {Uint8Array | ArrayBuffer} data - Binary data to send
   */
  send (data) {
    if (this._readyState !== BaseAdapter.OPEN || !this.channel) {
      return
    }

    try {
      // Convert binary data to base64 for transmission
      const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data)
      const base64 = this._uint8ArrayToBase64(uint8Array)

      // Use whisper to send to other users in the presence channel
      // Note: This requires Laravel backend to broadcast the message
      this.channel.whisper(this.messageEvent, { data: base64 })
    } catch (error) {
      if (this.onerror) {
        this.onerror({ type: 'error', error })
      }
    }
  }

  /**
   * Close the connection
   */
  close () {
    if (this.channel) {
      this.echo.leave(this.channelName)
      this.channel = null
    }
    this._readyState = BaseAdapter.CLOSED
    if (this.onclose) {
      this.onclose({ type: 'close' })
    }
  }

  /**
   * Get the current connection state
   * @return {number} Connection state
   */
  get readyState () {
    return this._readyState
  }

  /**
   * Convert Uint8Array to base64 string
   * @private
   * @param {Uint8Array} bytes
   * @return {string}
   */
  _uint8ArrayToBase64 (bytes) {
    let binary = ''
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Convert base64 string to Uint8Array
   * @private
   * @param {string} base64
   * @return {Uint8Array}
   */
  _base64ToUint8Array (base64) {
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}
