export type UUID = string;

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "room_expired"
  | "server_error";

export type ApiErrorBody = {
  ok: false;
  code: ApiErrorCode;
  message: string;
};

export type ApiOk<T> = { ok: true; data: T };

export type SessionCreateRequest = {
  handle: string;
  deviceId?: string;
  lat?: number;
  lng?: number;
};

export type SessionCreateResponse = {
  userId: UUID;
  handle: string;
  token: string;
  tokenExpiresAt: string; // ISO
};

export type RoomSummary = {
  id: UUID;
  name: string;
  topic: string | null;
  lat: number;
  lng: number;
  expiresAt: string; // ISO
  liveCount: number;
  distanceKm?: number; // computed server-side when lat/lng provided
};

export type RoomsNearbyResponse = {
  rooms: RoomSummary[];
};

export type RoomCreateRequest = {
  name: string;
  topic?: string;
  lat: number;
  lng: number;
};

export type RoomCreateResponse = {
  id: UUID;
  expiresAt: string; // ISO
};

export type MessageKind = "user" | "system";

export type MessageRow = {
  id: UUID;
  roomId: UUID;
  kind: MessageKind;
  handle: string | null;
  body: string;
  createdAt: string; // ISO
};

export type RoomMessagesResponse = {
  messages: MessageRow[];
  nextBefore?: string; // ISO cursor (oldest returned)
};

// -------- Realtime (WebSocket) --------
export type WsClientEvent =
  | { type: "join" }
  | { type: "leave" }
  | { type: "typing"; isTyping: boolean }
  | { type: "message"; body: string };

export type WsServerEvent =
  | {
      type: "room_state";
      roomId: UUID;
      liveCount: number;
      membersPreview: { handle: string }[];
      expiresAt: string;
    }
  | { type: "member_joined"; roomId: UUID; handle: string; at: string }
  | { type: "member_left"; roomId: UUID; handle: string; at: string }
  | {
      type: "typing";
      roomId: UUID;
      handle: string;
      isTyping: boolean;
      at: string;
    }
  | {
      type: "message";
      roomId: UUID;
      messageId: UUID;
      handle: string;
      body: string;
      at: string;
    }
  | { type: "system"; roomId: UUID; body: string; at: string }
  | { type: "error"; code: ApiErrorCode; message: string };

export type Env = {
  CHATRAT_DB: D1Database;
  ROOM_DO: DurableObjectNamespace;
  SESSION_SECRET: string;
  TOKEN_TTL_SECONDS: string;
  ROOM_TTL_SECONDS: string;
};

