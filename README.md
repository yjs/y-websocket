
### Websocket Provider

The Websocket Provider implements a classical client server model. Clients connect to a single endpoint over Websocket. The server distributes awareness information and document updates among clients.

The Websocket Provider is a solid choice if you want a central source that handles authentication and authorization. Websockets also send header information and cookies, so you can use existing authentication mechanisms with this server.

* Supports cross-tab communication. When you open the same document in the same browser, changes on the document are exchanged via cross-tab communication ([Broadcast Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) and [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) as fallback).
* Supports exchange of awareness information (e.g. cursors).

#### Client Code

```js
import * as Y from 'yjs'
import { WebsocketProvider } from 'yjs/provider/websocket.js'

const doc = new Y.Doc()
const wsProvider = new WebsocketProvider('ws://localhost:1234', 'my-roomname', doc)

wsProvider.on('status', event => {
  console.log(event.status) // logs "connected" or "disconnected"
})
```

#### Start a Websocket Server

Since `npm` symlinks the `y-websocket-server` executable from your local `./node_modules/.bin` folder, you can simply run `npx`. The `PORT` environment variable already defaults to 1234.

```sh
PORT=1234 npx y-websocket-server
```

#### Websocket Server with Persistence

Persist document updates in a LevelDB database.

See [LevelDB Persistence](https://github.com/yjs/y-leveldb) for more info.

```sh
PORT=1234 YPERSISTENCE=./dbDir node ./node_modules/y-websocket/bin/server.js
```

#### Start a secure websocket server

You can also use the secure `wss://` protocol, which like `https://`, uses SSL/TLS.  For this, you first need a certificate.  If your server is  using `https://`, you will already have a certificate.  If not, you can obtain one for free from [certbot](https://certbot.eff.org/).  You should then provide the directory in which the certifcate and private key are to be found:

```sh
PORT=1234 YPERSISTENCE=./dbDir CERTDIR=/etc/letsencrypt/live/example.com node ./node_modules/y-websocket/bin/server.js
```

You would then connect using the `wss://` protocol:

```js
const wsProvider = new WebsocketProvider('wss://localhost:1234', 'my-roomname', doc)
```

#### Providing a service

The shell commands above are suited to development, wth the websocket server running locally and in a terminal.  However, a websocket service is more useful if it is on a remote server and the server maintains that service continously. This means that it should run as a system service, automatically starting when the server boots and restarting in case of failure.  Moreover,  to avoid problems with firewalls blocking non-standard ports, it should be accessible through port 80 or 443.

The detais of how to do this will depend on the OS.  For most Linux systems, you should set up a `systemd` service, using a unit file something like this:

```sh
[Unit]
Description=websocket-server
[Service]
ExecStart=<path.to.node_modules>/.bin/y-websocket-server
Restart=always
RestartSec=10
User=root
Group=root
Environment='PATH=<path.to.node.>node/v14.4.0/bin' 'YPERSISTENCE=<path.to.dbDir>/dbDir' 'CERTDIR=<path.to.certificates>'
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=websocket-server
[Install]
WantedBy=multi-user.target
```

If you are (as is most likely) you are already running a web server on ports 80 and 443, you will need to set up a reverse proxy.  For Apache, you should add something like the following to your `.conf` configuration file:

```sh
SSLProxyEngine on
ProxyPass /wss  wss://example.com:1234
```

and your client can then connect to the websocket server with:

```js
const wsProvider = new WebsocketProvider('wss://example.com/wss', 'my-roomname', doc)
```

For the `nginx` web server, use (suggested by @canadaduane)

```sh
server {
        listen 80 ;
        # listen [::]:80 ipv6only=on;

        root /var/www/html;
        index index.php index.html index.htm;

        server_name y.relm.us;

        location / {
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header Host $host;
                proxy_pass http://localhost:1235;

                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "Upgrade";
                proxy_connect_timeout 7d;
                proxy_send_timeout 7d;
                proxy_read_timeout 7d;

                client_max_body_size 10m;
        }

        error_page 413 @filetoobig;
        error_page 404 /404.html;
        error_page 500 502 503 504 /50x.html;
        location = /50x.html {
                root /usr/share/nginx/html;
        }

        location @filetoobig {
                add_header Access-Control-Allow-Origin * always;
        }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/y.relm.us/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/y.relm.us/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
```

## Scaling

These are mere suggestions how you could scale your server environment.

**Option 1:** Websocket servers communicate with each other via a PubSub server. A room is represented by a PubSub channel. The downside of this approach is that the same shared document may be handled by many servers. But the upside is that this approach is fault tolerant, does not have a single point of failure, and is fit for route balancing.

**Option 2:** Sharding with *consistent hashing*. Each document is handled by a unique server. This pattern requires an entity, like etcd, that performs regular health checks and manages servers. Based on the list of available servers (which is managed by etcd) a proxy calculates which server is responsible for each requested document. The disadvantage of this approach is that load distribution may not be fair. Still, this approach may be the preferred solution if you want to store the shared document in a database - e.g. for indexing.

## License

[The MIT License](./LICENSE) © Kevin Jahns
