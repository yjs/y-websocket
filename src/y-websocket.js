/*
Unlike stated in the LICENSE file, it is not necessary to include the copyright notice and permission notice when you copy code from this file.
*/

/**
 * @module provider/websocket
 */

/* eslint-env browser */

import * as Y from 'yjs'
import * as bc from 'lib0/broadcastchannel.js'
import * as encoding from 'lib0/encoding.js'
import * as decoding from 'lib0/decoding.js'
import * as syncProtocol from 'y-protocols/sync.js'
import * as authProtocol from 'y-protocols/auth.js'
import * as awarenessProtocol from 'y-protocols/awareness.js'
import * as mutex from 'lib0/mutex.js'

const messageSync = 0
const messageAwareness = 1
const messageAuth = 2

const reconnectTimeout = 3000

/**
 * @param {WebsocketsSharedDocument} doc
 * @param {string} reason
 */
const permissionDeniedHandler = (doc, reason) => console.warn(`Permission denied to access ${doc.url}.\n${reason}`)

/**
 * @param {WebsocketsSharedDocument} doc
 * @param {ArrayBuffer} buf
 * @return {encoding.Encoder}
 */
const readMessage = (doc, buf) => {
  const decoder = decoding.createDecoder(buf)
  const encoder = encoding.createEncoder()
  const messageType = decoding.readVarUint(decoder)
  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, doc, doc.ws)
      break
    case messageAwareness:
      doc.mux(() =>
        awarenessProtocol.readAwarenessMessage(decoder, doc)
      )
      break
    case messageAuth:
      authProtocol.readAuthMessage(decoder, doc, permissionDeniedHandler)
  }
  return encoder
}

/**
 * @param {WebsocketsSharedDocument} doc
 * @param {string} url
 */
const setupWS = (doc, url) => {
  const websocket = new WebSocket(url)
  websocket.binaryType = 'arraybuffer'
  doc.ws = websocket
  websocket.onmessage = event => {
    const encoder = readMessage(doc, event.data)
    if (encoding.length(encoder) > 1) {
      websocket.send(encoding.toBuffer(encoder))
    }
  }
  websocket.onclose = () => {
    doc.ws = null
    doc.wsconnected = false
    // update awareness (all users left)
    /**
     * @type {Array<number>}
     */
    const removed = []
    doc.getAwarenessInfo().forEach((_, clientID) => {
      removed.push(clientID)
    })
    doc.awareness = new Map()
    doc.emit('awareness', [{
      added: [], updated: [], removed
    }])
    doc.emit('status', [{
      status: 'disconnected'
    }])
    if (doc.shouldReconnect) {
      setTimeout(setupWS, reconnectTimeout, doc, url)
    }
  }
  websocket.onopen = () => {
    doc.wsconnected = true
    doc.emit('status', [{
      status: 'connected'
    }])
    // always send sync step 1 when connected
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, doc.store)
    websocket.send(encoding.toBuffer(encoder))
    // force send stored awareness info
    doc.setAwarenessField(null, null)
  }
}

/**
 * @param {Y.Transaction} transaction
 * @param {WebsocketsSharedDocument} y
 */
const broadcastUpdate = (transaction, y) => {
  if (transaction.origin !== y.ws && transaction.updateMessage !== null) {
    const updateMessage = transaction.updateMessage
    if (updateMessage !== null) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, updateMessage)
      const buf = encoding.toBuffer(encoder)
      if (y.wsconnected) {
        // @ts-ignore We know that wsconnected = true
        y.ws.send(buf)
      }
      bc.publish(y.url, buf)
    }
  }
}

class WebsocketsSharedDocument extends Y.Y {
  /**
   * @param {string} url
   * @param {Object} opts
   */
  constructor (url, opts) {
    super(opts)
    /**
     * @type {Object<string,Object>}
     */
    this._localAwarenessState = {}
    this.awareness = new Map()
    this.awarenessClock = new Map()
    this.url = url
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
      const encoder = readMessage(this, data) // already muxed
      this.mux(() => {
        if (encoding.length(encoder) > 1) {
          bc.publish(url, encoding.toBuffer(encoder))
        }
      })
    }
    this.connect()
  }
  disconnect () {
    this.shouldReconnect = false
    if (this.ws !== null) {
      this.ws.close()
      bc.unsubscribe(this.url, this._bcSubscriber)
      this.off('afterTransaction', broadcastUpdate)
    }
  }
  connect () {
    this.shouldReconnect = true
    if (!this.wsconnected && this.ws === null) {
      setupWS(this, this.url)
      bc.subscribe(this.url, this._bcSubscriber)
      // send sync step1 to bc
      this.mux(() => {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeSyncStep1(encoder, this.store)
        bc.publish(this.url, encoding.toBuffer(encoder))
      })
      this.on('afterTransaction', broadcastUpdate)
    }
  }
  getLocalAwarenessInfo () {
    return this._localAwarenessState
  }
  getAwarenessInfo () {
    return this.awareness
  }
  /**
   * @param {string?} field
   * @param {Object} value
   */
  setAwarenessField (field, value) {
    if (field !== null) {
      this._localAwarenessState[field] = value
    }
    if (this.wsconnected) {
      const clock = (this.awarenessClock.get(this.clientID) || 0) + 1
      this.awarenessClock.set(this.clientID, clock)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      awarenessProtocol.writeUsersStateChange(encoder, [{ clientID: this.clientID, state: this._localAwarenessState, clock }])
      const buf = encoding.toBuffer(encoder)
      // @ts-ignore we know that wsconnected = true
      this.ws.send(buf)
    }
  }
}

/**
 * Websocket Provider for Yjs. Creates a single websocket connection to each document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 *   import { WebsocketProvider } from 'yjs/provider/websocket/client.js'
 *   const provider = new WebsocketProvider('http://localhost:1234')
 *   const ydocument = provider.get('my-document-name')
 */
export class WebsocketProvider {
  /**
   * @param {string} url
   */
  constructor (url) {
    // ensure that url is always ends with /
    while (url[url.length - 1] === '/') {
      url = url.slice(0, url.length - 1)
    }
    this.url = url + '/'
    /**
     * @type {Map<string, WebsocketsSharedDocument>}
     */
    this.docs = new Map()
  }
  /**
   * @param {string} name
   * @param {Object} [opts]
   * @return {WebsocketsSharedDocument}
   */
  get (name, opts) {
    let doc = this.docs.get(name)
    if (doc === undefined) {
      doc = new WebsocketsSharedDocument(this.url + name, opts)
    }
    return doc
  }
}
