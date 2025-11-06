# Connection Adapters

Connection adapters provide a flexible way to use different transport mechanisms with y-websocket, allowing you to integrate with various real-time communication systems beyond standard WebSocket connections.

## Overview

By default, y-websocket uses a standard WebSocket connection. However, you can now use different adapters to connect through:

- **WebSocket** (default) - Standard WebSocket protocol
- **Laravel Echo** - Laravel's broadcasting system with Presence Channels
- **Custom adapters** - Create your own adapter for any transport mechanism

## Available Adapters

### 1. WebSocketAdapter (Default)

The default adapter that provides standard WebSocket connectivity. This is used automatically when no adapter is specified.

```javascript
import * as Y from 'yjs'
import { WebsocketProvider } from '@y/websocket'

const doc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc)
```

You can also explicitly use the WebSocketAdapter:

```javascript
import * as Y from 'yjs'
import { WebsocketProvider } from '@y/websocket'
import { WebSocketAdapter } from '@y/websocket/src/adapters'

const doc = new Y.Doc()
const adapter = new WebSocketAdapter(WebSocket)
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc, {
  adapter: adapter
})
```

### 2. LaravelEchoAdapter

The Laravel Echo adapter allows you to use Laravel's broadcasting system with Presence Channels for real-time collaboration.

```javascript
import Echo from 'laravel-echo'
import Pusher from 'pusher-js'
import * as Y from 'yjs'
import { WebsocketProvider } from '@y/websocket'
import { LaravelEchoAdapter } from '@y/websocket/src/adapters'

// Setup Laravel Echo
window.Pusher = Pusher

const echo = new Echo({
  broadcaster: 'pusher',
  key: process.env.PUSHER_APP_KEY,
  cluster: process.env.PUSHER_APP_CLUSTER,
  forceTLS: true,
  authEndpoint: '/broadcasting/auth'
})

// Create Yjs document
const doc = new Y.Doc()

// Create Laravel Echo adapter
const adapter = new LaravelEchoAdapter(echo, 'document.123')

// Create provider with adapter
const provider = new WebsocketProvider(null, null, doc, {
  adapter: adapter,
  connect: true
})
```

**Note:** When using LaravelEchoAdapter, you can pass `null` for both `serverUrl` and `roomname` since the channel name is specified in the adapter constructor.

#### LaravelEchoAdapter Options

```javascript
const adapter = new LaravelEchoAdapter(echo, channelName, {
  messageEvent: 'yjs-message',      // Event name for Yjs messages (default)
  awarenessEvent: 'yjs-awareness'   // Event name for awareness updates (default)
})
```

### 3. Custom Adapters

You can create your own adapter by extending the `BaseAdapter` class:

```javascript
import { BaseAdapter } from '@y/websocket/src/adapters'

class MyCustomAdapter extends BaseAdapter {
  constructor(options) {
    super()
    this.options = options
    this._readyState = BaseAdapter.CLOSED
  }

  connect(url, protocols) {
    this._readyState = BaseAdapter.CONNECTING

    // Your connection logic here
    // When connected:
    this._readyState = BaseAdapter.OPEN
    if (this.onopen) {
      this.onopen({ type: 'open' })
    }
  }

  send(data) {
    if (this._readyState !== BaseAdapter.OPEN) {
      return
    }

    // Your send logic here
    // data is a Uint8Array or ArrayBuffer
  }

  close() {
    // Your cleanup logic here
    this._readyState = BaseAdapter.CLOSED
    if (this.onclose) {
      this.onclose({ type: 'close' })
    }
  }

  get readyState() {
    return this._readyState
  }
}

// Usage
const adapter = new MyCustomAdapter({ /* your options */ })
const provider = new WebsocketProvider(null, null, doc, {
  adapter: adapter
})
```

## Adapter Interface

All adapters must implement the following interface:

### Properties

- `onopen`: Callback function called when connection opens
- `onmessage`: Callback function called when a message is received
  - Receives an object with `{ type: 'message', data: ArrayBuffer }`
- `onerror`: Callback function called when an error occurs
- `onclose`: Callback function called when connection closes
- `readyState`: Current connection state (0-3)

### Methods

- `connect(url, protocols)`: Establish connection
- `send(data)`: Send binary data (Uint8Array or ArrayBuffer)
- `close()`: Close the connection

### Connection States

```javascript
BaseAdapter.CONNECTING = 0  // Connection is being established
BaseAdapter.OPEN = 1        // Connection is open and ready
BaseAdapter.CLOSING = 2     // Connection is being closed
BaseAdapter.CLOSED = 3      // Connection is closed
```

## Benefits of Adapters

1. **Flexibility**: Use any transport mechanism (WebSocket, HTTP polling, WebRTC, etc.)
2. **Integration**: Integrate with existing infrastructure (Laravel, Socket.io, Firebase, etc.)
3. **Authentication**: Leverage existing authentication systems
4. **Scalability**: Use managed services like Pusher, Ably, or custom solutions
5. **Security**: Utilize platform-specific security features

## Migration Guide

### From Standard WebSocket to Adapter

**Before (pre-adapter):**
```javascript
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc)
```

**After (with adapter - backward compatible):**
```javascript
// Still works exactly the same way!
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc)

// Or explicitly use adapter:
const adapter = new WebSocketAdapter()
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc, {
  adapter: adapter
})
```

**Migration to Laravel Echo:**
```javascript
const adapter = new LaravelEchoAdapter(echo, 'document.123')
const provider = new WebsocketProvider(null, null, doc, {
  adapter: adapter
})
```

## Backward Compatibility

All existing code continues to work without any changes. The adapter pattern is an opt-in feature that extends functionality without breaking existing implementations.

## See Also

- [Laravel Echo Integration Guide](./laravel-echo.md)
- [Creating Custom Adapters](./custom-adapters.md)
