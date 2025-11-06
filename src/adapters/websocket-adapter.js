/**
 * @module adapters/websocket-adapter
 */

/* eslint-env browser */

import { BaseAdapter } from './base-adapter.js'

/**
 * Default WebSocket adapter that wraps the native WebSocket API
 * or a WebSocket polyfill.
 *
 * This adapter maintains backward compatibility with the original
 * y-websocket implementation.
 */
export class WebSocketAdapter extends BaseAdapter {
  /**
   * @param {typeof WebSocket} WebSocketPolyfill - WebSocket class or polyfill
   */
  constructor (WebSocketPolyfill = WebSocket) {
    super()
    this._WS = WebSocketPolyfill
    this.ws = null
  }

  /**
   * Connect to the WebSocket server
   * @param {string} url - WebSocket URL
   * @param {Array<string>} protocols - WebSocket protocols
   */
  connect (url, protocols) {
    this.ws = new this._WS(url, protocols)
    this.ws.binaryType = 'arraybuffer'

    // Forward events from WebSocket to adapter
    this.ws.onopen = (event) => {
      if (this.onopen) {
        this.onopen(event)
      }
    }

    this.ws.onmessage = (event) => {
      if (this.onmessage) {
        this.onmessage(event)
      }
    }

    this.ws.onerror = (event) => {
      if (this.onerror) {
        this.onerror(event)
      }
    }

    this.ws.onclose = (event) => {
      if (this.onclose) {
        this.onclose(event)
      }
    }
  }

  /**
   * Send data through the WebSocket
   * @param {Uint8Array | ArrayBuffer} data - Binary data to send
   */
  send (data) {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(data)
    }
  }

  /**
   * Close the WebSocket connection
   */
  close () {
    if (this.ws) {
      this.ws.close()
    }
  }

  /**
   * Get the current connection state
   * @return {number} Connection state
   */
  get readyState () {
    return this.ws ? this.ws.readyState : WebSocketAdapter.CLOSED
  }
}
