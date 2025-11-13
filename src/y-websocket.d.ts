import * as Y from 'yjs'
import * as awarenessProtocol from '@y/protocols/awareness'
import { ObservableV2 } from 'lib0/observable'
import { BaseAdapter } from './adapters/base-adapter.js'

export const messageSync: 0
export const messageQueryAwareness: 3
export const messageAwareness: 1
export const messageAuth: 2

export interface WebsocketProviderOptions {
  /**
   * Whether to connect immediately
   */
  connect?: boolean
  /**
   * Awareness instance
   */
  awareness?: awarenessProtocol.Awareness
  /**
   * URL parameters
   */
  params?: Record<string, string>
  /**
   * WebSocket protocols
   */
  protocols?: string[]
  /**
   * WebSocket polyfill
   */
  WebSocketPolyfill?: typeof WebSocket
  /**
   * Connection adapter (e.g., WebSocketAdapter, LaravelEchoAdapter)
   */
  adapter?: BaseAdapter
  /**
   * Request server state every resyncInterval milliseconds
   */
  resyncInterval?: number
  /**
   * Maximum amount of time to wait before trying to reconnect (we try to reconnect using exponential backoff)
   */
  maxBackoffTime?: number
  /**
   * Disable cross-tab BroadcastChannel communication
   */
  disableBc?: boolean
}

export type WebsocketProviderEvents = {
  'connection-close': (event: CloseEvent | null, provider: WebsocketProvider) => void
  'status': (event: { status: 'connected' | 'disconnected' | 'connecting' }) => void
  'connection-error': (event: Event, provider: WebsocketProvider) => void
  'sync': (state: boolean) => void
  'synced': (state: boolean) => void
}

/**
 * Websocket Provider for Yjs. Creates a websocket connection to sync the shared document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 * ```ts
 * import * as Y from 'yjs'
 * import { WebsocketProvider } from 'y-websocket'
 * const doc = new Y.Doc()
 * const provider = new WebsocketProvider('http://localhost:1234', 'my-document-name', doc)
 * ```
 */
export class WebsocketProvider extends ObservableV2<WebsocketProviderEvents> {
  serverUrl: string
  bcChannel: string
  maxBackoffTime: number
  /**
   * The specified url parameters. This can be safely updated. The changed parameters will be used
   * when a new connection is established.
   */
  params: Record<string, string>
  protocols: string[]
  roomname: string
  doc: Y.Doc
  private _WS: typeof WebSocket
  adapter: BaseAdapter
  awareness: awarenessProtocol.Awareness
  wsconnected: boolean
  wsconnecting: boolean
  bcconnected: boolean
  disableBc: boolean
  wsUnsuccessfulReconnects: number
  messageHandlers: Array<(
    encoder: any,
    decoder: any,
    provider: WebsocketProvider,
    emitSynced: boolean,
    messageType: number
  ) => void>
  private _synced: boolean
  ws: BaseAdapter | null
  wsLastMessageReceived: number
  /**
   * Whether to connect to other peers or not
   */
  shouldConnect: boolean
  private _resyncInterval: number
  private _bcSubscriber: (data: ArrayBuffer, origin: any) => void
  private _updateHandler: (update: Uint8Array, origin: any) => void
  private _awarenessUpdateHandler: (
    changed: { added: number[]; updated: number[]; removed: number[] },
    origin: any
  ) => void
  private _exitHandler: () => void
  private _checkInterval: number

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    opts?: WebsocketProviderOptions
  )

  get url(): string

  get synced(): boolean
  set synced(state: boolean)

  destroy(): void

  connectBc(): void

  disconnectBc(): void

  disconnect(): void

  connect(): void
}

// Re-export adapters for convenience
export { BaseAdapter, WebSocketAdapter, LaravelEchoAdapter, LaravelEcho, LaravelEchoChannel, LaravelEchoUser, LaravelEchoAdapterOptions } from './adapters/index.js'

// Re-export utils for convenience
export { uint8ArrayToBase64, base64ToUint8Array } from './utils/index.js'
