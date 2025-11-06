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
php artisan make:event YjsMessage
```

In `app/Events/YjsMessage.php`:

```php
<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class YjsMessage implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $data;
    public $documentId;
    public $senderId;

    public function __construct($documentId, $data, $senderId = null)
    {
        $this->documentId = $documentId;
        $this->data = $data;
        $this->senderId = $senderId;
    }

    public function broadcastOn()
    {
        return new PresenceChannel('document.' . $this->documentId);
    }

    public function broadcastAs()
    {
        return 'YjsMessage';
    }

    public function broadcastWith()
    {
        return ['data' => $this->data];
    }
}
```

### 3. Create Webhook Controller to Handle Client Events

When using `send_event()`, Pusher sends the data to your Laravel backend as a webhook. You need to create a webhook handler to process and broadcast these messages.

```bash
php artisan make:controller PusherWebhookController
```

In `app/Http/Controllers/PusherWebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Events\YjsMessage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class PusherWebhookController extends Controller
{
    public function handleWebhook(Request $request)
    {
        // Validate the webhook signature (important for security)
        if (!$this->isValidSignature($request)) {
            return response()->json(['error' => 'Invalid signature'], 403);
        }

        // Get all events from the webhook
        $events = $request->input('events', []);

        foreach ($events as $event) {
            if ($event['name'] === 'client-YjsMessage') {
                $this->handleYjsMessage($event);
            }
        }

        return response()->json(['status' => 'success']);
    }

    protected function handleYjsMessage($event)
    {
        // Extract channel name and data
        $channelName = $event['channel'];
        $data = json_decode($event['data'], true);

        // Extract document ID from channel name (e.g., 'presence-document.123' -> '123')
        if (preg_match('/presence-document\.(\d+)/', $channelName, $matches)) {
            $documentId = $matches[1];

            // Optional: Validate user permissions here if needed
            // $userId = $event['user_id'] ?? null;

            // Broadcast to all users in the channel
            broadcast(new YjsMessage($documentId, $data['data'] ?? ''));
        }
    }

    protected function isValidSignature(Request $request)
    {
        $expectedSignature = hash_hmac(
            'sha256',
            $request->getContent(),
            config('broadcasting.connections.pusher.secret')
        );

        $providedSignature = $request->header('X-Pusher-Signature');

        return hash_equals($expectedSignature, $providedSignature);
    }
}
```

### 4. Add Webhook Route

In `routes/api.php` or `routes/web.php`:

```php
use App\Http\Controllers\PusherWebhookController;

// Pusher webhook endpoint (no authentication needed, verified by signature)
Route::post('/pusher/webhook', [PusherWebhookController::class, 'handleWebhook']);
```

**Important:** Make sure to exclude this route from CSRF protection in `app/Http/Middleware/VerifyCsrfToken.php`:

```php
protected $except = [
    'pusher/webhook',
];
```

### 5. Configure Broadcasting Driver and Webhook

In `.env`:

```env
BROADCAST_DRIVER=pusher

PUSHER_APP_ID=your_app_id
PUSHER_APP_KEY=your_app_key
PUSHER_APP_SECRET=your_app_secret
PUSHER_APP_CLUSTER=your_cluster
```

### 6. Enable Client Events in Pusher

1. Go to your Pusher dashboard
2. Select your app
3. Go to "App Settings"
4. Enable "Client Events"
5. Add your webhook URL (e.g., `https://yourdomain.com/api/pusher/webhook`)

**Note:** Client events must be enabled for `send_event()` to work. The webhook allows your Laravel backend to receive, validate, and broadcast these events.

## Advanced Configuration

### How It Works

The LaravelEchoAdapter uses Pusher's `send_event()` API to send Yjs messages through your Laravel backend:

1. **Client sends message** → Uses `send_event()` to send to Pusher
2. **Pusher triggers webhook** → Sends the message to your Laravel backend
3. **Laravel validates & broadcasts** → Your webhook handler validates permissions and broadcasts to other clients
4. **Other clients receive** → Messages are delivered via the Presence Channel

This approach provides:
- **Server-side validation** - All messages go through your backend
- **Authentication & Authorization** - Full control over who can send/receive
- **Logging & Monitoring** - Track all collaborative editing activity
- **Rate Limiting** - Prevent abuse at the server level

### Advanced: Adding Authorization to Webhook

You can add additional authorization checks in the webhook handler:

```php
protected function handleYjsMessage($event)
{
    $channelName = $event['channel'];
    $userId = $event['user_id'] ?? null;
    $data = json_decode($event['data'], true);

    if (preg_match('/presence-document\.(\d+)/', $channelName, $matches)) {
        $documentId = $matches[1];

        // Verify user has permission to edit this document
        $document = \App\Models\Document::find($documentId);
        if (!$document) {
            Log::warning("Document not found: {$documentId}");
            return;
        }

        // Optional: Check user permissions
        if ($userId) {
            $user = \App\Models\User::find($userId);
            if (!$user || !$user->can('edit', $document)) {
                Log::warning("User {$userId} not authorized for document {$documentId}");
                return;
            }
        }

        // Broadcast to all users in the channel
        broadcast(new YjsMessage($documentId, $data['data'] ?? '', $userId));
    }
}
```

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
3. **Messages not broadcasting**: Ensure your webhook is configured correctly in Pusher dashboard
4. **Webhook not receiving events**: Check that client events are enabled in Pusher and webhook URL is correct
5. **Invalid signature errors**: Verify your `PUSHER_APP_SECRET` matches your Pusher dashboard settings

### Performance

1. **Too many webhooks**: Consider implementing debouncing on the client side
2. **Large documents**: Implement incremental updates and persistence
3. **Rate limiting**: Configure rate limits in your webhook handler and at the Pusher level
4. **Webhook latency**: Ensure your server responds quickly to webhook requests (< 200ms)

### Security

1. **Always authorize users** in your presence channel
2. **Validate webhook signatures** in your webhook handler (shown in example above)
3. **Verify permissions** before broadcasting messages
4. **Implement rate limiting** to prevent abuse
5. **Use HTTPS** for webhook endpoint
6. **Log suspicious activity** for monitoring

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
