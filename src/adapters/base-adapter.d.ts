/**
 * Base class for connection adapters.
 * Adapters provide an abstraction layer for different connection mechanisms
 * (WebSocket, Laravel Echo, Socket.io, etc.)
 */
export abstract class BaseAdapter {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null

  constructor()

  /**
   * Connect to the remote server
   */
  abstract connect(url: string, protocols: string[]): void

  /**
   * Send data to the remote server
   */
  abstract send(data: Uint8Array | ArrayBuffer): void

  /**
   * Close the connection
   */
  abstract close(): void

  /**
   * Get the current connection state
   * Connection state (0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED)
   */
  abstract get readyState(): number

  /**
   * Connection state constants (matching WebSocket API)
   */
  static readonly CONNECTING: 0
  static readonly OPEN: 1
  static readonly CLOSING: 2
  static readonly CLOSED: 3

  readonly CONNECTING: 0
  readonly OPEN: 1
  readonly CLOSING: 2
  readonly CLOSED: 3
}
