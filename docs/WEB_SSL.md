# Web Panel SSL / HTTPS

Kryndexa Bot supports two HTTPS deployment modes.

## Option 1: SSL terminates directly in Node

Set the dashboard to read your private key and certificate files:

```env
NODE_ENV=production
BASE_URL=https://panel.example.com
DISCORD_REDIRECT_URI=https://panel.example.com/auth/callback

WEB_SSL_ENABLED=true
WEB_SSL_KEY_FILE=certs/privkey.pem
WEB_SSL_CERT_FILE=certs/fullchain.pem
WEB_SSL_CA_FILE=
WEB_HTTPS_PORT=443
WEB_HTTP_REDIRECT_PORT=80
WEB_FORCE_HTTPS=true
WEB_TRUST_PROXY=false
WEB_HSTS_ENABLED=true
```

The key/certificate paths may be absolute paths or paths relative to the bot directory.

When `WEB_HTTP_REDIRECT_PORT` is set, the bot starts a second lightweight HTTP listener that redirects all requests to HTTPS.

> Do not commit private keys or certificate files to Git.

## Option 2: Cloudflare / NGINX / Caddy terminates SSL

Leave Node itself on HTTP and let the reverse proxy handle the certificate:

```env
NODE_ENV=production
PORT=3000
BASE_URL=https://panel.example.com
DISCORD_REDIRECT_URI=https://panel.example.com/auth/callback

WEB_SSL_ENABLED=false
WEB_FORCE_HTTPS=true
WEB_TRUST_PROXY=true
WEB_HSTS_ENABLED=true
```

Your proxy should forward requests to the bot on `http://127.0.0.1:3000` and send `X-Forwarded-Proto: https`.

## Discord OAuth

The redirect in Discord Developer Portal must exactly match:

```
https://panel.example.com/auth/callback
```

It must match the value of `DISCORD_REDIRECT_URI` including scheme, hostname, port (if any), path, and trailing slash behavior.

## Startup logs

Direct SSL mode prints:

```
[Dashboard SSL] HTTPS enabled on port 443.
Dashboard listening securely on https://panel.example.com
[Dashboard SSL] HTTP port 80 redirects to HTTPS.
```

Reverse-proxy mode prints the normal dashboard listener plus:

```
[Dashboard SSL] HTTPS is expected to terminate at the configured reverse proxy.
```

## Certificate renewal

The bot reads certificate files when it starts. If your certificate is renewed on disk, restart the bot so Node reloads the new key/certificate.
