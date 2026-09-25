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


## Option 3: Cloudflare Origin CA certificate

This mode encrypts the connection **between Cloudflare and the Kryndexa web panel** with a Cloudflare Origin CA certificate.

1. In Cloudflare, open **SSL/TLS → Origin Server**.
2. Choose **Create Certificate**.
3. Include the dashboard hostname, for example `panel.example.com`.
4. Save the private key and Origin Certificate as PEM files on the bot host.
5. Do **not** commit either file to Git.
6. In Cloudflare, set **SSL/TLS encryption mode** to **Full (strict)**.
7. Keep the DNS record proxied through Cloudflare (orange cloud).

Example:

```env
NODE_ENV=production
BASE_URL=https://panel.example.com
DISCORD_REDIRECT_URI=https://panel.example.com/auth/callback

WEB_SSL_ENABLED=true
WEB_SSL_PROVIDER=cloudflare-origin
WEB_CLOUDFLARE_ORIGIN_KEY_FILE=certs/cloudflare-origin-key.pem
WEB_CLOUDFLARE_ORIGIN_CERT_FILE=certs/cloudflare-origin-cert.pem
WEB_HTTPS_PORT=443
WEB_HTTP_REDIRECT_PORT=80
WEB_FORCE_HTTPS=true
WEB_TRUST_PROXY=true
WEB_HSTS_ENABLED=true
```

Expected startup output:

```
[Dashboard SSL] Cloudflare Origin CA certificate enabled.
[Dashboard SSL] Use Cloudflare SSL/TLS mode: Full (strict).
[Dashboard SSL] HTTPS enabled on port 443.
Dashboard listening securely on https://panel.example.com
```

### Important Cloudflare Origin CA note

Cloudflare Origin CA certificates are intended for the **Cloudflare → origin server** connection. Normal browsers generally do not trust an Origin CA certificate when connecting directly to the origin IP/hostname without Cloudflare in front of it. Keep the dashboard hostname proxied through Cloudflare.

### Recommended Cloudflare settings

- DNS record: **Proxied**
- SSL/TLS mode: **Full (strict)**
- Always Use HTTPS: **On** (optional when `WEB_FORCE_HTTPS=true`)
- Minimum TLS Version: TLS 1.2 or newer
- Automatic HTTPS Rewrites: optional

The Node HTTPS server also enforces a minimum of TLS 1.2.


## Cloudflare certificate-pack dashboard status

The dashboard can query Cloudflare's certificate-pack API:

```
GET https://api.cloudflare.com/client/v4/zones/{zone_id}/ssl/certificate_packs
```

Configure:

```env
CLOUDFLARE_ZONE_ID=a0bc666fd167fd1c5a390d516c9dacb7
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
```

The API token should be scoped to the required zone and have **SSL and Certificates Read** permission.

The token stays server-side and is never sent to the dashboard browser. The dashboard shows:

- certificate-pack count
- active certificate count
- pending/other certificate count
- hostname count
- Cloudflare API connectivity/error state

Authenticated administrators can also inspect:

```
GET /api/cloudflare/ssl
```

### Edge certificates vs Origin CA

The Cloudflare `ssl/certificate_packs` endpoint reports certificates deployed at the **Cloudflare edge**. It does not provide the private key for your Cloudflare Origin CA certificate and does not replace:

```env
WEB_CLOUDFLARE_ORIGIN_KEY_FILE=
WEB_CLOUDFLARE_ORIGIN_CERT_FILE=
```

Those local PEM files are still used for the encrypted **Cloudflare → Kryndexa origin** connection.


## Production domain: kryndexabot.xyz

The web panel is configured to use the canonical production domain:

```env
BASE_URL=https://kryndexabot.xyz
DISCORD_REDIRECT_URI=https://kryndexabot.xyz/auth/callback
WEB_CANONICAL_HOST=kryndexabot.xyz
WEB_CANONICAL_REDIRECT=true
WEB_FORCE_HTTPS=true
WEB_TRUST_PROXY=true
```

Add this exact Discord OAuth redirect in the Discord Developer Portal:

```
https://kryndexabot.xyz/auth/callback
```

When `WEB_CANONICAL_REDIRECT=true`, alternate hostnames are redirected with HTTP 308 to `https://kryndexabot.xyz` while preserving the original path and query string.

### Link embeds / metadata

All pages rendered by the web panel now include:

- HTML description metadata
- canonical URL
- Open Graph site/title/description/URL/image tags
- Twitter card/title/description/image tags
- theme color
- application name
- robots directives

Public pages are indexable. Authenticated dashboard/settings pages use `noindex,nofollow,noarchive`.

Set a dedicated social preview image with:

```env
WEB_META_IMAGE_URL=https://kryndexabot.xyz/path/to/1200x630-image.png
```

If this is blank, the panel uses `https://kryndexabot.xyz/favicon.ico` as the embed image fallback.


## Fixing EADDRINUSE on port 443

If startup reports:

```
Error: listen EADDRINUSE: address already in use :::443
```

another process already owns HTTPS port 443.

Kryndexa now handles this without crashing. With:

```env
WEB_SSL_PORT_CONFLICT_FALLBACK=true
WEB_INTERNAL_PORT=3000
```

the dashboard falls back to:

```
http://127.0.0.1:3000
```

and the service already listening on 443 should reverse-proxy `https://kryndexabot.xyz` to that internal address.

Expected log:

```
[Dashboard SSL] HTTPS port 443 is already in use by another process.
Dashboard listening internally on http://127.0.0.1:3000
[Dashboard SSL] Port 443 is occupied, so Kryndexa switched to reverse-proxy mode on internal port 3000.
```

### Find what owns port 443 on Windows

```powershell
Get-NetTCPConnection -LocalPort 443 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess

Get-Process -Id (Get-NetTCPConnection -LocalPort 443 -State Listen).OwningProcess
```

or:

```cmd
netstat -ano | findstr :443
```

Do not stop the process blindly. It may be IIS, NGINX, a Cloudflare tunnel/proxy service, another website, or another required application.

### Reverse-proxy deployment

When a proxy already owns port 443, the recommended Kryndexa configuration is:

```env
PORT=3000
WEB_INTERNAL_PORT=3000
WEB_SSL_ENABLED=false
WEB_FORCE_HTTPS=true
WEB_TRUST_PROXY=true

BASE_URL=https://kryndexabot.xyz
DISCORD_REDIRECT_URI=https://kryndexabot.xyz/auth/callback
```

In this mode the proxy owns the public certificate/HTTPS connection and forwards traffic to `http://127.0.0.1:3000`.

If you specifically want Node to own the Cloudflare Origin certificate directly, stop/reconfigure the process currently occupying port 443 before enabling:

```env
WEB_SSL_ENABLED=true
WEB_SSL_PROVIDER=cloudflare-origin
WEB_HTTPS_PORT=443
```
