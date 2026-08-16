export function json<T>(data: T, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function badRequest(message: string, code: string = "bad_request"): Response {
  return json({ ok: false, code, message }, { status: 400 });
}

export function unauthorized(message = "Unauthorized"): Response {
  return json({ ok: false, code: "unauthorized", message }, { status: 401 });
}

export function forbidden(message = "Forbidden"): Response {
  return json({ ok: false, code: "forbidden", message }, { status: 403 });
}

export function notFound(message = "Not found"): Response {
  return json({ ok: false, code: "not_found", message }, { status: 404 });
}

export function rateLimited(message = "Rate limited"): Response {
  return json({ ok: false, code: "rate_limited", message }, { status: 429 });
}

export function serverError(message = "Server error"): Response {
  return json({ ok: false, code: "server_error", message }, { status: 500 });
}

export function isoNow(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64;
}

export function base64UrlDecodeToU8(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  } catch {
    return null;
  }
}

