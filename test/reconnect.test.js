import * as Y from '@y/y'
import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
import * as time from 'lib0/time'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from '@y/protocols/sync'
import WebSocket, { WebSocketServer } from 'ws'
import { WebsocketProvider, messageSync } from '@y/websocket'

/**
 * Upper bound for every `until` in this file. Only ever reached when something is genuinely
 * broken - the happy paths finish in a few hundred milliseconds.
 */
const testTimeout = 15000

/**
 * `promise.untilAsync` defaults to *no* timeout, which turns a broken assumption into a suite
 * that hangs forever without output. Always go through this.
 *
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
 * @typedef {object} TestServer
 * @property {string} TestServer.url
 * @property {Array<{ ws: any, at: number }>} TestServer.connections every accepted connection
 * @property {function():Array<number>} TestServer.gaps ms between consecutive connections
 * @property {function():Promise<void>} TestServer.destroy
 */

/**
 * Start a websocket server on an ephemeral port. `policy` is called once per accepted connection
 * and decides what the server does with it: hold it open, close it with a specific code, ...
 *
 * Every connection is timestamped, so that tests can assert on the delay *between* reconnect
 * attempts - the only black-box signal for the backoff behavior.
 *
 * @param {function(any, number):void} policy
 * @return {Promise<TestServer>}
 */
const createTestServer = async (policy) => {
  const wss = new WebSocketServer({ port: 0 })
  await promise.create((resolve, reject) => {
    wss.once('listening', resolve)
    wss.once('error', reject)
  })
  /**
   * @type {TestServer}
   */
  const server = {
    url: 'ws://localhost:' + wss.address().port,
    connections: [],
    gaps: () => server.connections.slice(1).map((c, i) => c.at - server.connections[i].at),
    destroy: async () => {
      // `wss.close()` only stops the listener and then waits for open connections, so kill the
      // sockets first - otherwise teardown blocks until the client gives up
      wss.clients.forEach(client => client.terminate())
      await promise.create(resolve => wss.close(() => resolve(undefined)))
    }
  }
  wss.on('connection', ws => {
    const index = server.connections.length
    server.connections.push({ ws, at: time.getUnixTime() })
    policy(ws, index)
  })
  return server
}

/**
 * Server policy: accept the connection and never say anything.
 */
const holdOpen = () => {}

/**
 * Server policy: accept the connection, then close it with `code` after a short delay. The delay
 * guarantees that the client processed the 101 response and fired `onopen` before the close frame
 * arrives - the accept-then-close shape that the backoff bug is about.
 *
 * @param {number} code
 * @param {string} reason
 */
const acceptThenClose = (code, reason) => (ws) => {
  setTimeout(() => {
    if (ws.readyState === ws.OPEN) {
      ws.close(code, reason)
    }
  }, 10)
}

/**
 * Server policy: close the TCP socket without a close frame. This is the deterministic way to
 * make the client observe a 1006.
 *
 * @param {any} ws
 */
const terminateSocket = (ws) => {
  setTimeout(() => ws.terminate(), 10)
}

/**
 * Server policy: answer the client's sync step 1 with a real sync step 2 - so the client actually
 * reaches `synced === true` - and only then close.
 *
 * @param {number} code
 * @param {string} reason
 */
const syncThenClose = (code, reason) => (ws) => {
  const serverDoc = new Y.Doc()
  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    if (decoding.readVarUint(decoder) !== messageSync) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.readSyncMessage(decoder, encoder, serverDoc, null)
    if (encoding.length(encoder) > 1) {
      ws.send(encoding.toUint8Array(encoder))
    }
    setTimeout(() => {
      if (ws.readyState === ws.OPEN) {
        ws.close(code, reason)
      }
    }, 10)
  })
}

/**
 * Boots a server + provider, runs `f`, and guarantees teardown in the right order:
 *
 *   1. the provider - otherwise it keeps hammering the port while the server shuts down,
 *   2. the ydoc - `provider.destroy()` does not destroy the awareness, and `Awareness` owns a
 *      `setInterval` that is only cleared via `doc.on('destroy')`,
 *   3. the server.
 *
 * `disableBc` defaults to true: node's global `BroadcastChannel` keeps the event loop alive.
 *
 * @param {{ room: string, policy: function(any, number):void, opts?: object }} conf
 * @param {function(WebsocketProvider, TestServer):Promise<void>} f
 */
const withProvider = async (conf, f) => {
  const server = await createTestServer(conf.policy)
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(server.url, conf.room, doc, Object.assign({
    WebSocketPolyfill: /** @type {any} */ (WebSocket),
    disableBc: true,
    maxBackoffTime: 400
  }, conf.opts || {}))
  try {
    await f(provider, server)
  } finally {
    provider.destroy()
    doc.destroy()
    await server.destroy()
  }
}

/**
 * A server that closes with 4401 must stop the provider dead: one `closed` event, and no
 * reconnect ever again.
 *
 * @param {t.TestCase} _tc
 */
export const testTerminalCloseStopsReconnecting = async (_tc) => {
  await withProvider({
    room: 'terminal-close',
    policy: acceptThenClose(4401, 'permission revoked')
  }, async (provider, server) => {
    /**
     * @type {Array<{ code: number, reason: string }>}
     */
    const closed = []
    /**
     * @type {Array<any>}
     */
    const connectionCloses = []
    provider.on('closed', (event) => { closed.push(event) })
    provider.on('connection-close', (event) => { connectionCloses.push(event) })

    await until(() => closed.length > 0, 'the terminal closed event')

    t.compare(closed.length, 1, 'closed is emitted exactly once')
    t.compare(closed[0].code, 4401, 'the close code is forwarded')
    t.compare(closed[0].reason, 'permission revoked', 'the close reason is forwarded')
    t.assert(provider.shouldConnect === false, 'a terminal close switches shouldConnect off')
    t.assert(provider.ws === null, 'the socket is released')
    t.assert(provider.wsconnected === false, 'wsconnected is false')

    // maxBackoffTime is 400ms, so this window is long enough for the already scheduled setupWS
    // timer - and several more - to misfire if the shouldConnect guard were wrong
    await promise.wait(1200)
    t.compare(server.connections.length, 1, 'the provider never reconnects after a terminal close')
    t.compare(closed.length, 1, 'closed is still emitted exactly once')
    t.compare(connectionCloses.length, 1, 'connection-close is emitted exactly once too')
  })
}

/**
 * Regression test for the backoff bug: `wsUnsuccessfulReconnects` used to be reset by `onopen`,
 * so an accept-then-close server was retried at a constant 100ms forever and maxBackoffTime was
 * unreachable.
 *
 * @param {t.TestCase} _tc
 */
export const testShouldReconnectTrueGrowsTheBackoff = async (_tc) => {
  const maxBackoffTime = 400
  await withProvider({
    room: 'growing-backoff',
    opts: { maxBackoffTime, shouldReconnect: () => true },
    policy: acceptThenClose(4401, 'permission revoked')
  }, async (provider, server) => {
    let connectedEvents = 0
    let closedEvents = 0
    provider.on('status', (event) => {
      if (event.status === 'connected') { connectedEvents++ }
    })
    provider.on('closed', () => { closedEvents++ })

    await until(() => server.connections.length >= 6, 'six connection attempts')

    t.compare(closedEvents, 0, 'shouldReconnect: () => true is honoured, nothing is terminal')
    t.assert(provider.shouldConnect === true, 'the provider keeps trying')
    t.assert(connectedEvents >= 4, 'the sockets really did open before the server closed them (' + connectedEvents + ')')

    // deterministic: `onopen` used to reset this to 0 on every attempt, so it was *exactly* 0 no
    // matter how loaded the machine is
    t.assert(
      provider.wsUnsuccessfulReconnects >= 3,
      'an accept-then-close server must count as an unsuccessful reconnect (got ' + provider.wsUnsuccessfulReconnects + ')'
    )

    // black box: the observed delay between attempts must grow and then sit at maxBackoffTime.
    // Only lower bounds are asserted - a loaded machine can only make the gaps larger.
    const gaps = server.gaps()
    t.info('gaps between connection attempts: ' + gaps.join('ms, ') + 'ms')
    t.assert(
      gaps[gaps.length - 1] >= gaps[0] * 1.5,
      'the delay between attempts grows (' + gaps[0] + 'ms -> ' + gaps[gaps.length - 1] + 'ms)'
    )
    gaps.slice(-3).forEach((gap) => {
      t.assert(gap >= maxBackoffTime * 0.75, 'the backoff reaches maxBackoffTime, got ' + gap + 'ms')
    })
  })
}

/**
 * The other side of the backoff rule: a connection that completed sync did useful work and must
 * reset the counter. Without this, "always increment" would pass the test above while ruining the
 * recovery time of a healthy deployment that blips.
 *
 * @param {t.TestCase} _tc
 */
export const testSyncedSessionResetsTheBackoff = async (_tc) => {
  await withProvider({
    room: 'reset-backoff',
    policy: syncThenClose(1011, 'restarting')
  }, async (provider, server) => {
    let syncedEvents = 0
    provider.on('sync', (isSynced) => {
      if (isSynced) { syncedEvents++ }
    })
    await until(() => server.connections.length >= 4, 'four connection attempts')
    t.assert(syncedEvents >= 3, 'the connections really did sync (' + syncedEvents + ')')
    // the counter is 0 while connected and 1 right after a close - never more, because every
    // session syncs
    t.assert(
      provider.wsUnsuccessfulReconnects <= 1,
      'a connection that synced resets the backoff (got ' + provider.wsUnsuccessfulReconnects + ')'
    )
    t.assert(provider.shouldConnect === true)
  })
}

/**
 * Everything outside the permanent band keeps reconnecting, exactly as before.
 *
 * @param {t.TestCase} _tc
 */
export const testOrdinaryClosesStillReconnect = async (_tc) => {
  /**
   * @param {string} room
   * @param {function(any, number):void} policy
   * @param {number} expectedCode
   */
  const checkReconnects = async (room, policy, expectedCode) => {
    await withProvider({ room, opts: { maxBackoffTime: 200 }, policy }, async (provider, server) => {
      let closedEvents = 0
      /**
       * @type {Array<number>}
       */
      const codes = []
      provider.on('closed', () => { closedEvents++ })
      provider.on('connection-close', (event) => {
        if (event !== null) { codes.push(event.code) }
      })
      await until(() => server.connections.length >= 3, 'three connection attempts for ' + room)
      t.assert(codes.length > 0, 'the client observed the closes')
      t.assert(codes.every(code => code === expectedCode), 'close code is ' + expectedCode + ' (got ' + codes.join(',') + ')')
      t.compare(closedEvents, 0, expectedCode + ' is never terminal')
      t.assert(provider.shouldConnect === true, 'the provider keeps reconnecting')
    })
  }
  await t.groupAsync('1006 abnormal closure', () => checkReconnects('abnormal-close', terminateSocket, 1006))
  await t.groupAsync('1001 going away', () => checkReconnects('going-away', acceptThenClose(1001, 'going away'), 1001))
  await t.groupAsync('1013 try again later', () => checkReconnects('try-later', acceptThenClose(1013, 'try again later'), 1013))
}

/**
 * The band rule at its boundaries: 4400-4499 is permanent, everything around it - including the
 * 4500-4599 range that servers reserve for transient application errors - is not.
 *
 * @param {t.TestCase} _tc
 */
export const testCloseCodeBandBoundaries = async (_tc) => {
  /**
   * @param {number} code
   * @param {boolean} expectTerminal
   */
  const checkBand = async (code, expectTerminal) => {
    await withProvider({
      room: 'band-' + code,
      opts: { maxBackoffTime: 200 },
      policy: acceptThenClose(code, 'band check')
    }, async (provider, server) => {
      /**
       * @type {Array<{ code: number, reason: string }>}
       */
      const closed = []
      provider.on('closed', (event) => { closed.push(event) })
      if (expectTerminal) {
        await until(() => closed.length > 0, 'a closed event for ' + code)
        await promise.wait(600)
        t.compare(server.connections.length, 1, code + ' must stop the provider')
        t.assert(provider.shouldConnect === false, code + ' must switch shouldConnect off')
      } else {
        await until(() => server.connections.length >= 3, 'reconnects for ' + code)
        t.compare(closed.length, 0, code + ' must not be terminal')
        t.assert(provider.shouldConnect === true, code + ' must keep the provider connecting')
      }
    })
  }
  await t.groupAsync('4399 - below the permanent band', () => checkBand(4399, false))
  await t.groupAsync('4400 - first permanent code', () => checkBand(4400, true))
  await t.groupAsync('4499 - last permanent code', () => checkBand(4499, true))
  await t.groupAsync('4500 - reserved for transient errors', () => checkBand(4500, false))
}

/**
 * A close that we initiated ourselves carries a null event and must never be terminal - neither
 * `provider.disconnect()` nor the "no message received" watchdog is a signal from the server.
 *
 * @param {t.TestCase} _tc
 */
export const testLocalClosesAreNeverTerminal = async (_tc) => {
  await t.groupAsync('explicit disconnect()', async () => {
    /**
     * @type {Array<any>}
     */
    const shouldReconnectCalls = []
    await withProvider({
      room: 'local-disconnect',
      opts: {
        maxBackoffTime: 200,
        shouldReconnect: (event) => {
          shouldReconnectCalls.push(event)
          return true
        }
      },
      policy: holdOpen
    }, async (provider, server) => {
      let closedEvents = 0
      /**
       * @type {Array<any>}
       */
      const connectionCloses = []
      provider.on('closed', () => { closedEvents++ })
      provider.on('connection-close', (event) => { connectionCloses.push(event) })

      await until(() => provider.wsconnected, 'the first connection')
      t.compare(server.connections.length, 1)

      provider.disconnect()

      t.compare(connectionCloses.length, 1, 'disconnect() closes the socket')
      t.assert(connectionCloses[0] === null, 'a local close carries a null event')
      t.compare(shouldReconnectCalls.length, 0, 'shouldReconnect is never consulted for a local close')
      t.compare(closedEvents, 0, 'a local close is never terminal')
      t.assert(provider.shouldConnect === false)
      t.assert(provider.ws === null)

      // the setTimeout(setupWS) that disconnect() schedules must no-op on the shouldConnect guard
      await promise.wait(600)
      t.compare(server.connections.length, 1, 'a disconnected provider stays disconnected')

      provider.connect()
      t.assert(provider.shouldConnect === true)
      t.assert(provider.ws !== null, 'connect() opens a socket synchronously')
      await until(() => provider.wsconnected, 'the reconnection')
      t.compare(server.connections.length, 2, 'connect() after disconnect() works')
      t.compare(closedEvents, 0)
    })
  })

  await t.groupAsync('socket timeout watchdog', async () => {
    /**
     * @type {Array<any>}
     */
    const shouldReconnectCalls = []
    await withProvider({
      room: 'watchdog',
      opts: {
        maxBackoffTime: 200,
        shouldReconnect: (event) => {
          shouldReconnectCalls.push(event)
          return true
        }
      },
      // accept the connection and then say nothing at all, ever
      policy: holdOpen
    }, async (provider, server) => {
      let closedEvents = 0
      /**
       * @type {Array<any>}
       */
      const connectionCloses = []
      provider.on('closed', () => { closedEvents++ })
      provider.on('connection-close', (event) => { connectionCloses.push(event) })

      await until(() => provider.wsconnected, 'the first connection')
      // pretend the last message is ancient, so the watchdog trips on its next tick instead of
      // after the full messageReconnectTimeout
      provider.wsLastMessageReceived = 0
      await until(() => server.connections.length >= 2, 'the watchdog to close and reconnect')

      t.assert(connectionCloses.length >= 1, 'the watchdog closed the socket')
      t.assert(connectionCloses.every(event => event === null), 'every watchdog close carries a null event')
      t.compare(shouldReconnectCalls.length, 0, 'shouldReconnect is never consulted for a watchdog close')
      t.compare(closedEvents, 0, 'a watchdog close is never terminal')
      t.assert(provider.shouldConnect === true, 'the provider reconnects after a watchdog close')
    })
  })
}

/**
 * A terminal close stops the provider but does not tear it down: cross-tab communication keeps
 * running and `connect()` deliberately resumes.
 *
 * @param {t.TestCase} _tc
 */
export const testConnectAfterTerminalClose = async (_tc) => {
  await withProvider({
    room: 'reconnect-after-terminal',
    // bc stays enabled here on purpose: a terminal close does not call disconnectBc(), so this is
    // the only path where connect() re-enters connectBc() with bcconnected === true
    opts: { disableBc: false, maxBackoffTime: 200 },
    // only the first connection is rejected - afterwards the "token" is valid again
    policy: (ws, i) => {
      if (i === 0) { acceptThenClose(4401, 'permission revoked')(ws) }
    }
  }, async (provider, server) => {
    /**
     * @type {Array<{ code: number, reason: string }>}
     */
    const closed = []
    provider.on('closed', (event) => { closed.push(event) })

    await until(() => closed.length > 0, 'the terminal closed event')
    t.compare(closed.length, 1)
    t.compare(closed[0].code, 4401)
    t.assert(provider.shouldConnect === false)
    t.assert(provider.bcconnected === true, 'a terminal close leaves the bc subscription intact')

    provider.connect()

    t.assert(provider.shouldConnect === true, 'connect() re-arms the provider')
    t.assert(provider.bcconnected === true, 'connectBc() does not subscribe twice')
    t.assert(provider.ws !== null, 'connect() opens a socket synchronously')

    await until(() => provider.wsconnected, 'the reconnection')
    t.compare(server.connections.length, 2, 'exactly one new connection')
    t.compare(closed.length, 1, 'no second closed event')

    await promise.wait(600)
    t.assert(provider.wsconnected === true, 'the connection stays up')
    t.compare(server.connections.length, 2, 'no stray reconnect from the old backoff timer')
  })
}

/**
 * `closed` is emitted after the provider state has been reset, so that the documented
 * "re-authenticate and reconnect" idiom works from inside the handler.
 *
 * @param {t.TestCase} _tc
 */
export const testConnectFromWithinTheClosedHandler = async (_tc) => {
  await withProvider({
    room: 'reconnect-from-handler',
    opts: { maxBackoffTime: 200 },
    policy: (ws, i) => {
      if (i === 0) { acceptThenClose(4401, 'permission revoked')(ws) }
    }
  }, async (provider, server) => {
    /**
     * Snapshots taken inside the handler. Never assert in a provider event handler: ObservableV2
     * does not guard callbacks, so a thrown TestError unwinds through ws's dispatcher and kills
     * the process instead of failing the test.
     *
     * @type {Array<{ wsBefore: any, wsconnectedBefore: boolean, wsAfter: any }>}
     */
    const observed = []
    provider.on('closed', () => {
      const wsBefore = provider.ws
      const wsconnectedBefore = provider.wsconnected
      provider.connect()
      observed.push({ wsBefore, wsconnectedBefore, wsAfter: provider.ws })
    })

    await until(() => observed.length > 0, 'the closed event')
    t.assert(observed[0].wsBefore === null, 'closed is emitted after provider.ws has been cleared')
    t.assert(observed[0].wsconnectedBefore === false, 'closed is emitted after wsconnected has been cleared')
    t.assert(observed[0].wsAfter !== null, 'connect() from inside the closed handler opens a socket immediately')

    await until(() => provider.wsconnected, 'the reconnection')
    t.compare(server.connections.length, 2)
    await promise.wait(600)
    t.compare(observed.length, 1, 'closed fired exactly once')
    t.compare(server.connections.length, 2, 'the timer scheduled by the terminal close must not open a third socket')
  })
}

/**
 * Closing a socket that is still CONNECTING is reported by nodejs' `ws` as an error event, not as
 * a thrown exception - and an error event without a listener is rethrown as an uncaught exception.
 * `provider.disconnect()` / `provider.destroy()` during connect must not kill the process.
 *
 * @param {t.TestCase} _tc
 */
export const testDisconnectWhileConnecting = async (_tc) => {
  const server = await createTestServer(holdOpen)
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(server.url, 'disconnect-while-connecting', doc, {
    WebSocketPolyfill: /** @type {any} */ (WebSocket),
    disableBc: true,
    maxBackoffTime: 200
  })
  try {
    // we are still in the tick that created the socket, so it cannot be open yet
    t.assert(provider.wsconnected === false, 'the socket is still connecting')
    provider.disconnect()
    await promise.wait(300)
    t.assert(provider.ws === null, 'the provider survived closing a connecting socket')

    provider.connect()
    await until(() => provider.wsconnected, 'a reconnection after the aborted connect')
    t.assert(provider.wsconnected, 'the provider still works afterwards')
  } finally {
    provider.destroy()
    doc.destroy()
    await server.destroy()
  }

  // the same thing via destroy(), which is what an unmounting component does
  const server2 = await createTestServer(holdOpen)
  const doc2 = new Y.Doc()
  const provider2 = new WebsocketProvider(server2.url, 'destroy-while-connecting', doc2, {
    WebSocketPolyfill: /** @type {any} */ (WebSocket),
    disableBc: true
  })
  provider2.destroy()
  doc2.destroy()
  await promise.wait(300)
  t.assert(provider2.ws === null, 'destroy() during connect is safe too')
  await server2.destroy()
}
