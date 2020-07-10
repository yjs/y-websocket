
### Websocket Provider

The Websocket Provider implements a classical client server model. Clients connect to a single endpoint over Websocket. The server distributes awareness information and document updates among clients.

The Websocket Provider is a solid choice if you want a central source that handles authentication and authorization. Websockets also send header information and cookies, so you can use existing authentication mechanisms with this server.

* Supports cross-tab communication. When you open the same document in the same browser, changes on the document are exchanged via cross-tab communication ([Broadcast Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) and [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) as fallback).
* Supports exchange of awareness information (e.g. cursors).

##### Client Code:

```js
import * as Y from 'yjs'
import { WebsocketProvider } from 'yjs/provider/websocket.js'

const doc = new Y.Doc()
const wsProvider = new WebsocketProvider('ws://localhost:1234', 'my-roomname', doc)

wsProvider.on('status', event => {
  console.log(event.status) // logs "connected" or "disconnected"
})
```

##### Start a Websocket Server:

```sh
PORT=1234 npx y-websocket-server
```

Since npm symlinks the `y-websocket-server` executable from your local `./node_modules/.bin` folder, you can simply run npx. The `PORT` environment variable already defaults to 1234.

**Websocket Server with Persistence**

Persist document updates in a LevelDB database.

See [LevelDB Persistence](https://github.com/yjs/y-leveldb) for more info.

```sh
PORT=1234 YPERSISTENCE=./dbDir node ./node_modules/y-websocket/bin/server.js
```

### Scaling

These are mere suggestions how you could scale your server environment.

**Option 1:** Websocket servers communicate with each other via a PubSub server. A room is represented by a PubSub channel. The downside of this approach is that the same shared document may be handled by many servers. But the upside is that this approach is fault tolerant, does not have a single point of failure, and is fit for route balancing.

**Option 2:** Sharding with *consistent hashing*. Each document is handled by a unique server. This pattern requires an entity, like etcd, that performs regular health checks and manages servers. Based on the list of available servers (which is managed by etcd) a proxy calculates which server is responsible for each requested document. The disadvantage of this approach is that load distribution may not be fair. Still, this approach may be the preferred solution if you want to store the shared document in a database - e.g. for indexing.

### License

[The MIT License](./LICENSE) © Kevin Jahns
