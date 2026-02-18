import * as Y from '@y/y'
import * as promise from 'lib0/promise'
import * as t from 'lib0/testing'
import '@y/websocket-server/server'
import { WebsocketProvider } from '@y/websocket'

export const testConnection = async () => {
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider('ws://localhost:1234', 'test-@y/websocket', ydoc)
  const syncStatusEvents = []
  provider.on('sync', (isSynced) => {
    console.log({ isSynced })
  })
  provider.on('sync-status', syncStatus => {
    console.log('received sync status', syncStatus)
    syncStatusEvents.push(syncStatus)
  })
  await promise.wait(500)
  t.assert(syncStatusEvents.length > 0)
  t.assert(syncStatusEvents[syncStatusEvents.length - 1].status === 'green')
  debugger
  ydoc.get().insert(0, 'hi')
  t.compare(provider.syncStatus.status, 'yellow')
  await promise.wait(500)
  t.compare(provider.syncStatus.status, 'green')

}

