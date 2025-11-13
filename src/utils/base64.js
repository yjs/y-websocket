/**
 * Utility functions for converting between Uint8Array and base64 strings
 * Used for encoding/decoding Y.js document state for storage
 */

/**
 * Convert Uint8Array to base64 string
 * @param bytes - The Uint8Array to convert
 * @returns Base64 encoded string
 */
export function uint8ArrayToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 * @param base64 - The base64 string to convert
 * @returns Uint8Array
 */
export function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
