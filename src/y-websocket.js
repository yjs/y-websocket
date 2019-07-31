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
    this.mux = mutex.createMutex()
    /**
     * @type {WebSocket?}
     */
    this.ws = null
    this.shouldReconnect = true
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
      if (origin !== this.ws || origin === null) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeUpdate(encoder, update)
        const buf = encoding.toUint8Array(encoder)
        if (this.wsconnected) {
          // @ts-ignore We know that wsconnected = true
          this.ws.send(buf)
        }
        this.mux(() => {
          bc.publish(this.url, buf)
        })
      }
    }
    /**
     * @param {any} changed
     * @param {any} origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      // only broadcast local awareness information and when ws connected
      const predicate = /** @param {number} id */ id => id === doc.clientID
      if (added.some(predicate) || updated.some(predicate) || removed.some(predicate)) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageAwareness)
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]))
        const buf = encoding.toUint8Array(encoder)
        if (this.wsconnected && this.ws !== null) {
          this.ws.send(buf)
        }
        this.mux(() => {
          bc.publish(this.url, buf)
        })
      }
    }
    window.addEventListener('beforeunload', () => {
      awarenessProtocol.removeAwarenessStates(awareness, [this.doc.clientID], null)
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
    this.shouldReconnect = false
    if (this.ws !== null) {
      this.awareness.setLocalState(null)
      this.ws.close()
      bc.unsubscribe(this.url, this._bcSubscriber)
      this.doc.off('update', this._updateHandler)
    }
  }
  connect () {
    this.shouldReconnect = true
    if (!this.wsconnected && this.ws === null) {
      if (this.awareness.getLocalState() === null) {
        this.awareness.setLocalState({})
      }
      setupWS(this)
      bc.subscribe(this.url, this._bcSubscriber)
      // send sync step1 to bc
      this.mux(() => {
        // write sync step 1
        const encoderSync = encoding.createEncoder()
        encoding.writeVarUint(encoderSync, messageSync)
        syncProtocol.writeSyncStep1(encoderSync, this.doc)
        bc.publish(this.url, encoding.toUint8Array(encoderSync))
        // write queryAwareness
        const encoderAwareness = encoding.createEncoder()
        encoding.writeVarUint(encoderAwareness, messageQueryAwareness)
        bc.publish(this.url, encoding.toUint8Array(encoderAwareness))
      })
      this.doc.on('update', this._updateHandler)
    }
  }
}

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
      syncProtocol.readSyncMessage(decoder, encoder, provider.doc, provider.ws)
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
  const websocket = new WebSocket(provider.url)
  websocket.binaryType = 'arraybuffer'
  provider.ws = websocket
  websocket.onmessage = event => {
    const encoder = readMessage(provider, new Uint8Array(event.data))
    if (encoding.length(encoder) > 1) {
      websocket.send(encoding.toUint8Array(encoder))
    }
  }
  websocket.onclose = () => {
    provider.ws = null
    if (provider.wsconnected) {
      provider.wsconnected = false
      // update awareness (all users left)
      awarenessProtocol.removeAwarenessStates(provider.awareness, Array.from(provider.awareness.getStates().keys()), provider)
      provider.emit('status', [{
        status: 'disconnected'
      }])
    }
    if (provider.shouldReconnect) {
      setTimeout(setupWS, reconnectTimeout, provider, provider.url)
    }
  }
  websocket.onopen = () => {
    provider.wsconnected = true
    provider.emit('status', [{
      status: 'connected'
    }])
    // always send sync step 1 when connected
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, provider.doc)
    websocket.send(encoding.toUint8Array(encoder))
    // by updating the local awareness state we trigger the event handler that propagates this information to other clients.
    provider.awareness.setLocalState(provider.awareness.getLocalState() || {})
  }
}
