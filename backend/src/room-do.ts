import type { Env, WsClientEvent, WsServerEvent } from "./types";
import { verifySessionToken } from "./auth";
import { bumpLiveCount, genId, getRoom, insertMessage } from "./db";
import { MemoryRateLimiter } from "./rateLimit";
import { safeJsonParse } from "./util";

type ConnState = {
  ws: WebSocket;
  userId: string;
  handle: string;
  isTyping: boolean;
  typingUntil?: number;
};

export class RoomDurableObject {
  private conns = new Map<string, ConnState>();
  private limiterMsg = new MemoryRateLimiter({ limit: 12, windowMs: 10_000 }); // 12 msgs / 10s / user
  private limiterJoin = new MemoryRateLimiter({ limit: 30, windowMs: 60_000 }); // joins / minute / ip

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const roomId = url.pathname.match(/^\/v1\/rooms\/([^/]+)\/ws$/)?.[1];
    if (!roomId) return new Response("Not found", { status: 404 });

    const upgrade = req.headers.get("upgrade")?.toLowerCase();
    if (upgrade !== "websocket") return new Response("Expected websocket", { status: 426 });

    const ip = req.headers.get("cf-connecting-ip") || "ip:unknown";
    const allowJoin = this.limiterJoin.allow(`join:${ip}`);
    if (!allowJoin.ok) return new Response("Rate limited", { status: 429 });

    const token = url.searchParams.get("token") || req.headers.get("sec-websocket-protocol") || "";
    const auth = await verifySessionToken({ secret: this.env.SESSION_SECRET, token });
    if (!auth) return new Response("Unauthorized", { status: 401 });

    const room = await getRoom(this.env, roomId);
    if (!room || room.deleted_at != null) return new Response("Not found", { status: 404 });
    if (room.expires_at <= Date.now()) return new Response("Room expired", { status: 410 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const connId = genId();
    const conn: ConnState = { ws: server, userId: auth.userId, handle: auth.handle, isTyping: false };
    this.conns.set(connId, conn);

    server.addEventListener("message", (ev) => {
      const msg = typeof ev.data === "string" ? ev.data : "";
      void this.onMessage(roomId, connId, msg);
    });
    server.addEventListener("close", () => void this.onClose(roomId, connId));
    server.addEventListener("error", () => void this.onClose(roomId, connId));

    // Initial room state + join
    void this.onJoin(roomId, connId);

    return new Response(null, { status: 101, webSocket: client });
  }

  private membersPreview(): { handle: string }[] {
    const handles: string[] = [];
    for (const c of this.conns.values()) {
      if (!handles.includes(c.handle)) handles.push(c.handle);
      if (handles.length >= 3) break;
    }
    return handles.map((handle) => ({ handle }));
  }

  private broadcast(evt: WsServerEvent) {
    const s = JSON.stringify(evt);
    for (const c of this.conns.values()) {
      try {
        c.ws.send(s);
      } catch {
        // ignore
      }
    }
  }

  private async broadcastRoomState(roomId: string) {
    const room = await getRoom(this.env, roomId);
    if (!room || room.deleted_at != null) return;
    if (room.expires_at <= Date.now()) return;

    this.broadcast({
      type: "room_state",
      roomId,
      liveCount: this.conns.size,
      membersPreview: this.membersPreview(),
      expiresAt: new Date(room.expires_at).toISOString(),
    });
  }

  private async onJoin(roomId: string, connId: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;

    const room = await getRoom(this.env, roomId);
    if (!room || room.expires_at <= Date.now()) {
      this.send(connId, { type: "error", code: "room_expired", message: "Room expired" });
      this.safeClose(connId, 1000, "expired");
      return;
    }

    // Update live count (best effort)
    void bumpLiveCount(this.env, roomId, this.conns.size);

    const nowIso = new Date().toISOString();
    this.broadcast({ type: "member_joined", roomId, handle: conn.handle, at: nowIso });
    void insertMessage(this.env, { messageId: genId(), roomId, kind: "system", body: `${conn.handle} joined`, createdAtMs: Date.now() });
    void this.broadcastRoomState(roomId);
  }

  private async onClose(roomId: string, connId: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.conns.delete(connId);

    void bumpLiveCount(this.env, roomId, this.conns.size);

    const nowIso = new Date().toISOString();
    this.broadcast({ type: "member_left", roomId, handle: conn.handle, at: nowIso });
    void insertMessage(this.env, { messageId: genId(), roomId, kind: "system", body: `${conn.handle} left the room`, createdAtMs: Date.now() });
    void this.broadcastRoomState(roomId);
  }

  private send(connId: string, evt: WsServerEvent) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    try {
      conn.ws.send(JSON.stringify(evt));
    } catch {
      // ignore
    }
  }

  private safeClose(connId: string, code: number, reason: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    try {
      conn.ws.close(code, reason);
    } catch {
      // ignore
    }
  }

  private async onMessage(roomId: string, connId: string, raw: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;

    const room = await getRoom(this.env, roomId);
    if (!room || room.expires_at <= Date.now()) {
      this.send(connId, { type: "error", code: "room_expired", message: "Room expired" });
      this.safeClose(connId, 1000, "expired");
      return;
    }

    const evt = safeJsonParse<WsClientEvent>(raw);
    if (!evt || typeof (evt as any).type !== "string") {
      this.send(connId, { type: "error", code: "bad_request", message: "Invalid event" });
      return;
    }

    if (evt.type === "leave") {
      this.safeClose(connId, 1000, "left");
      return;
    }

    if (evt.type === "typing") {
      const isTyping = !!evt.isTyping;
      conn.isTyping = isTyping;
      conn.typingUntil = isTyping ? Date.now() + 4000 : undefined;
      this.broadcast({
        type: "typing",
        roomId,
        handle: conn.handle,
        isTyping,
        at: new Date().toISOString(),
      });
      return;
    }

    if (evt.type === "message") {
      const body = (evt.body ?? "").trim();
      if (!body) return;
      if (body.length > 800) {
        this.send(connId, { type: "error", code: "bad_request", message: "Message too long" });
        return;
      }

      const rl = this.limiterMsg.allow(`msg:${conn.userId}`);
      if (!rl.ok) {
        this.send(connId, { type: "error", code: "rate_limited", message: "Slow down" });
        return;
      }

      const messageId = genId();
      const atIso = new Date().toISOString();
      void insertMessage(this.env, {
        messageId,
        roomId,
        kind: "user",
        userId: conn.userId,
        handle: conn.handle,
        body,
        createdAtMs: Date.now(),
      });

      this.broadcast({ type: "message", roomId, messageId, handle: conn.handle, body, at: atIso });
      return;
    }

    // join is currently implicit on connect; ignore if received
    if (evt.type === "join") return;
  }
}

