
# y-websocket :tophat:
> WebSocket Provider for Yjs

The Websocket Provider implements a classical client server model. Clients connect to a single endpoint over Websocket. The server distributes awareness information and document updates among clients.

The Websocket Provider is a solid choice if you want a central source that handles authentication and authorization. Websockets also send header information and cookies, so you can use existing authentication mechanisms with this server.

* Supports cross-tab communication. When you open the same document in the same browser, changes on the document are exchanged via cross-tab communication ([Broadcast Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) and [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) as fallback).
* Supports exchange of awareness information (e.g. cursors).

## Quick Start

### Install dependencies

```sh
npm i y-websocket
```

### Start a y-websocket server

This repository implements a basic server that you can adopt to your specific use-case. [(source code)](./bin/)

Start a y-websocket server:

```sh
HOST=localhost PORT=1234 npx y-websocket
```

### Client Code:

```js
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc = new Y.Doc()
const wsProvider = new WebsocketProvider('ws://localhost:1234', 'my-roomname', doc)

wsProvider.on('status', event => {
  console.log(event.status) // logs "connected" or "disconnected"
})
```

#### Client Code in Node.js

The WebSocket provider requires a [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) object to create connection to a server. You can polyfill WebSocket support in Node.js using the [`ws` package](https://www.npmjs.com/package/ws).

```js
const wsProvider = new WebsocketProvider('ws://localhost:1234', 'my-roomname', doc, { WebSocketPolyfill: require('ws') })
```

## API

```js
import { WebsocketProvider } from 'y-websocket'
```

<dl>
  <b><code>wsProvider = new WebsocketProvider(serverUrl: string, room: string, ydoc: Y.Doc [, wsOpts: WsOpts])</code></b>
  <dd>Create a new websocket-provider instance. As long as this provider, or the connected ydoc, is not destroyed, the changes will be synced to other clients via the connected server. Optionally, you may specify a configuration object. The following default values of wsOpts can be overwritten. </dd>
</dl>

```js
wsOpts = {
  // Set this to `false` if you want to connect manually using wsProvider.connect()
  connect: true,
  // Specify a query-string that will be url-encoded and attached to the `serverUrl`
  // I.e. params = { auth: "bearer" } will be transformed to "?auth=bearer"
  params: {}, // Object<string,string>
  // You may polyill the Websocket object (https://developer.mozilla.org/en-US/docs/Web/API/WebSocket).
  // E.g. In nodejs, you could specify WebsocketPolyfill = require('ws')
  WebsocketPolyfill: Websocket,
  // Specify an existing Awareness instance - see https://github.com/yjs/y-protocols
  awareness: new awarenessProtocol.Awareness(ydoc),
  // Specify the maximum amount to wait between reconnects (we use exponential backoff).
  maxBackoffTime: 2500
}
```

<dl>
  <b><code>wsProvider.wsconnected: boolean</code></b>
  <dd>True if this instance is currently connected to the server.</dd>
  <b><code>wsProvider.wsconnecting: boolean</code></b>
  <dd>True if this instance is currently connecting to the server.</dd>
  <b><code>wsProvider.shouldConnect: boolean</code></b>
  <dd>If false, the client will not try to reconnect.</dd>
  <b><code>wsProvider.bcconnected: boolean</code></b>
  <dd>True if this instance is currently communicating to other browser-windows via BroadcastChannel.</dd>
  <b><code>wsProvider.synced: boolean</code></b>
  <dd>True if this instance is currently connected and synced with the server.</dd>
  <b><code>wsProvider.disconnect()</code></b>
  <dd>Disconnect from the server and don't try to reconnect.</dd>
  <b><code>wsProvider.connect()</code></b>
  <dd>Establish a websocket connection to the websocket-server. Call this if you recently disconnected or if you set wsOpts.connect = false.</dd>
  <b><code>wsProvider.destroy()</code></b>
  <dd>Destroy this wsProvider instance. Disconnects from the server and removes all event handlers.</dd>
  <b><code>wsProvider.on('sync', function(isSynced: boolean))</code></b>
  <dd>Add an event listener for the sync event that is fired when the client received content from the server.</dd>
  <b><code>wsProvider.on('status', function({ status: 'disconnected' | 'connecting' | 'connected' }))</code></b>
  <dd>Receive updates about the current connection status.</dd>
  <b><code>wsProvider.on('connection-close', function(WSClosedEvent))</code></b>
  <dd>Fires when the underlying websocket connection is closed. It forwards the websocket event to this event handler.</dd>
  <b><code>wsProvider.on('connection-error', function(WSErrorEvent))</code></b>
  <dd>Fires when the underlying websocket connection closes with an error. It forwards the websocket event to this event handler.</dd>
</dl>

## Websocket Server

Start a y-websocket server:

```sh
HOST=localhost PORT=1234 npx y-websocket
```

Since npm symlinks the `y-websocket` executable from your local `./node_modules/.bin` folder, you can simply run npx. The `PORT` environment variable already defaults to 1234, and `HOST` defaults to `localhost`.

### Websocket Server with Persistence

Persist document updates in a LevelDB database.

See [LevelDB Persistence](https://github.com/yjs/y-leveldb) for more info.

```sh
HOST=localhost PORT=1234 YPERSISTENCE=./dbDir node ./node_modules/y-websocket/bin/server.js
```

### Websocket Server with HTTP callback

Send a debounced callback to an HTTP server (`POST`) on document update. Note that this implementation doesn't implement a retry logic in case the `CALLBACK_URL` does not work.

Can take the following ENV variables:

* `CALLBACK_URL` : Callback server URL
* `CALLBACK_DEBOUNCE_WAIT` : Debounce time between callbacks (in ms). Defaults to 2000 ms
* `CALLBACK_DEBOUNCE_MAXWAIT` : Maximum time to wait before callback. Defaults to 10 seconds
* `CALLBACK_TIMEOUT` : Timeout for the HTTP call. Defaults to 5 seconds
* `CALLBACK_OBJECTS` : JSON of shared objects to get data (`'{"SHARED_OBJECT_NAME":"SHARED_OBJECT_TYPE}'`)

```sh
CALLBACK_URL=http://localhost:3000/ CALLBACK_OBJECTS='{"prosemirror":"XmlFragment"}' npm start
```
This sends a debounced callback to `localhost:3000` 2 seconds after receiving an update (default `DEBOUNCE_WAIT`) with the data of an XmlFragment named `"prosemirror"` in the body.

## License

[The MIT License](./LICENSE) © Kevin Jahns
