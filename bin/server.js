/*
Unlike stated in the LICENSE file, it is not necessary to include the copyright notice and permission notice when you copy code from this file.
*/

const Y = require('yjs')
const syncProtocol = require('y-protocols/dist/sync.js')
const awarenessProtocol = require('y-protocols/dist/awareness.js')
/**
 * @type {any}
 */
const WebSocket = require('ws')
const http = require('http')
const encoding = require('lib0/dist/encoding.js')
const decoding = require('lib0/dist/decoding.js')
const mutex = require('lib0/dist/mutex.js')
const map = require('lib0/dist/map.js')

const port = process.env.PORT || 1234

// disable gc when using snapshots!
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0'
const persistenceDir = process.env.YPERSISTENCE
/**
 * @type {{bindState: function(string,WSSharedDoc):void, writeState:function(string,WSSharedDoc):Promise}|null}
 */
let persistence = null
if (typeof persistenceDir === 'string') {
  // @ts-ignore
  const LevelDbPersistence = require('y-leveldb').LevelDbPersistence
  persistence = new LevelDbPersistence(persistenceDir)
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('okay')
})

const wss = new WebSocket.Server({ noServer: true })

/**
 * @type {Map<number,WSSharedDoc>}
 */
const docs = new Map()

const messageSync = 0
const messageAwareness = 1
// const messageAuth = 2

/**
 * @param {Y.Transaction} transaction
 * @param {WSSharedDoc} doc
 */
const afterTransaction = (transaction, doc) => {
  if (transaction.updateMessage !== null) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, transaction.updateMessage)
    const message = encoding.toBuffer(encoder)
    doc.conns.forEach((_, conn) => conn.send(message))
  }
}

class WSSharedDoc extends Y.Y {
  constructor () {
    super({ gc: gcEnabled })
    this.mux = mutex.createMutex()
    /**
     * Maps from conn to set of controlled user ids. Delete all user ids from awareness when this conn is closed
     * @type {Map<Object, Set<number>>}
     */
    this.conns = new Map()
    /**
     * @type {Map<number,Object>}
     */
    this.awareness = new Map()
    /**
     * @type {Map<number,number>}
     */
    this.awarenessClock = new Map()
    this.on('afterTransaction', afterTransaction)
  }
}

/**
 * @param {any} conn
 * @param {WSSharedDoc} doc
 * @param {ArrayBuffer} message
 */
const messageListener = (conn, doc, message) => {
  const encoder = encoding.createEncoder()
  const decoder = decoding.createDecoder(message)
  const messageType = decoding.readVarUint(decoder)
  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, doc)
      if (encoding.length(encoder) > 1) {
        conn.send(encoding.toBuffer(encoder))
      }
      break
    case messageAwareness: {
      encoding.writeVarUint(encoder, messageAwareness)
      const updates = awarenessProtocol.forwardAwarenessMessage(decoder, encoder)
      updates.forEach(update => {
        doc.awareness.set(update.clientID, update.state)
        doc.awarenessClock.set(update.clientID, update.clock)
        // @ts-ignore we received an update => so conn exists
        doc.conns.get(conn).add(update.clientID)
      })
      const buff = encoding.toBuffer(encoder)
      doc.conns.forEach((_, c) => {
        c.send(buff)
      })
      break
    }
  }
}

/**
 * @param {any} conn
 * @param {any} req
 */
const setupConnection = (conn, req) => {
  conn.binaryType = 'arraybuffer'
  // get doc, create if it does not exist yet
  const docName = req.url.slice(1)
  const doc = map.setIfUndefined(docs, docName, () => {
    const doc = new WSSharedDoc()
    if (persistence !== null) {
      persistence.bindState(docName, doc)
    }
    docs.set(docName, doc)
    return doc
  })
  doc.conns.set(conn, new Set())
  // listen and reply to events
  // @ts-ignore
  conn.on('message', message => messageListener(conn, doc, message))
  conn.on('close', () => {
    /**
     * @type {Set<number>}
     */
    // @ts-ignore
    const controlledIds = doc.conns.get(conn)
    doc.conns.delete(conn)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    awarenessProtocol.writeUsersStateChange(encoder, Array.from(controlledIds).map(clientID => {
      const clock = (doc.awarenessClock.get(clientID) || 0) + 1
      doc.awareness.delete(clientID)
      doc.awarenessClock.delete(clientID)
      return { clientID, state: null, clock }
    }))
    const buf = encoding.toBuffer(encoder)
    doc.conns.forEach((_, conn) => conn.send(buf))
    if (doc.conns.size === 0 && persistence !== null) {
      // if persisted, we store state and destroy ydocument
      persistence.writeState(docName, doc).then(() => {
        doc.destroy()
      })
      docs.delete(docName)
    }
  })
  // send sync step 1
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeSyncStep1(encoder, doc.store)
  conn.send(encoding.toBuffer(encoder))
  if (doc.awareness.size > 0) {
    const encoder = encoding.createEncoder()
    /**
     * @type {Array<Object>}
     */
    const userStates = []
    doc.awareness.forEach((state, clientID) => {
      userStates.push({ state, clientID, clock: (doc.awarenessClock.get(clientID) || 0) })
    })
    encoding.writeVarUint(encoder, messageAwareness)
    awarenessProtocol.writeUsersStateChange(encoder, userStates)
    conn.send(encoding.toBuffer(encoder))
  }
}

wss.on('connection', setupConnection)

server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
  /**
   * @param {any} ws
   */
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port)

console.log('running on port', port)
