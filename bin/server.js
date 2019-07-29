#!/usr/bin/env node

/**
 * @type {any}
 */
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs');
const https = require('https')
const wss = new WebSocket.Server({ noServer: true })
const setupWSConnection = require('./utils.js').setupWSConnection

const port = process.env.PORT || 1234
const keyPath = process.env.KEY;
const certPath = process.env.CERT;
const caPath = process.env.CA;
const secure = key && cert && ca;

function handler(request, response) {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
}

let server;
if (secure) {
  const key = fs.readFileSync(keyPath, 'utf8');
  const cert = fs.readFileSync(certPath, 'utf8');
  const ca = fs.readFileSync(caPath, 'utf8');
  const credentials = { key, cert, ca };
  server = https.createServer(credentials, handler);
} else {
  server = http.createServer(handler);
}

wss.on('connection', setupWSConnection)

server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
  /**
   * @param {any} ws
   */
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port)

console.log('running on port', port)
