import * as ywebsocket from './y-websocket.test.js'

import { runTests } from 'lib0/testing'
import { isNode } from 'lib0/environment'

runTests({
  ywebsocket
}).then(success => {
  /* istanbul ignore next */
  if (isNode) {
    // every close schedules a `setupWS` timer that outlives the test that created it, so exit
    // explicitly instead of waiting for the event loop to drain
    process.exit(success ? 0 : 1)
  }
})
