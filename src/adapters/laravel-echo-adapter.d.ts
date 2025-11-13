import { BaseAdapter } from './base-adapter.js'

/**
 * Laravel Echo user object
 */
export interface LaravelEchoUser {
  id: number | string
  [key: string]: any
}

/**
 * Laravel Echo channel interface
 */
export interface LaravelEchoChannel {
  here(callback: (users: LaravelEchoUser[]) => void): this
  error(callback: (error: any) => void): this
  listen(event: string, callback: (event: any) => void): this
  joining(callback: (user: LaravelEchoUser) => void): this
  leaving(callback: (user: LaravelEchoUser) => void): this
  whisper(event: string, data: any, callback?: (error?: any) => void): this
  listenForWhisper(event: string, callback: (event: any) => void): this
}

/**
 * Laravel Echo instance interface
 */
export interface LaravelEcho {
  join(channel: string): LaravelEchoChannel
  leave(channel: string): void
}

/**
 * Configuration options for LaravelEchoAdapter
 */
export interface LaravelEchoAdapterOptions {
  /**
   * Event name for YJS sync messages
   * @default 'yjs-message'
   */
  messageEvent?: string
  
  /**
   * Event name for YJS awareness messages
   * @default 'yjs-awareness'
   */
  awarenessEvent?: string
  
  /**
   * Callback when receiving initial users list
   */
  onHere?: ((users: LaravelEchoUser[]) => void) | null
  
  /**
   * Callback when a user joins the channel
   */
  onJoining?: ((user: LaravelEchoUser) => void) | null
  
  /**
   * Callback when a user leaves the channel
   */
  onLeaving?: ((user: LaravelEchoUser) => void) | null
}

/**
 * Laravel Echo adapter that handles real-time collaboration through Laravel Echo
 * presence channels with message chunking support.
 */
export class LaravelEchoAdapter extends BaseAdapter {
  /**
   * @param echo - Laravel Echo instance
   * @param channelName - Name of the Echo presence channel
   * @param options - Configuration options
   */
  constructor(
    echo: LaravelEcho,
    channelName: string,
    options?: LaravelEchoAdapterOptions
  )

  /**
   * Connect to the Laravel Echo channel
   */
  connect(url: string, protocols: string[]): void

  /**
   * Send data through the Laravel Echo channel
   */
  send(data: Uint8Array | ArrayBuffer): void

  /**
   * Close the connection and clean up
   */
  close(): void

  /**
   * Get the current connection state
   */
  get readyState(): number
}
