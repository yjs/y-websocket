import { BaseAdapter } from './base-adapter.js'

/**
 * Default WebSocket adapter that wraps the native WebSocket API
 * or a WebSocket polyfill.
 *
 * This adapter maintains backward compatibility with the original
 * y-websocket implementation.
 */
export class WebSocketAdapter extends BaseAdapter {
  private _WS: typeof WebSocket
  private ws: WebSocket | null

  /**
   * @param WebSocketPolyfill - WebSocket class or polyfill
   */
  constructor(WebSocketPolyfill?: typeof WebSocket)

  /**
   * Connect to the WebSocket server
   */
  connect(url: string, protocols: string[]): void

  /**
   * Send data through the WebSocket
   */
  send(data: Uint8Array | ArrayBuffer): void

  /**
   * Close the WebSocket connection
   */
  close(): void

  /**
   * Get the current connection state
   */
  get readyState(): number
}
