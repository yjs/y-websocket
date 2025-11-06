# Laravel Echo Integration Guide

This guide shows you how to integrate y-websocket with Laravel's broadcasting system using Laravel Echo and Presence Channels.

## Overview

Laravel Echo provides an elegant way to work with WebSockets and broadcasting in Laravel applications. The `LaravelEchoAdapter` allows you to use Yjs collaborative editing with Laravel's broadcasting infrastructure.

## Prerequisites

- Laravel application with broadcasting configured
- Pusher, Ably, or Socket.io as your broadcast driver
- Laravel Echo installed on the frontend
- Basic understanding of Laravel broadcasting and Presence Channels

## Frontend Setup

### 1. Install Dependencies

```bash
npm install yjs @y/websocket laravel-echo pusher-js
```

### 2. Configure Laravel Echo

```javascript
import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

window.Pusher = Pusher

const echo = new Echo({
  broadcaster: 'pusher',
  key: process.env.MIX_PUSHER_APP_KEY,
  cluster: process.env.MIX_PUSHER_APP_CLUSTER,
  forceTLS: true,
  authEndpoint: '/broadcasting/auth',
  auth: {
    headers: {
      'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
    }
  }
})

export default echo
```

### 3. Setup Yjs with Laravel Echo Adapter

```javascript
import * as Y from 'yjs'
import { WebsocketProvider } from '@y/websocket'
import { LaravelEchoAdapter } from '@y/websocket/src/adapters'
import echo from './echo'

// Create Yjs document
const doc = new Y.Doc()

// Define the channel name (must be a Presence Channel)
const channelName = 'document.' + documentId

// Create adapter
const adapter = new LaravelEchoAdapter(echo, channelName)

// Create provider
const provider = new WebsocketProvider(null, null, doc, {
  adapter: adapter,
  connect: true
})

// Listen to connection status
provider.on('status', ({ status }) => {
  console.log('Connection status:', status)
})

provider.on('sync', (isSynced) => {
  console.log('Document synced:', isSynced)
})

// Now you can use the doc with any Yjs binding (e.g., y-quill, y-monaco, y-prosemirror)
```

## Backend Setup (Laravel)

### 1. Create Presence Channel Route

In `routes/channels.php`:

```php
<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('document.{documentId}', function ($user, $documentId) {
    // Authorization logic
    // Return user data if authorized, false otherwise

    $document = \App\Models\Document::find($documentId);

    if (!$document || !$user->can('edit', $document)) {
        return false;
    }

    return [
        'id' => $user->id,
        'name' => $user->name,
        'email' => $user->email,
    ];
});
```

### 2. Create Event for Broadcasting Yjs Messages

```bash
php artisan make:event YjsMessageEvent
```

In `app/Events/YjsMessageEvent.php`:

```php
<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class YjsMessageEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $data;
    public $documentId;

    public function __construct($documentId, $data)
    {
        $this->documentId = $documentId;
        $this->data = $data;
    }

    public function broadcastOn()
    {
        return new PresenceChannel('document.' . $this->documentId);
    }

    public function broadcastAs()
    {
        return 'yjs-message';
    }

    public function broadcastWith()
    {
        return ['data' => $this->data];
    }
}
```

### 3. Create Controller to Handle Messages

```bash
php artisan make:controller YjsController
```

In `app/Http/Controllers/YjsController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Events\YjsMessageEvent;
use Illuminate\Http\Request;

class YjsController extends Controller
{
    public function handleMessage(Request $request, $documentId)
    {
        // Validate that user can edit this document
        $document = \App\Models\Document::findOrFail($documentId);
        $this->authorize('edit', $document);

        // Get the base64 encoded Yjs message
        $data = $request->input('data');

        // Broadcast to all other users in the presence channel
        broadcast(new YjsMessageEvent($documentId, $data))->toOthers();

        return response()->json(['status' => 'success']);
    }
}
```

### 4. Add API Routes

In `routes/api.php`:

```php
use App\Http\Controllers\YjsController;

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/documents/{documentId}/yjs-message', [YjsController::class, 'handleMessage']);
});
```

### 5. Configure Broadcasting Driver

In `.env`:

```env
BROADCAST_DRIVER=pusher

PUSHER_APP_ID=your_app_id
PUSHER_APP_KEY=your_app_key
PUSHER_APP_SECRET=your_app_secret
PUSHER_APP_CLUSTER=your_cluster
```

## Advanced Configuration

### Using Client Events (Whisper)

Laravel Echo supports client events (whisper) which can reduce server load by sending messages directly between clients. However, this requires Pusher's client events to be enabled.

The `LaravelEchoAdapter` uses whisper by default. To make it work:

1. **Enable client events in Pusher dashboard**
2. **Update the adapter to use whisper** (already done by default)

### Persistence

To persist the Yjs document state in Laravel:

```php
<?php

namespace App\Http\Controllers;

use App\Models\Document;
use Illuminate\Http\Request;

class DocumentController extends Controller
{
    public function getState($documentId)
    {
        $document = Document::findOrFail($documentId);
        $this->authorize('view', $document);

        return response()->json([
            'state' => $document->yjs_state // base64 encoded state vector
        ]);
    }

    public function saveState(Request $request, $documentId)
    {
        $document = Document::findOrFail($documentId);
        $this->authorize('edit', $document);

        $document->yjs_state = $request->input('state');
        $document->save();

        return response()->json(['status' => 'success']);
    }
}
```

On the frontend, load and save state:

```javascript
import * as Y from 'yjs'

// Load initial state
const response = await fetch(`/api/documents/${documentId}/state`)
const { state } = await response.json()

if (state) {
  const stateVector = Uint8Array.from(atob(state), c => c.charCodeAt(0))
  Y.applyUpdate(doc, stateVector)
}

// Save state periodically
setInterval(async () => {
  const state = Y.encodeStateAsUpdate(doc)
  const base64 = btoa(String.fromCharCode.apply(null, state))

  await fetch(`/api/documents/${documentId}/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken
    },
    body: JSON.stringify({ state: base64 })
  })
}, 30000) // Save every 30 seconds
```

### Database Schema

Add a migration for storing Yjs state:

```bash
php artisan make:migration add_yjs_state_to_documents_table
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->longText('yjs_state')->nullable();
            $table->timestamp('yjs_state_updated_at')->nullable();
        });
    }

    public function down()
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn(['yjs_state', 'yjs_state_updated_at']);
        });
    }
};
```

## Complete Example

### Frontend (React/Vue/Vanilla JS)

```javascript
import * as Y from 'yjs'
import { WebsocketProvider } from '@y/websocket'
import { LaravelEchoAdapter } from '@y/websocket/src/adapters'
import echo from './echo'

class CollaborativeEditor {
  constructor(documentId) {
    this.documentId = documentId
    this.doc = new Y.Doc()
    this.provider = null

    this.initProvider()
    this.loadInitialState()
    this.setupAutoSave()
  }

  initProvider() {
    const adapter = new LaravelEchoAdapter(
      echo,
      `document.${this.documentId}`
    )

    this.provider = new WebsocketProvider(null, null, this.doc, {
      adapter: adapter,
      connect: true
    })

    this.provider.on('status', ({ status }) => {
      console.log('Status:', status)
    })

    this.provider.on('sync', (isSynced) => {
      console.log('Synced:', isSynced)
    })
  }

  async loadInitialState() {
    try {
      const response = await fetch(`/api/documents/${this.documentId}/state`)
      const { state } = await response.json()

      if (state) {
        const stateVector = Uint8Array.from(atob(state), c => c.charCodeAt(0))
        Y.applyUpdate(this.doc, stateVector)
      }
    } catch (error) {
      console.error('Failed to load initial state:', error)
    }
  }

  setupAutoSave() {
    setInterval(() => this.saveState(), 30000)
  }

  async saveState() {
    try {
      const state = Y.encodeStateAsUpdate(this.doc)
      const base64 = btoa(String.fromCharCode.apply(null, state))

      await fetch(`/api/documents/${this.documentId}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
        },
        body: JSON.stringify({ state: base64 })
      })
    } catch (error) {
      console.error('Failed to save state:', error)
    }
  }

  destroy() {
    this.provider.destroy()
  }
}

// Usage
const editor = new CollaborativeEditor(123)

// Integrate with your editor (Quill, Monaco, ProseMirror, etc.)
// const ytext = editor.doc.getText('content')
```

## Troubleshooting

### Connection Issues

1. **Echo not connecting**: Check your broadcasting configuration and ensure the auth endpoint is correct
2. **Presence channel authorization fails**: Verify your `routes/channels.php` authorization logic
3. **Messages not broadcasting**: Ensure queue workers are running if using queued broadcasts

### Performance

1. **Too many broadcasts**: Consider batching updates or implementing debouncing
2. **Large documents**: Implement incremental updates and persistence
3. **Rate limiting**: Configure appropriate rate limits in your Laravel application

### Security

1. **Always authorize users** in your presence channel
2. **Validate incoming data** in your controller
3. **Use CSRF protection** for all API calls
4. **Implement rate limiting** to prevent abuse

## Alternatives to Pusher

### Using Socket.io

```javascript
const echo = new Echo({
  broadcaster: 'socket.io',
  host: window.location.hostname + ':6001'
})
```

### Using Ably

```javascript
const echo = new Echo({
  broadcaster: 'pusher',
  key: process.env.MIX_ABLY_PUBLIC_KEY,
  wsHost: 'realtime-pusher.ably.io',
  wsPort: 443,
  disableStats: true,
  encrypted: true
})
```

## Resources

- [Laravel Broadcasting Documentation](https://laravel.com/docs/broadcasting)
- [Laravel Echo Documentation](https://github.com/laravel/echo)
- [Yjs Documentation](https://docs.yjs.dev/)
- [Pusher Channels Documentation](https://pusher.com/docs/channels/)
