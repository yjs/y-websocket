/** @typedef {string | Buffer | ArrayBuffer | Buffer[]} Data */
/** @typedef {(data: Uint8Array | ArrayBuffer) => Promise<Data>} Encoder */
/** @typedef {(data: Data) => Uint8Array} Decoder */

/**
 * @typedef {Object} EncoderSet
 * @property {Encoder} requestEncoder
 * @property {Decoder} responseDecoder
 */

/**
 * @type {EncoderSet}
 */
const defaultEncoderSet = {
  requestEncoder: async (data) => {
    return data
  },
  responseDecoder: (data) => {
    if (data instanceof Uint8Array) {
      return data
    } else if (data instanceof ArrayBuffer) {
      return new Uint8Array(data)
    } else if (data instanceof Buffer) {
      return new Uint8Array(data)
    } else {
      throw new TypeError('Unexpected data type')
    }
  }
}

/**
 * @type {EncoderSet}
 */
const awsEncoderSetForBrowser = {
  requestEncoder: async (data) => {
    const base64Url = await new Promise((resolve, reject) => {
      const reader = new FileReader() // eslint-disable-line
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)

      reader.readAsDataURL(new Blob([data])) // eslint-disable-line
    })

    /*
     * The result looks like
     * "data:application/octet-stream;base64,<your base64 data>",
     * so we split off the beginning:
     */
    return base64Url.substring(base64Url.indexOf(',') + 1)
  },
  /** @param {string | ArrayBuffer} data */
  responseDecoder: (data) => {
	if (data instanceof ArrayBuffer) {
      return new Uint8Array(data)
    }

    const arr = new Uint8Array(data.length)

    arr.forEach((_, index) => {
      arr[index] = data.charCodeAt(index)
    })

    return arr
  }
}

/**
 * @type {EncoderSet}
 */
const awsEncoderSetForNode = {
  requestEncoder: async (data) => {
    const buffer = Buffer.from(data)
    return buffer.toString('base64')
  },
  responseDecoder: (data) => {
    if (typeof data !== 'string') {
      throw new TypeError('Unexpected data type')
    }

    if (data.includes('Internal server error')) {
      let payload = null

      try {
        payload = JSON.parse(data)
      } catch (ex) {}

      if (payload) {
        throw new Error('AWS error received')
      }
    }

    return new Uint8Array(Buffer.from(data, 'binary')) // 'binary' is alias for 'latin1' in Node
  }
}

/**
 * @param {'arraybuffer' | 'aws'} socketType
 * @returns {EncoderSet}
 */
export function getEncoderSet (socketType) {
  if (socketType === 'arraybuffer') {
    return defaultEncoderSet
  }

  const isBrowser = typeof window !== 'undefined'

  return (isBrowser)
    ? awsEncoderSetForBrowser
    : awsEncoderSetForNode;
}
