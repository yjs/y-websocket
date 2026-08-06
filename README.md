# y-websocket :tophat:
> WebSocket Provider for Yjs

The Websocket Provider implements a classical client server model. Clients
connect to a single endpoint over Websocket. The server distributes awareness
information and document updates among clients.

This repository contains a simple in-memory backend that can persist to
databases, but it can't be scaled easily. The
[y-redis](https://github.com/yjs/y-redis/) repository contains an alternative
backend that is scalable, provides auth*, and can persist to different backends.

The Websocket Provider is a solid choice if you want a central source that
handles authentication and authorization. Websockets also send header
information and cookies, so you can use existing authentication mechanisms with
this server.

* Supports cross-tab communication. When you open the same document in the same
browser, changes on the document are exchanged via cross-tab communication
([Broadcast
Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
and
[localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
as fallback).
* Supports exchange of awareness information (e.g. cursors).

## Quick Start

### Install dependencies

```sh
npm i y-websocket
```

### Start a y-websocket server

There are multiple y-websocket compatible backends for `y-websocket`: 

* [@y/websocket-server](https://github.com/yjs/y-websocket-server/)
* hocuspocus
- y-sweet
- y-redis
- ypy-websocket
- pycrdt-websocket
- [yrs-warp](https://github.com/y-crdt/yrs-warp)
- ...

The fastest way to get started is to run the [@y/websocket-server](https://github.com/yjs/y-websocket-server/)
backend. This package was previously included in y-websocket and now lives in a
forkable repository.

Install and start y-websocket-server:

```sh
npm install @y/websocket-server
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
  // Specify a query-string / url parameters that will be url-encoded and attached to the `serverUrl`
  // I.e. params = { auth: "bearer" } will be transformed to "?auth=bearer"
  params: {}, // Object<string,string>
  // You may polyill the Websocket object (https://developer.mozilla.org/en-US/docs/Web/API/WebSocket).
  // E.g. In nodejs, you could specify WebsocketPolyfill = require('ws')
  WebsocketPolyfill: Websocket,
  // Specify an existing Awareness instance - see https://github.com/yjs/y-protocols
  awareness: new awarenessProtocol.Awareness(ydoc),
  // Specify the maximum amount to wait between reconnects (we use exponential backoff).
  maxBackoffTime: 2500,
  // Decide whether to reconnect after the *server* closed the connection. By default, close
  // codes in the 4400-4499 range are permanent: the provider stops reconnecting and fires the
  // `closed` event. See "Close codes & reconnecting" below.
  // This is never called when you close the connection yourself (e.g. wsProvider.disconnect()).
  shouldReconnect: (event, provider) => !(event.code >= 4400 && event.code < 4500)
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
  <b><code>wsProvider.params : boolean</code></b>
  <dd>The specified url parameters. This can be safely updated, the new values
    will be used when a new connction is established. If this contains an
    auth token, it should be updated regularly.</dd>
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
  <b><code>wsProvider.on('closed', function({ code: number, reason: string }, provider))</code></b>
  <dd>Fires when the server closed the connection and <code>shouldReconnect</code> returned false.
    The provider stops reconnecting (<code>shouldConnect</code> becomes false) but is <em>not</em>
    destroyed: cross-tab communication keeps running, and you may resume deliberately with
    <code>wsProvider.connect()</code> or clean up with <code>wsProvider.destroy()</code>. Unlike
    <code>connection-close</code>, which fires on every blip, this fires only when the server told
    you to go away - and why.</dd>
  <b><code>wsProvider.on('connection-error', function(WSErrorEvent))</code></b>
  <dd>Fires when the underlying websocket connection closes with an error. It forwards the websocket event to this event handler.</dd>
</dl>

## Close Codes & Reconnecting

The provider reconnects automatically after every disconnect, backing off exponentially up to
`maxBackoffTime`. But some disconnects are not worth retrying: the permission to access the
document was revoked, or the document doesn't exist anymore. A server signals this with the
websocket **close code**.

By convention the private-use range (`4000`-`4999`, reserved for applications by
[RFC 6455](https://www.rfc-editor.org/rfc/rfc6455#section-7.4.2)) is split so that a client can
classify a close code it has never seen before:

| Close code | Meaning | Reconnect? |
|---|---|---|
| `4400`-`4499` | **permanent** - retrying returns the same result until the app acts | no |
| `4500`-`4599` | **transient** - the matching "try again later" range | yes |
| everything else | transient - `1006` abnormal closure, `1011` internal error, `1013` try again later, ... | yes |

The band is normative; the trailing digits are only an HTTP mnemonic. A retryable rate-limit close
is `45xx`, never `4429`.

`shouldReconnect` implements exactly this rule by default. Override it to opt out entirely, or to
classify codes your backend uses differently:

```js
const wsProvider = new WebsocketProvider('ws://localhost:1234', 'my-roomname', doc, {
  // never give up
  shouldReconnect: () => true
})

wsProvider.on('closed', ({ code, reason }) => {
  console.log(`the server closed us for good: ${code} ${reason}`)
  // the provider is idle, not destroyed - resume deliberately once the cause is fixed
  // await refreshToken()
  // wsProvider.connect()
})
```

> **Breaking change:** previous versions reconnected after *every* close, regardless of the close
> code. Pass `shouldReconnect: () => true` to restore that behavior.

### Signalling a permanent error from the server

Rejecting the HTTP upgrade (`401`, `403`, ...) does **not** work: browsers deliberately hide the
upgrade status from the WebSocket API, so the client only sees an opaque `1006` with no code and no
reason - and keeps retrying. To tell the client *why*, accept the upgrade and then close the socket:

```js
ws.close(4401, 'permission revoked')
```

[`@y/hub`](https://github.com/yjs/yhub) documents a worked example of this scheme.

## License

[The MIT License](./LICENSE) © Kevin Jahns
