/**
 * @module adapters/base-adapter
 */

/**
 * Base class for connection adapters.
 * Adapters provide an abstraction layer for different connection mechanisms
 * (WebSocket, Laravel Echo, Socket.io, etc.)
 *
 * @abstract
 */
export class BaseAdapter {
  constructor () {
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null
  }

  /**
   * Connect to the remote server
   * @param {string} url - Connection URL
   * @param {Array<string>} protocols - Connection protocols
   * @abstract
   */
  connect (url, protocols) {
    throw new Error('connect() must be implemented by subclass')
  }

  /**
   * Send data to the remote server
   * @param {Uint8Array | ArrayBuffer} data - Binary data to send
   * @abstract
   */
  send (data) {
    throw new Error('send() must be implemented by subclass')
  }

  /**
   * Close the connection
   * @abstract
   */
  close () {
    throw new Error('close() must be implemented by subclass')
  }

  /**
   * Get the current connection state
   * @return {number} Connection state (0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED)
   * @abstract
   */
  get readyState () {
    throw new Error('readyState must be implemented by subclass')
  }

  /**
   * Connection state constants (matching WebSocket API)
   */
  static get CONNECTING () { return 0 }
  static get OPEN () { return 1 }
  static get CLOSING () { return 2 }
  static get CLOSED () { return 3 }

  get CONNECTING () { return BaseAdapter.CONNECTING }
  get OPEN () { return BaseAdapter.OPEN }
  get CLOSING () { return BaseAdapter.CLOSING }
  get CLOSED () { return BaseAdapter.CLOSED }
}
