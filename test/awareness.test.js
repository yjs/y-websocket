import * as Y from '@y/y'
import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as awarenessProtocol from '@y/protocols/awareness'
import WebSocket, { WebSocketServer } from 'ws'
import { WebsocketProvider, messageAwareness } from '@y/websocket'

const testTimeout = 15000

/**
 * @param {function():boolean} check
 * @param {string} description
 */
const until = async (check, description) => {
  try {
    await promise.untilAsync(check, testTimeout)
  } catch (err) {
    t.fail('timed out after ' + testTimeout + 'ms waiting for: ' + description)
  }
}

/**
 * Decode an awareness update into the list of `{ clientID, state }` entries it carries.
 *
 * @param {Uint8Array} update
 * @return {Array<{ clientID: number, state: any }>}
 */
const decodeAwarenessUpdate = (update) => {
  const decoder = decoding.createDecoder(update)
  const len = decoding.readVarUint(decoder)
  const entries = []
  for (let i = 0; i < len; i++) {
    const clientID = decoding.readVarUint(decoder)
    decoding.readVarUint(decoder) // clock
    entries.push({ clientID, state: JSON.parse(decoding.readVarString(decoder)) })
  }
  return entries
}

/**
 * Awareness that the backend (e.g. yhub) forwards from another client must not be sent back to
 * the backend.
 *
 * @param {t.TestCase} _tc
 */
export const testRemoteAwarenessIsNotEchoed = async (_tc) => {
  const remoteDoc = new Y.Doc()
  const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc)
  remoteAwareness.setLocalState({ user: 'remote' })
  /**
   * Every awareness entry that the client sent to the server.
   *
   * @type {Array<{ clientID: number, state: any }>}
   */
  const received = []
  const wss = new WebSocketServer({ port: 0 })
  await promise.create((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })
  wss.on('connection', ws => {
    ws.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(/** @type {any} */ (data)))
      if (decoding.readVarUint(decoder) === messageAwareness) {
        received.push(...decodeAwarenessUpdate(decoding.readVarUint8Array(decoder)))
      }
    })
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [remoteAwareness.clientID])
    )
    ws.send(encoding.toUint8Array(encoder))
  })
  const doc = new Y.Doc()
  const provider = new WebsocketProvider('ws://localhost:' + /** @type {any} */ (wss.address()).port, 'awareness-echo', doc, {
    WebSocketPolyfill: /** @type {any} */ (WebSocket),
    disableBc: true
  })
  try {
    await until(() => provider.awareness.getStates().has(remoteAwareness.clientID), 'the remote awareness state')
    t.compare(provider.awareness.getStates().get(remoteAwareness.clientID), { user: 'remote' })
    // a local change must still be sent. Messages on a websocket are ordered, so once this arrived,
    // an echo of the remote state would have arrived as well.
    provider.awareness.setLocalStateField('marker', 1)
    await until(() => received.some(e => e.clientID === doc.clientID && e.state?.marker === 1), 'the local awareness update')
    t.assert(
      received.every(e => e.clientID !== remoteAwareness.clientID),
      'the client must not send the awareness state of a remote client back to the server'
    )
  } finally {
    provider.destroy()
    doc.destroy()
    remoteDoc.destroy()
    wss.clients.forEach(client => client.terminate())
    await promise.create(resolve => wss.close(() => resolve(undefined)))
  }
}
