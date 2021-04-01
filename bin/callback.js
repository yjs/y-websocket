const http = require('http')

const CALLBACK_URL = process.env.CALLBACK_URL ? new URL(process.env.CALLBACK_URL) : null
const CALLBACK_TIMEOUT = process.env.CALLBACK_TIMEOUT || 5000
const CALLBACK_OBJECTS = process.env.CALLBACK_OBJECTS ? JSON.parse(process.env.CALLBACK_OBJECTS) : {}
const CALLBACK_SIZES = process.env.CALLBACK_SIZES ? JSON.parse(process.env.CALLBACK_SIZES) : {}

exports.isCallbackSet = !!CALLBACK_URL

/**
 * @param {Uint8Array} update
 * @param {any} origin
 * @param {WSSharedDoc} doc
 */
exports.callbackHandler = (update, origin, doc) => {
  const room = doc.name
  const dataToSend = {
    room: room,
    data: {},
    sizes: {}
  }

  const objectsKeys = Object.keys(CALLBACK_OBJECTS)
  objectsKeys.forEach(key => {
    const sharedType = CALLBACK_OBJECTS[key]
    dataToSend.data[key] = {
      type: sharedType,
      content: getContent(key, sharedType, doc).toJSON()
    }
  })

  const sizesKeys = Object.keys(CALLBACK_SIZES)
  sizesKeys.forEach(key => {
    const sharedType = CALLBACK_SIZES[key]
    dataToSend.sizes[key] = {
      type: sharedType,
      size: getSize(key, sharedType, doc)
    }
  })

  callbackRequest(CALLBACK_URL, CALLBACK_TIMEOUT, dataToSend)
}

/**
 * @param {URL} url
 * @param {number} timeout
 * @param {Object} data
 */
const callbackRequest = (url, timeout, data) => {
  data = JSON.stringify(data)
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    timeout: timeout,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }
  const req = http.request(options)
  req.on('timeout', () => {
    console.warn('Callback request timed out.')
    req.abort()
  })
  req.on('error', (e) => {
    console.error('Callback request error.', e)
    req.abort()
  })
  req.write(data)
  req.end()
}

/**
 * @param {string} objName
 * @param {string} objType
 * @param {WSSharedDoc} doc
 */
const getContent = (objName, objType, doc) => {
  switch (objType) {
    case 'Array': return doc.getArray(objName)
    case 'Map': return doc.getMap(objName)
    case 'Text': return doc.getText(objName)
    case 'XmlFragment': return doc.getXmlFragment(objName)
    case 'XmlElement': return doc.getXmlElement(objName)
    default : return {}
  }
}

const getSize = (objName, objType, doc) => {
  switch (objType) {
    case 'Array': return doc.getArray(objName).length
    case 'Map': return doc.getMap(objName).size
    case 'Text': return doc.getText(objName).length
    case 'XmlFragment': return doc.getXmlFragment(objName).length
    case 'XmlElement': return doc.getXmlElement(objName).toString().length
    default : return null
  }
}
