import { base64UrlDecodeToU8, base64UrlEncode, isoNow } from "./util";

type TokenPayload = {
  sub: string; // userId
  h: string; // handle
  exp: number; // unix seconds
};

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(sig);
}

async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigU8 = base64UrlDecodeToU8(signature);
  if (!sigU8) return false;
  // TS can be picky about BufferSource types; verify accepts ArrayBuffer.
  const sigCopy = new Uint8Array(sigU8); // forces a real ArrayBuffer
  return await crypto.subtle.verify("HMAC", key, sigCopy.buffer, new TextEncoder().encode(data));
}

export async function mintSessionToken(opts: {
  secret: string;
  userId: string;
  handle: string;
  ttlSeconds: number;
  nowMs?: number;
}): Promise<{ token: string; expiresAt: string }> {
  const nowMs = opts.nowMs ?? Date.now();
  const exp = Math.floor(nowMs / 1000) + opts.ttlSeconds;
  const payload: TokenPayload = { sub: opts.userId, h: opts.handle, exp };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(opts.secret, payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: isoNow(exp * 1000) };
}

export async function verifySessionToken(opts: {
  secret: string;
  token: string;
  nowMs?: number;
}): Promise<{ userId: string; handle: string } | null> {
  const nowMs = opts.nowMs ?? Date.now();
  const parts = opts.token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts as [string, string];
  const ok = await hmacVerify(opts.secret, payloadB64, sig);
  if (!ok) return null;
  const payloadU8 = base64UrlDecodeToU8(payloadB64);
  if (!payloadU8) return null;
  const payload = JSON.parse(new TextDecoder().decode(payloadU8)) as TokenPayload;
  if (!payload?.sub || !payload?.h || !payload?.exp) return null;
  if (payload.exp * 1000 <= nowMs) return null;
  return { userId: payload.sub, handle: payload.h };
}

export function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

