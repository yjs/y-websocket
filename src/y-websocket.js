/**
 * @module provider/websocket
 */

/* eslint-env browser */
import * as Y from '@y/y' // eslint-disable-line
import * as bc from 'lib0/broadcastchannel'
import * as time from 'lib0/time'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from '@y/protocols/sync'
import * as authProtocol from '@y/protocols/auth'
import * as awarenessProtocol from '@y/protocols/awareness'
import { ObservableV2 } from 'lib0/observable'
import * as math from 'lib0/math'
import * as url from 'lib0/url'
import * as env from 'lib0/environment'
import * as array from 'lib0/array'

export const messageSync = 0
export const messageQueryAwareness = 3
export const messageAwareness = 1
export const messageAuth = 2

/**
 *                       encoder,          decoder,          provider,          emitSynced, messageType
 * @type {Array<function(encoding.Encoder, decoding.Decoder, WebsocketProvider, boolean,    number):void>}
 */
const messageHandlers = []

messageHandlers[messageSync] = (
  encoder,
  decoder,
  provider,
  emitSynced,
  _messageType
) => {
  encoding.writeVarUint(encoder, messageSync)
  const readSyncPos = decoder.pos
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    provider.doc,
    provider
  )
  if (
    emitSynced && syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider.synced
  ) {
    provider.synced = true
  }
  // update unconfirmedUpdates
  if (syncMessageType === 1 || syncMessageType === 2) {
    const subdecoder = decoding.createDecoder(decoder.arr)
    subdecoder.pos = readSyncPos
    decoding.readVarUint(subdecoder) // === syncMessageType
    const update = decoding.readVarUint8Array(subdecoder)
    const receivedIds = Y.createContentIdsFromUpdate(update)
    const unconfirmedOldLen = provider.unconfirmedUpdates.length
    provider.unconfirmedUpdates = provider.unconfirmedUpdates.filter(unconfirmed => {
      unconfirmed.ids = Y.excludeContentIds(unconfirmed.ids, receivedIds)
      return !unconfirmed.ids.inserts.isEmpty() || !unconfirmed.ids.deletes.isEmpty()
    })
    emitSyncStatusEvent(provider)
  }
}

messageHandlers[messageQueryAwareness] = (
  encoder,
  _decoder,
  provider,
  _emitSynced,
  _messageType
) => {
  encoding.writeVarUint(encoder, messageAwareness)
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      provider.awareness,
      Array.from(provider.awareness.getStates().keys())
    )
  )
}

messageHandlers[messageAwareness] = (
  _encoder,
  decoder,
  provider,
  _emitSynced,
  _messageType
) => {
  awarenessProtocol.applyAwarenessUpdate(
    provider.awareness,
    decoding.readVarUint8Array(decoder),
    provider
  )
}

messageHandlers[messageAuth] = (
  _encoder,
  decoder,
  provider,
  _emitSynced,
  _messageType
) => {
  authProtocol.readAuthMessage(
    decoder,
    provider.doc,
    (_ydoc, reason) => permissionDeniedHandler(provider, reason)
  )
}

/**
 * @param {WebsocketProvider} provider
 * @param {string} reason
 */
const permissionDeniedHandler = (provider, reason) =>
  console.warn(`Permission denied to access ${provider.url}.\n${reason}`)

/**
 * @param {WebsocketProvider} provider
 * @param {Uint8Array} buf
 * @param {boolean} emitSynced
 * @return {encoding.Encoder}
 */
const readMessage = (provider, buf, emitSynced) => {
  const decoder = decoding.createDecoder(buf)
  const encoder = encoding.createEncoder()
  const messageType = decoding.readVarUint(decoder)
  const messageHandler = provider.messageHandlers[messageType]
  if (/** @type {any} */ (messageHandler)) {
    messageHandler(encoder, decoder, provider, emitSynced, messageType)
  } else {
    console.error('Unable to compute message')
  }
  return encoder
}

/**
 * Outsource this function so that a new websocket connection is created immediately.
 * I suspect that the `ws.onclose` event is not always fired if there are network issues.
 *
 * @param {WebsocketProvider} provider
 * @param {WebSocket} ws
 * @param {CloseEvent | null} event
 */
const closeWebsocketConnection = (provider, ws, event) => {
  if (ws === provider.ws) {
    provider.emit('connection-close', [event, provider])
    provider.ws = null
    ws.close()
    provider.wsconnecting = false
    if (provider.wsconnected) {
      provider.wsconnected = false
      provider.synced = false
      // update awareness (all users except local left)
      awarenessProtocol.removeAwarenessStates(
        provider.awareness,
        Array.from(provider.awareness.getStates().keys()).filter((client) =>
          client !== provider.awareness.clientID
        ),
        provider
      )
      provider.emit('status', [{
        status: 'disconnected'
      }])
      emitSyncStatusEvent(provider)
    } else {
      provider.wsUnsuccessfulReconnects++
    }
    // Start with no reconnect timeout and increase timeout by
    // using exponential backoff starting with 100ms
    setTimeout(
      setupWS,
      math.min(
        math.pow(2, provider.wsUnsuccessfulReconnects) * 100,
        provider.maxBackoffTime
      ),
      provider
    )
  }
}

/**
 * @param {WebsocketProvider} provider
 */
const setupWS = (provider) => {
  if (provider.shouldConnect && provider.ws === null) {
    const websocket = new provider._WS(provider.url, provider.protocols)
    websocket.binaryType = 'arraybuffer'
    provider.ws = websocket
    provider.wsconnecting = true
    provider.wsconnected = false
    provider.synced = false

    websocket.onmessage = (event) => {
      provider.wsLastMessageReceived = time.getUnixTime()
      const encoder = readMessage(provider, new Uint8Array(event.data), true)
      if (encoding.length(encoder) > 1) {
        websocket.send(encoding.toUint8Array(encoder))
      }
    }
    websocket.onerror = (event) => {
      provider.emit('connection-error', [event, provider])
    }
    websocket.onclose = (event) => {
      closeWebsocketConnection(provider, websocket, event)
    }
    websocket.onopen = () => {
      provider.wsLastMessageReceived = time.getUnixTime()
      provider.wsconnecting = false
      provider.wsconnected = true
      provider.wsUnsuccessfulReconnects = 0
      provider.emit('status', [{
        status: 'connected'
      }])
      // always send sync step 1 when connected
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeSyncStep1(encoder, provider.doc)
      websocket.send(encoding.toUint8Array(encoder))
      // broadcast local awareness state
      if (provider.awareness.getLocalState() !== null) {
        const encoderAwarenessState = encoding.createEncoder()
        encoding.writeVarUint(encoderAwarenessState, messageAwareness)
        encoding.writeVarUint8Array(
          encoderAwarenessState,
          awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [
            provider.doc.clientID
          ])
        )
        websocket.send(encoding.toUint8Array(encoderAwarenessState))
      }
    }
    provider.emit('status', [{
      status: 'connecting'
    }])
    emitSyncStatusEvent(provider)
  }
}

/**
 * @param {WebsocketProvider} provider
 * @param {Uint8Array} buf
 */
const broadcastMessage = (provider, buf) => {
  const ws = provider.ws
  if (provider.wsconnected && ws && ws.readyState === ws.OPEN) {
    ws.send(buf)
  }
  if (provider.bcconnected) {
    bc.publish(provider.bcChannel, buf, provider)
  }
}

/**
 * This sync status event only works on certain backends (e.g. yhub)
 * @typedef {object} SyncStatus
 * @property {boolean} SyncStatusEvent.connected
 * @property {boolean} SyncStatusEvent.receivedInitialSync
 * @property {boolean} SyncStatusEvent.localUpdatesSynced
 * @property {number} SyncStatusEvent.localUpdatesAge
 * @property {number} SyncStatusEvent.lastMessageAge
 * @property {'green' | 'yellow' | 'red'} SyncStatusEvent.status Distilled sync status: 'green' if synced, connected, there are no unsynced local updates. 'yellow' if last local message age is younger than 8 seconds. 'red' if unsynced or disconnected or if last local message is older than 8 seconds
 */

export const acceptableConnectionDelay = 8000

/**
 * @param {WebsocketProvider} provider
 */
const emitSyncStatusEvent = provider => {
  const syncStatus = provider.syncStatus
  const prevSyncStatus = provider.prevSyncStatus
  if (
    prevSyncStatus == null ||
    prevSyncStatus.status !== syncStatus.status ||
    prevSyncStatus.connected !== syncStatus.connected ||
    prevSyncStatus.localUpdatesSynced !== syncStatus.localUpdatesSynced ||
    prevSyncStatus.receivedInitialSync !== syncStatus.receivedInitialSync ||
    syncStatus.localUpdatesAge - prevSyncStatus.localUpdatesAge > 1000 ||
    syncStatus.lastMessageAge - prevSyncStatus.lastMessageAge > 1000
  ) {
    provider.emit('sync-status', [syncStatus])
    provider.prevSyncStatus = syncStatus
  }
}

/**
 * Websocket Provider for Yjs. Creates a websocket connection to sync the shared document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 *   import * as Y from '@y/y'
 *   import { WebsocketProvider } from 'y-websocket'
 *   const doc = new Y.Doc()
 *   const provider = new WebsocketProvider('http://localhost:1234', 'my-document-name', doc)
 *
 * @extends {ObservableV2<{ 'connection-close': (event: CloseEvent | null,  provider: WebsocketProvider) => any, 'status': (event: { status: 'connected' | 'disconnected' | 'connecting' }) => any, 'connection-error': (event: Event, provider: WebsocketProvider) => any, 'sync': (state: boolean) => any, 'sync-status': (syncStatus: SyncStatus) => any }>}
 */
export class WebsocketProvider extends ObservableV2 {
  /**
   * @param {string} serverUrl
   * @param {string} roomname
   * @param {Y.Doc} doc
   * @param {object} opts
   * @param {boolean} [opts.connect]
   * @param {awarenessProtocol.Awareness} [opts.awareness]
   * @param {Object<string,string>} [opts.params] specify url parameters
   * @param {Array<string>} [opts.protocols] specify websocket protocols
   * @param {typeof WebSocket} [opts.WebSocketPolyfill] Optionall provide a WebSocket polyfill
   * @param {number} [opts.resyncInterval] Request server state every `resyncInterval` milliseconds
   * @param {number} [opts.maxBackoffTime] Maximum amount of time to wait before trying to reconnect (we try to reconnect using exponential backoff)
   * @param {boolean} [opts.disableBc] Disable cross-tab BroadcastChannel communication
   * @param {number} [opts.socketTimeout] If no message is received for this amount of time, client will close the socket and reconnect
   */
  constructor (serverUrl, roomname, doc, {
    connect = true,
    awareness = new awarenessProtocol.Awareness(doc),
    params = {},
    protocols = [],
    WebSocketPolyfill = WebSocket,
    resyncInterval = -1,
    maxBackoffTime = 2500,
    disableBc = false,
    socketTimeout = math.round(awarenessProtocol.outdatedTimeout * 1.5)
  } = {}) {
    super()
    // ensure that serverUrl does not end with /
    while (serverUrl[serverUrl.length - 1] === '/') {
      serverUrl = serverUrl.slice(0, serverUrl.length - 1)
    }
    this.serverUrl = serverUrl
    this.bcChannel = serverUrl + '/' + roomname
    this.maxBackoffTime = maxBackoffTime
    /**
     * The specified url parameters. This can be safely updated. The changed parameters will be used
     * when a new connection is established.
     * @type {Object<string,string>}
     */
    this.params = params
    this.protocols = protocols
    this.roomname = roomname
    this.doc = doc
    this._WS = WebSocketPolyfill
    this.awareness = awareness
    this.wsconnected = false
    this.wsconnecting = false
    this.bcconnected = false
    this.disableBc = disableBc
    this.socketTimeout = socketTimeout
    this.wsUnsuccessfulReconnects = 0
    this.messageHandlers = messageHandlers.slice()
    /**
     * @type {boolean}
     */
    this._synced = false
    /**
     * @type {WebSocket?}
     */
    this.ws = null
    this.wsLastMessageReceived = 0
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = connect

    /**
     * @type {Array<{ ids: Y.ContentIds, created: number }>}
     */
    this.unconfirmedUpdates = []
    /**
     * @type {SyncStatus?}
     */
    this.prevSyncStatus = null
    /**
     * @type {number}
     */
    this._resyncInterval = 0
    if (resyncInterval > 0) {
      this._resyncInterval = /** @type {any} */ (setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          // resend sync step 1
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.writeSyncStep1(encoder, doc)
          this.ws.send(encoding.toUint8Array(encoder))
        }
      }, resyncInterval))
    }

    /**
     * @param {ArrayBuffer} data
     * @param {any} origin
     */
    this._bcSubscriber = (data, origin) => {
      if (origin !== this) {
        const encoder = readMessage(this, new Uint8Array(data), false)
        if (encoding.length(encoder) > 1) {
          bc.publish(this.bcChannel, encoding.toUint8Array(encoder), this)
        }
      }
    }
    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._updateHandler = (update, origin) => {
      if (origin !== this) {
        const now = time.getUnixTime()
        const newContentIds = Y.createContentIdsFromUpdate(update)
        const lastUnconfirmed = this.unconfirmedUpdates.length > 0 ? array.last(this.unconfirmedUpdates) : null
        if (lastUnconfirmed != null && now - lastUnconfirmed.created < 500) {
          lastUnconfirmed.ids = Y.mergeContentIds([lastUnconfirmed.ids, newContentIds])
        } else {
          this.unconfirmedUpdates.push({
            created: now,
            ids: newContentIds
          })
          if (this.unconfirmedUpdates.length === 1) {
            emitSyncStatusEvent(this)
          }
        }
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeUpdate(encoder, update)
        broadcastMessage(this, encoding.toUint8Array(encoder))
      }
    }
    this.doc.on('update', this._updateHandler)
    /**
     * @param {any} changed
     * @param {any} _origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, _origin) => {
      const changedClients = added.concat(updated).concat(removed)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      )
      broadcastMessage(this, encoding.toUint8Array(encoder))
    }
    this._exitHandler = () => {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [doc.clientID],
        'app closed'
      )
    }
    if (env.isNode && typeof process !== 'undefined') {
      process.on('exit', this._exitHandler)
    }
    awareness.on('update', this._awarenessUpdateHandler)
    this._checkInterval = /** @type {any} */ (setInterval(() => {
      if (
        this.wsconnected &&
        this.socketTimeout <
          time.getUnixTime() - this.wsLastMessageReceived
      ) {
        console.error('[y-websocket] closing timed-out websocket')
        // no message received in a long time - not even your own awareness
        // updates (which are updated every 15 seconds)
        closeWebsocketConnection(this, /** @type {WebSocket} */ (this.ws), null)
      }
      emitSyncStatusEvent(this)
    }, acceptableConnectionDelay / 2))
    if (connect) {
      this.connect()
    }
  }

  /**
   * @return {SyncStatus}
   */
  get syncStatus () {
    const {
      unconfirmedUpdates,
      wsconnected: connected,
      synced: receivedInitialSync,
      wsLastMessageReceived
    } = this
    const now = time.getUnixTime()
    const localUpdatesSynced = unconfirmedUpdates.length === 0
    const localUpdatesAge = localUpdatesSynced ? 0 : now - unconfirmedUpdates[0].created
    const status = (connected && receivedInitialSync && localUpdatesAge === 0) ? 'green' : (connected && localUpdatesAge < acceptableConnectionDelay ? 'yellow' : 'red')
    return {
      connected,
      receivedInitialSync,
      localUpdatesSynced,
      localUpdatesAge,
      lastMessageAge: now - wsLastMessageReceived,
      status
    }
  }

  get url () {
    const encodedParams = url.encodeQueryParams(this.params)
    return this.serverUrl + '/' + this.roomname +
      (encodedParams.length === 0 ? '' : '?' + encodedParams)
  }

  /**
   * @type {boolean}
   */
  get synced () {
    return this._synced
  }

  set synced (state) {
    if (this._synced !== state) {
      this._synced = state
      // @ts-ignore
      this.emit('synced', [state])
      this.emit('sync', [state])
    }
  }

  destroy () {
    if (this._resyncInterval !== 0) {
      clearInterval(this._resyncInterval)
    }
    clearInterval(this._checkInterval)
    this.disconnect()
    if (env.isNode && typeof process !== 'undefined') {
      process.off('exit', this._exitHandler)
    }
    this.awareness.off('update', this._awarenessUpdateHandler)
    this.doc.off('update', this._updateHandler)
    super.destroy()
  }

  connectBc () {
    if (this.disableBc) {
      return
    }
    if (!this.bcconnected) {
      bc.subscribe(this.bcChannel, this._bcSubscriber)
      this.bcconnected = true
    }
    // send sync step1 to bc
    // write sync step 1
    const encoderSync = encoding.createEncoder()
    encoding.writeVarUint(encoderSync, messageSync)
    syncProtocol.writeSyncStep1(encoderSync, this.doc)
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderSync), this)
    // broadcast local state
    const encoderState = encoding.createEncoder()
    encoding.writeVarUint(encoderState, messageSync)
    syncProtocol.writeSyncStep2(encoderState, this.doc)
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderState), this)
    // write queryAwareness
    const encoderAwarenessQuery = encoding.createEncoder()
    encoding.writeVarUint(encoderAwarenessQuery, messageQueryAwareness)
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessQuery),
      this
    )
    // broadcast local awareness state
    const encoderAwarenessState = encoding.createEncoder()
    encoding.writeVarUint(encoderAwarenessState, messageAwareness)
    encoding.writeVarUint8Array(
      encoderAwarenessState,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.awareness.clientID
      ])
    )
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessState),
      this
    )
  }

  disconnectBc () {
    // broadcast message with local awareness state set to null (indicating disconnect)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.awareness.clientID
      ], new Map())
    )
    broadcastMessage(this, encoding.toUint8Array(encoder))
    if (this.bcconnected) {
      bc.unsubscribe(this.bcChannel, this._bcSubscriber)
      this.bcconnected = false
    }
  }

  disconnect () {
    this.shouldConnect = false
    this.disconnectBc()
    if (this.ws !== null) {
      closeWebsocketConnection(this, this.ws, null)
    }
  }

  connect () {
    this.shouldConnect = true
    if (!this.wsconnected && this.ws === null) {
      setupWS(this)
      this.connectBc()
    }
  }
}
