/*
Unlike stated in the LICENSE file, it is not necessary to include the copyright notice and permission notice when you copy code from this file.
*/

/**
 * @module provider/websocket
 */

/* eslint-env browser */

import * as Y from 'yjs' // eslint-disable-line
import * as bc from 'lib0/broadcastchannel.js'
import * as encoding from 'lib0/encoding.js'
import * as decoding from 'lib0/decoding.js'
import * as syncProtocol from 'y-protocols/sync.js'
import * as authProtocol from 'y-protocols/auth.js'
import * as awarenessProtocol from 'y-protocols/awareness.js'
import * as mutex from 'lib0/mutex.js'
import { Observable } from 'lib0/observable.js'

const messageSync = 0
const messageQueryAwareness = 3
const messageAwareness = 1
const messageAuth = 2

const reconnectTimeout = 3000

/**
 * @param {WebsocketProvider} provider
 * @param {string} reason
 */
const permissionDeniedHandler = (provider, reason) => console.warn(`Permission denied to access ${provider.url}.\n${reason}`)

/**
 * @param {WebsocketProvider} provider
 * @param {Uint8Array} buf
 * @return {encoding.Encoder}
 */
const readMessage = (provider, buf) => {
  const decoder = decoding.createDecoder(buf)
  const encoder = encoding.createEncoder()
  const messageType = decoding.readVarUint(decoder)
  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, provider.doc, provider)
      break
    case messageQueryAwareness:
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(provider.awareness, Array.from(provider.awareness.getStates().keys())))
      break
    case messageAwareness:
      awarenessProtocol.applyAwarenessUpdate(provider.awareness, decoding.readVarUint8Array(decoder), provider)
      break
    case messageAuth:
      authProtocol.readAuthMessage(decoder, provider, permissionDeniedHandler)
      break
    default:
      console.error('Unable to compute message')
      return encoder
  }
  return encoder
}

/**
 * @param {WebsocketProvider} provider
 */
const setupWS = provider => {
  if (provider.shouldConnect && provider.ws === null) {
    const websocket = new WebSocket(provider.url)
    websocket.binaryType = 'arraybuffer'
    provider.ws = websocket
    provider.wsconnecting = true
    provider.wsconnected = false
    websocket.onmessage = event => {
      const encoder = readMessage(provider, new Uint8Array(event.data))
      if (encoding.length(encoder) > 1) {
        websocket.send(encoding.toUint8Array(encoder))
      }
    }
    websocket.onclose = () => {
      provider.ws = null
      provider.wsconnecting = false
      provider.wsconnected = false
      if (provider.wsconnected) {
        // update awareness (all users left)
        awarenessProtocol.removeAwarenessStates(provider.awareness, Array.from(provider.awareness.getStates().keys()), provider)
        provider.emit('status', [{
          status: 'disconnected'
        }])
      }
      setTimeout(setupWS, reconnectTimeout, provider)
    }
    websocket.onopen = () => {
      provider.wsconnecting = false
      provider.wsconnected = true
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
        encoding.writeVarUint8Array(encoderAwarenessState, awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [provider.doc.clientID]))
        websocket.send(encoding.toUint8Array(encoderAwarenessState))
      }
    }
  }
}

/**
 * @param {WebsocketProvider} provider
 * @param {ArrayBuffer} buf
 */
const broadcastMessage = (provider, buf) => {
  if (provider.wsconnected) {
    // @ts-ignore We know that wsconnected = true
    provider.ws.send(buf)
  }
  if (provider.bcconnected) {
    provider.mux(() => {
      bc.publish(provider.url, buf)
    })
  }
}

/**
 * Websocket Provider for Yjs. Creates a websocket connection to sync the shared document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 *   import * as Y from 'yjs'
 *   import { WebsocketProvider } from 'y-websocket'
 *   const doc = new Y.Doc()
 *   const provider = new WebsocketProvider('http://localhost:1234', 'my-document-name', doc)
 *
 * @extends {Observable<string>}
 */
export class WebsocketProvider extends Observable {
  /**
   * @param {string} url
   * @param {string} roomname
   * @param {Y.Doc} doc
   * @param {{awareness:awarenessProtocol.Awareness,db:any|null}} conf
   */
  constructor (url, roomname, doc, { awareness = new awarenessProtocol.Awareness(doc), db = null } = /** @type {any} */ ({})) {
    super()
    // ensure that url is always ends with /
    while (url[url.length - 1] === '/') {
      url = url.slice(0, url.length - 1)
    }
    this.url = url + '/' + roomname
    this.roomname = roomname
    this.doc = doc
    /**
     * @type {Object<string,Object>}
     */
    this._localAwarenessState = {}
    this.db = db
    this.awareness = awareness
    this.wsconnected = false
    this.wsconnecting = false
    this.bcconnected = false
    this.mux = mutex.createMutex()
    /**
     * @type {WebSocket?}
     */
    this.ws = null
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = true
    /**
     * @param {ArrayBuffer} data
     */
    this._bcSubscriber = data => {
      this.mux(() => {
        const encoder = readMessage(this, new Uint8Array(data))
        if (encoding.length(encoder) > 1) {
          bc.publish(this.url, encoding.toUint8Array(encoder))
        }
      })
    }
    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._updateHandler = (update, origin) => {
      if (origin !== this || origin === null) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeUpdate(encoder, update)
        broadcastMessage(this, encoding.toUint8Array(encoder))
      }
    }
    /**
     * @param {any} changed
     * @param {any} origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]))
      broadcastMessage(this, encoding.toUint8Array(encoder))
    }
    window.addEventListener('beforeunload', () => {
      // broadcast message with local awareness state set to null (indicating disconnect)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID], new Map()))
      broadcastMessage(this, encoding.toUint8Array(encoder))
    })
    awareness.on('change', this._awarenessUpdateHandler)
    this.connect()
  }
  destroy () {
    this.disconnect()
    this.awareness.off('change', this._awarenessUpdateHandler)
    super.destroy()
  }
  disconnect () {
    this.shouldConnect = false
    // broadcast message with local awareness state set to null (indicating disconnect)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID], new Map()))
    broadcastMessage(this, encoding.toUint8Array(encoder))
    if (this.ws !== null) {
      this.ws.close()
    }
    if (this.bcconnected) {
      bc.unsubscribe(this.url, this._bcSubscriber)
      this.bcconnected = false
    }
    this.doc.off('update', this._updateHandler)
  }
  connect () {
    this.shouldConnect = true
    if (!this.wsconnected && this.ws === null) {
      setupWS(this)
      if (!this.bcconnected) {
        bc.subscribe(this.url, this._bcSubscriber)
        this.bcconnected = true
      }
      // send sync step1 to bc
      this.mux(() => {
        // write sync step 1
        const encoderSync = encoding.createEncoder()
        encoding.writeVarUint(encoderSync, messageSync)
        syncProtocol.writeSyncStep1(encoderSync, this.doc)
        bc.publish(this.url, encoding.toUint8Array(encoderSync))
        // broadcast local state
        const encoderState = encoding.createEncoder()
        encoding.writeVarUint(encoderState, messageSync)
        syncProtocol.writeSyncStep2(encoderState, this.doc)
        bc.publish(this.url, encoding.toUint8Array(encoderState))
        // write queryAwareness
        const encoderAwarenessQuery = encoding.createEncoder()
        encoding.writeVarUint(encoderAwarenessQuery, messageQueryAwareness)
        bc.publish(this.url, encoding.toUint8Array(encoderAwarenessQuery))
        // broadcast local awareness state
        const encoderAwarenessState = encoding.createEncoder()
        encoding.writeVarUint(encoderAwarenessState, messageAwareness)
        encoding.writeVarUint8Array(encoderAwarenessState, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
        bc.publish(this.url, encoding.toUint8Array(encoderAwarenessState))
      })
      this.doc.on('update', this._updateHandler)
    }
  }
}
