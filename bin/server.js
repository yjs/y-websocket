#!/usr/bin/env node
/**
 * set up a web socket server for yjs
 * typical usage:
 * PORT=1234 YPERSISTENCE=./dbDir CERTDIR=/etc/letsencrypt/live/example.com node ./node_modules/y-websocket/bin/server.js
 * (optional) PORT to listen on Port 1234 (default)
 * (optional) YPERSITENCE use dbDir as the persistence store
 * (optional) CERTDIR to use https:// and wss:// protocols, using the certificate and key in that directory
 *
 */
/**
 * @type {any}
 */
const WebSocket = require('ws')
const http = require('http')
const https = require('https')
const fs = require('fs')
const wss = new WebSocket.Server({ noServer: true })
const setupWSConnection = require('./utils.js').setupWSConnection

const port = process.env.PORT || 1234
const certDir = process.env.CERTDIR;
let server = null;
let serverProtocol = '';

if (certDir) {
  serverProtocol = 'wss://';
  const options = {
    cert: fs.readFileSync(
      certDir + '/fullchain.pem'
    ),
    key: fs.readFileSync(
      certDir + '/privkey.pem'
    ),
  };

   server = https.createServer(options, (request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('okay');
  });
}
else {
  serverProtocol = 'ws://';
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('okay')
  })
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

console.log(serverProtocol, 'running on port', port)
