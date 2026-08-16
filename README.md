# CHATRAT backend (free-first, realtime)

This backend is built for your current frontend (`chatrat.html`) and provides:
- Anonymous **handle-only** sessions (no login)
- **Nearby rooms** (10km default), **4-hour expiry**
- **Real-time** chat (WebSocket) with **join/leave**, **typing**, **messages**

## Stack (zero-cost friendly)
- **Cloudflare Workers** (REST API)
- **Durable Objects** (one WebSocket “room server” per room)
- **D1 (SQLite)** (rooms + message history)

## Endpoints
Base: `/v1`

- **POST** `/session`
  - body: `{ "handle": "streetrat_99", "deviceId": "optional-stable-id" }`
  - returns: `{ ok:true, data:{ token, tokenExpiresAt, userId, handle } }`

- **GET** `/rooms/nearby?lat=..&lng=..&radiusKm=10`
  - returns rooms with `liveCount` (best-effort) + `distanceKm`

- **POST** `/rooms` (auth required)
  - header: `Authorization: Bearer <token>`
  - body: `{ "name":"Chai Gang ☕", "topic":"Morning vibes", "lat":29.15, "lng":75.72 }`

- **GET** `/rooms/:roomId/messages?limit=50&before=<ISO>`
  - scrollback paging (older messages)

- **GET** `/rooms/:roomId/messages?limit=50&after=<ISO>`
  - **polling fallback** (new messages since cursor)

## Realtime (WebSocket)
- Connect:
  - `wss://<your-domain>/v1/rooms/<roomId>/ws?token=<token>`
- Client → Server events:
  - `{ "type":"typing", "isTyping": true }`
  - `{ "type":"message", "body":"hello" }`
- Server → Client events:
  - `room_state`, `member_joined`, `member_left`, `typing`, `message`, `system`, `error`
  - Shapes are in `src/types.ts`.

## Local development
1. Install Node.js (LTS) and npm.
2. In this folder:

```bash
npm install
```

3. Create a local dev secret file:
   - copy `.dev.vars.example` → `.dev.vars`
   - set `SESSION_SECRET` to any string

4. Create a D1 database (Cloudflare prints a `database_id`):

```bash
npx wrangler d1 create chatrat-db
npm run db:migrate:local
```

5. Put the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`.

6. Start dev server:

```bash
npm run dev
```

## Free deployment (Cloudflare)
1. Create a free Cloudflare account.
2. Install Wrangler and login:

```bash
npx wrangler login
```

3. Create a D1 database:

```bash
npx wrangler d1 create chatrat-db
```

4. Put the returned `database_id` into `wrangler.toml` (`[[d1_databases]]`).
5. Apply schema:

```bash
npm run db:migrate:remote
```

6. Set secret:

```bash
npx wrangler secret put SESSION_SECRET
```

7. Deploy:

```bash
npm run deploy
```

## Basic safety / anti-spam (MVP)
- REST: per-IP rate limits for `/session` and `/rooms`
- WS: per-IP join limit + per-user message rate limit + message max length

If you want stronger bot protection later, add Cloudflare **Turnstile** to `POST /rooms` and/or WS `message`.

## Optional: Turnstile (bot protection)
If spam becomes a problem, the usual pattern is:
1) Frontend renders a Turnstile widget and gets a `turnstileToken`.
2) Send `turnstileToken` to `POST /v1/rooms` (and/or include it in WS `message`).
3) Backend verifies it with Cloudflare before accepting the action.


