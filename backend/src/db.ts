import type { Env, MessageKind } from "./types";

export function nowMs(): number {
  return Date.now();
}

export function genId(): string {
  // UUID v4 without dependencies
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function upsertUser(env: Env, opts: { userId: string; handle: string; deviceHash?: string | null }) {
  const t = nowMs();
  await env.CHATRAT_DB.prepare(
    `INSERT INTO users (id, handle, device_hash, created_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET handle=excluded.handle, device_hash=excluded.device_hash, last_seen_at=excluded.last_seen_at`,
  )
    .bind(opts.userId, opts.handle, opts.deviceHash ?? null, t)
    .run();
}

export async function createRoom(env: Env, opts: {
  roomId: string;
  name: string;
  topic: string | null;
  creatorUserId: string;
  lat: number;
  lng: number;
  expiresAtMs: number;
}) {
  const t = nowMs();
  await env.CHATRAT_DB.prepare(
    `INSERT INTO rooms
      (id, name, topic, creator_user_id, lat, lng, created_at, expires_at, deleted_at, live_count, live_updated_at)
     VALUES
      (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 0, ?7)`,
  )
    .bind(opts.roomId, opts.name, opts.topic, opts.creatorUserId, opts.lat, opts.lng, t, opts.expiresAtMs)
    .run();
}

export async function getRoom(env: Env, roomId: string): Promise<{
  id: string;
  name: string;
  topic: string | null;
  lat: number;
  lng: number;
  expires_at: number;
  deleted_at: number | null;
  live_count: number;
} | null> {
  const r = await env.CHATRAT_DB.prepare(
    `SELECT id, name, topic, lat, lng, expires_at, deleted_at, live_count
     FROM rooms WHERE id=?1 LIMIT 1`,
  )
    .bind(roomId)
    .first();
  if (!r) return null;
  return r as any;
}

export async function bumpLiveCount(env: Env, roomId: string, liveCount: number) {
  const t = nowMs();
  await env.CHATRAT_DB.prepare(
    `UPDATE rooms SET live_count=?2, live_updated_at=?3 WHERE id=?1`,
  )
    .bind(roomId, liveCount, t)
    .run();
}

export async function insertMessage(env: Env, opts: {
  messageId: string;
  roomId: string;
  kind: MessageKind;
  userId?: string | null;
  handle?: string | null;
  body: string;
  createdAtMs?: number;
}) {
  const t = opts.createdAtMs ?? nowMs();
  await env.CHATRAT_DB.prepare(
    `INSERT INTO messages (id, room_id, kind, user_id, handle, body, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(opts.messageId, opts.roomId, opts.kind, opts.userId ?? null, opts.handle ?? null, opts.body, t)
    .run();
}

