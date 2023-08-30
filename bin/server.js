#!/usr/bin/env node

/**
 * @type {any}
 */
const WebSocket = require('ws')
const http = require('http')
const wss = new WebSocket.Server({ noServer: true })
const setupWSConnection = require('./utils.js').setupWSConnection
// SST: notifications
const subscriptions = require('./utils.js').subscriptions

const host = process.env.HOST || 'localhost'
// SST: changed from fallback 1234 to 80
const port = process.env.PORT || 80

const server = http.createServer((request, response) => {
  // SST: Escape for Notification
  if (request.url === '/subscribe' || request.url === '/unsubscribe') {
    if (request.method === 'OPTIONS') {
      response.writeHead(202, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
      response.end('go ahead')
      return
    }
    let body = ''
    request.on('data', chunk => body += chunk)
    request.on('end', () => {
      if (!body) {
        response.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
        response.end('requires body aka payload')
        return
      }
      try {
        body = JSON.parse(body.replace(/'/g, '"')) || null
      } catch (e) {
        body = null
      }
      if (!body.room) {
        response.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
        response.end('body payload requires the property room, userVisibleOnly and applicationServerKey as string!')
        return
      }
      const room = body.room
      delete body.room
      if (request.url === '/subscribe') {
        if (subscriptions.has(room)) {
          subscriptions.get(room).push(body)
        } else {
          subscriptions.set(room, [body])
        }
      } else if (subscriptions.has(room)) {
        const subscription = subscriptions.get(room)
        const index = subscription.findIndex(sub => JSON.stringify(sub.keys) === JSON.stringify(body.keys))
        if (index !== -1) subscription.splice(index, 1)
      }
      response.writeHead(201, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
      response.end(request.url + 'done')
    })
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

wss.on('connection', setupWSConnection)

server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
  // See https://github.com/websockets/ws#client-authentication
  /**
   * @param {any} ws
   */
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

// SST: changed from "port, host, ()" to only "port, ()" to not pass host at all, works on heroku
server.listen(port, () => {
  console.log(`running at '${host}' on port ${port}`)
})
