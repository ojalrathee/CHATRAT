import type { Env, RoomsNearbyResponse, SessionCreateRequest, SessionCreateResponse, RoomCreateRequest, RoomCreateResponse, RoomMessagesResponse } from "./types";
import { getBearerToken, mintSessionToken, verifySessionToken } from "./auth";
import { boundingBoxKm, haversineKm } from "./geo";
import { createRoom as dbCreateRoom, genId, insertMessage, upsertUser } from "./db";
import { badRequest, json, notFound, rateLimited, serverError, unauthorized } from "./util";
import { MemoryRateLimiter } from "./rateLimit";

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "content-type,authorization");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function parseNumber(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validateHandle(handle: string): string | null {
  const h = handle.trim();
  if (h.length < 2 || h.length > 20) return "Handle must be 2–20 chars.";
  if (!/^[a-zA-Z0-9_\.]+$/.test(h)) return "Handle can only use letters, numbers, underscore, dot.";
  return null;
}

function validateRoomName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2 || n.length > 40) return "Room name must be 2–40 chars.";
  return null;
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function requireAuth(req: Request, env: Env): Promise<{ userId: string; handle: string } | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  return await verifySessionToken({ secret: env.SESSION_SECRET, token });
}

export { RoomDurableObject } from "./room-do";

const rlSession = new MemoryRateLimiter({ limit: 20, windowMs: 60_000 }); // sessions/min/ip
const rlCreateRoom = new MemoryRateLimiter({ limit: 6, windowMs: 60_000 }); // rooms/min/ip

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(req.url);
      const { pathname } = url;
      const ip = req.headers.get("cf-connecting-ip") || "ip:unknown";

      if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

      // Health check
      if (pathname === "/") return withCors(new Response("ok"));

      // WS passthrough: /v1/rooms/:roomId/ws
      const wsMatch = pathname.match(/^\/v1\/rooms\/([^/]+)\/ws$/);
      if (wsMatch) {
        const roomId = wsMatch[1]!;
        const id = env.ROOM_DO.idFromName(roomId);
        const stub = env.ROOM_DO.get(id);
        const fwd = new Request(req.url, req);
        return await stub.fetch(fwd);
      }

      // POST /v1/session
      if (pathname === "/v1/session" && req.method === "POST") {
        const allow = rlSession.allow(`session:${ip}`);
        if (!allow.ok) return withCors(rateLimited("Too many sessions. Try again soon."));

        const body = await readJson<SessionCreateRequest>(req);
        if (!body) return withCors(badRequest("Invalid JSON."));
        const err = validateHandle(body.handle ?? "");
        if (err) return withCors(badRequest(err));

        const userId = genId();
        const ttlSeconds = Math.max(60, Number(env.TOKEN_TTL_SECONDS || "604800"));
        const { token, expiresAt } = await mintSessionToken({
          secret: env.SESSION_SECRET,
          userId,
          handle: body.handle.trim(),
          ttlSeconds,
        });

        const deviceHash = body.deviceId ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.deviceId)) : null;
        const deviceHashB64 = deviceHash ? btoa(String.fromCharCode(...new Uint8Array(deviceHash))).slice(0, 64) : null;

        ctx.waitUntil(upsertUser(env, { userId, handle: body.handle.trim(), deviceHash: deviceHashB64 }));

        const resp: SessionCreateResponse = { userId, handle: body.handle.trim(), token, tokenExpiresAt: expiresAt };
        return withCors(json({ ok: true, data: resp }));
      }

      // GET /v1/rooms/nearby
      if (pathname === "/v1/rooms/nearby" && req.method === "GET") {
        const lat = parseNumber(url.searchParams.get("lat"));
        const lng = parseNumber(url.searchParams.get("lng"));
        const radiusKm = parseNumber(url.searchParams.get("radiusKm")) ?? 10;
        if (lat == null || lng == null) return withCors(badRequest("lat and lng are required."));

        const r = Math.max(0.5, Math.min(50, radiusKm));
        const bb = boundingBoxKm({ lat, lng }, r);
        const now = Date.now();

        const rows = await env.CHATRAT_DB.prepare(
          `SELECT id, name, topic, lat, lng, expires_at, live_count
           FROM rooms
           WHERE deleted_at IS NULL
             AND expires_at > ?1
             AND lat BETWEEN ?2 AND ?3
             AND lng BETWEEN ?4 AND ?5
           ORDER BY expires_at ASC
           LIMIT 100`,
        )
          .bind(now, bb.minLat, bb.maxLat, bb.minLng, bb.maxLng)
          .all();

        const rooms = (rows.results as any[]).map((x) => {
          const distanceKm = haversineKm({ lat, lng }, { lat: Number(x.lat), lng: Number(x.lng) });
          return {
            id: String(x.id),
            name: String(x.name),
            topic: x.topic == null ? null : String(x.topic),
            lat: Number(x.lat),
            lng: Number(x.lng),
            expiresAt: new Date(Number(x.expires_at)).toISOString(),
            liveCount: Number(x.live_count ?? 0),
            distanceKm,
          };
        }).filter((x) => x.distanceKm <= r)
          .sort((a, b) => (a.distanceKm! - b.distanceKm!));

        const resp: RoomsNearbyResponse = { rooms };
        return withCors(json({ ok: true, data: resp }));
      }

      // POST /v1/rooms
      if (pathname === "/v1/rooms" && req.method === "POST") {
        const allow = rlCreateRoom.allow(`create_room:${ip}`);
        if (!allow.ok) return withCors(rateLimited("Too many rooms created. Try again soon."));

        const auth = await requireAuth(req, env);
        if (!auth) return withCors(unauthorized());

        const body = await readJson<RoomCreateRequest>(req);
        if (!body) return withCors(badRequest("Invalid JSON."));
        const err = validateRoomName(body.name ?? "");
        if (err) return withCors(badRequest(err));
        if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) return withCors(badRequest("lat/lng required."));
        if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) return withCors(badRequest("lat/lng out of range."));
        const topicTrim = (body.topic ?? "").trim();
        if (topicTrim.length > 60) return withCors(badRequest("Topic must be ≤ 60 chars."));

        const roomId = genId();
        const ttlSeconds = Math.max(60, Number(env.ROOM_TTL_SECONDS || "14400"));
        const expiresAtMs = Date.now() + ttlSeconds * 1000;
        await dbCreateRoom(env, {
          roomId,
          name: body.name.trim(),
          topic: topicTrim || null,
          creatorUserId: auth.userId,
          lat: Number(body.lat.toFixed(4)),
          lng: Number(body.lng.toFixed(4)),
          expiresAtMs,
        });

        // Store system message: created
        ctx.waitUntil(
          insertMessage(env, {
            messageId: genId(),
            roomId,
            kind: "system",
            body: `${auth.handle} created this room`,
            createdAtMs: Date.now(),
          }),
        );

        const resp: RoomCreateResponse = { id: roomId, expiresAt: new Date(expiresAtMs).toISOString() };
        return withCors(json({ ok: true, data: resp }, { status: 201 }));
      }

      // GET /v1/rooms/:roomId/messages
      const msgMatch = pathname.match(/^\/v1\/rooms\/([^/]+)\/messages$/);
      if (msgMatch && req.method === "GET") {
        const roomId = msgMatch[1]!;
        const limit = Math.max(1, Math.min(100, parseNumber(url.searchParams.get("limit")) ?? 50));
        const afterIso = url.searchParams.get("after");
        const beforeIso = url.searchParams.get("before");
        if (afterIso && beforeIso) return withCors(badRequest("Use only one cursor: after or before."));

        let rows: any;
        if (afterIso) {
          const afterMs = Date.parse(afterIso);
          if (!Number.isFinite(afterMs)) return withCors(badRequest("Invalid after cursor."));
          rows = await env.CHATRAT_DB.prepare(
            `SELECT id, room_id, kind, handle, body, created_at
             FROM messages
             WHERE room_id = ?1 AND created_at > ?2
             ORDER BY created_at ASC
             LIMIT ?3`,
          )
            .bind(roomId, afterMs, limit)
            .all();
        } else {
          const beforeMs = beforeIso ? Date.parse(beforeIso) : Date.now() + 60_000;
          if (!Number.isFinite(beforeMs)) return withCors(badRequest("Invalid before cursor."));
          rows = await env.CHATRAT_DB.prepare(
            `SELECT id, room_id, kind, handle, body, created_at
             FROM messages
             WHERE room_id = ?1 AND created_at < ?2
             ORDER BY created_at DESC
             LIMIT ?3`,
          )
            .bind(roomId, beforeMs, limit)
            .all();
        }

        const msgsRaw = (rows.results as any[]).map((m) => ({
          id: String(m.id),
          roomId: String(m.room_id),
          kind: (m.kind === "system" ? "system" : "user") as "system" | "user",
          handle: m.handle == null ? null : String(m.handle),
          body: String(m.body),
          createdAt: new Date(Number(m.created_at)).toISOString(),
        }));

        const messages = afterIso ? msgsRaw : msgsRaw.reverse(); // ascending for UI
        const nextBefore = !afterIso && messages.length ? messages[0]!.createdAt : undefined;
        const resp: RoomMessagesResponse = { messages, nextBefore };
        return withCors(json({ ok: true, data: resp }));
      }

      return withCors(notFound());
    } catch (e: any) {
      // D1 errors etc.
      return withCors(serverError(e?.message || "Unhandled error"));
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Best-effort cleanup; safe to fail silently.
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        // Soft-delete expired rooms (keeps history for a bit); hard-delete messages older than 7 days.
        await env.CHATRAT_DB.prepare(
          `UPDATE rooms SET deleted_at = COALESCE(deleted_at, ?2)
           WHERE expires_at <= ?1 AND deleted_at IS NULL`,
        )
          .bind(now, now)
          .run();
        const weekAgo = now - 7 * 24 * 3600 * 1000;
        await env.CHATRAT_DB.prepare(`DELETE FROM messages WHERE created_at < ?1`).bind(weekAgo).run();
      })(),
    );
  },
};

