# CHATRAT Backend

A high-performance, real-time, anonymous proximity chat backend designed to connect users in nearby geographic locations. This backend is built to power the CHATRAT frontend (e.g., `chatrat.html`) and is designed to run with zero-cost hosting on Cloudflare's serverless stack.

## Features
- **Anonymous Sessions:** Handle-only sessions without the friction of a formal login.
- **Proximity-Based Chat Rooms:** Interactive chat rooms created around geographic coordinates (defaulting to a 10km radius) with a automatic 4-hour room expiry.
- **Real-Time Communication:** Bi-directional real-time messaging, join/leave events, and live typing indicators powered by WebSockets.
- **Zero-Cost Friendly Stack:** Built on top of Cloudflare Workers, Durable Objects, and Cloudflare D1 (SQLite).

---

## Tech Stack
- **Cloudflare Workers:** Serverless compute platform hosting the REST API endpoints.
- **Durable Objects:** State-maintaining serverless actors, maintaining one dedicated WebSocket "room server" per active chat room to coordinate real-time connections.
- **Cloudflare D1 (SQLite):** Serverless SQL database managing room listings and historical message logs.
- **TypeScript:** Fully typed codebase for server stability and clear data contract modeling.

---

## API Reference

### Base URL
```
/v1
```

### Endpoints

#### 1. Create/Resume Session
Create or resume an anonymous, handle-only session.
* **Path:** `POST /session`
* **Request Body:**
  ```json
  {
    "handle": "streetrat_99",
    "deviceId": "optional-stable-id"
  }
  ```
* **Response (Success):**
  ```json
  {
    "ok": true,
    "data": {
      "token": "string",
      "tokenExpiresAt": "string (ISO Timestamp)",
      "userId": "string",
      "handle": "streetrat_99"
    }
  }
  ```

#### 2. Get Nearby Rooms
Query chat rooms within a specific geographic range.
* **Path:** `GET /rooms/nearby`
* **Query Parameters:**
  - `lat` (float, required) — Latitude of the user
  - `lng` (float, required) — Longitude of the user
  - `radiusKm` (integer, optional) — Search radius (default is `10` km)
* **Response (Success):**
  ```json
  {
    "ok": true,
    "data": [
      {
        "id": "string",
        "name": "Chai Gang ☕",
        "topic": "Morning vibes",
        "distanceKm": 1.2,
        "liveCount": 5
      }
    ]
  }
  ```

#### 3. Create a Chat Room
Create a new localized chat room. **Authentication Required.**
* **Path:** `POST /rooms`
* **Headers:** `Authorization: Bearer <token>`
* **Request Body:**
  ```json
  {
    "name": "Chai Gang ☕",
    "topic": "Morning vibes",
    "lat": 29.15,
    "lng": 75.72
  }
  ```

#### 4. Fetch Message History (Scrollback Paging)
Retrieve historical messages from a room before a specific timeline cursor.
* **Path:** `GET /rooms/:roomId/messages`
* **Query Parameters:**
  - `limit` (integer, optional) — Number of messages to fetch (default/max: `50`)
  - `before` (string, ISO Timestamp, required) — Cursor timestamp for fetching older messages

#### 5. Fetch Message History (Polling Fallback)
Retrieve new messages since a specific timeline cursor (used as a backup to WebSockets).
* **Path:** `GET /rooms/:roomId/messages`
* **Query Parameters:**
  - `limit` (integer, optional) — Number of messages to fetch (default/max: `50`)
  - `after` (string, ISO Timestamp, required) — Cursor timestamp for fetching newer messages

---

## Real-Time WebSocket Protocol

### Connection Establishment
To establish a live connection to a room, initiate a WebSocket connection to:
```
wss://<your-domain>/v1/rooms/<roomId>/ws?token=<token>
```

### Client-to-Server Events
Clients can transmit JSON-formatted events over the WebSocket connection:

#### Typing Indicator
```json
{
  "type": "typing",
  "isTyping": true
}
```

#### Send Message
```json
{
  "type": "message",
  "body": "hello"
}
```

### Server-to-Client Events
The server pushes structured real-time events to connected clients. Detailed interfaces can be verified in `src/types.ts`.
- `room_state` — Sent immediately upon connection to sync current room details
- `member_joined` — Broadcasted when a new user joins the room
- `member_left` — Broadcasted when a user disconnects or leaves the room
- `typing` — Informs clients of user typing status changes
- `message` — Relays a newly posted chat message
- `system` — System-generated notifications
- `error` — Informational or connection errors

---

## Local Development Setup

### Prerequisites
- Node.js (LTS version recommended)
- npm package manager

### Steps
1. **Clone and Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Copy the example environment file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   Open `.dev.vars` and set the `SESSION_SECRET` variable to any secure string of your choice.

3. **Database Initialization:**
   Initialize your local Cloudflare D1 SQLite database instance:
   ```bash
   npx wrangler d1 create chatrat-db
   ```
   Run the local database migrations to set up the database schema:
   ```bash
   npm run db:migrate:local
   ```
   Copy the printed `database_id` from the output and update your `wrangler.toml` configuration file under the `[[d1_databases]]` section.

4. **Start the Development Server:**
   Launch the local wrangler server:
   ```bash
   npm run dev
   ```

---

## Production Deployment (Cloudflare)

To deploy the backend to Cloudflare's serverless infrastructure:

1. **Sign Up/In:** Ensure you have a free [Cloudflare](https://dash.cloudflare.com) account.
2. **Authenticate Wrangler:** Login using the CLI tool:
   ```bash
   npx wrangler login
   ```
3. **Provision Production D1 Database:**
   ```bash
   npx wrangler d1 create chatrat-db
   ```
4. **Configure Database ID:** Update your production `wrangler.toml` file under the `[[d1_databases]]` section with the printed `database_id`.
5. **Apply Remote Migrations:** Build and migrate the production SQLite tables:
   ```bash
   npm run db:migrate:remote
   ```
6. **Set Production Secrets:** Securely inject the `SESSION_SECRET` token:
   ```bash
   npx wrangler secret put SESSION_SECRET
   ```
7. **Deploy:** Compile and publish your serverless worker live to Cloudflare:
   ```bash
   npm run deploy
   ```

---

## Anti-Spam & Security (MVP)
The backend enforces basic defensive safety boundaries at the edge:
- **REST Endpoints:** Geographic IP-based rate limiting on `/session` and `/rooms` creation.
- **WebSocket Gateway:** Connection limits per-IP, message frequency rate limits per-user, and enforced maximum message lengths.

### Optional Bot Protection (Cloudflare Turnstile)
If automated spam becomes a threat:
1. Integrate a Turnstile widget onto your frontend to obtain a `turnstileToken`.
2. Send the token inside the payload of your `POST /v1/rooms` requests and/or verify it during the WebSocket messaging handshakes.
3. The backend validates the integrity of the token against Cloudflare's verification API before allowing writes.

---
*Created by [ojalrathee](https://github.com/ojalrathee).*
