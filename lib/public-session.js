import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { clientAddress, publicError, publicModeConfigured, verifyPublicChallenge } from "./public-access.js";

export const VERIFIED_COOKIE = "opengeo_verified";
export const SESSION_TTL_SECONDS = 2 * 60 * 60; // A browser verifies once per 2h (IP-bound).
const TOKEN_RE = /^\d{13}\.[a-f0-9]{24}\.[a-zA-Z0-9_-]{43}$/;

function sign(expires, nonce, ip, secret) {
  return createHmac("sha256", secret).update("opengeo-v1:" + expires + ":" + nonce + ":" + ip).digest("base64url");
}
export function makeVerifiedSession(request, { secret = process.env.OPEN_GEO_API_KEY, now = Date.now(), nonce = randomBytes(12).toString("hex") } = {}) {
  if (!secret || secret.length < 32) throw publicError("Session secret unavailable.");
  const expires = now + SESSION_TTL_SECONDS * 1000;
  const ip = clientAddress(request);
  return { token: expires + "." + nonce + "." + sign(expires, nonce, ip, secret), expires };
}
export function validSessionToken(request, token, { secret = process.env.OPEN_GEO_API_KEY, now = Date.now() } = {}) {
  if (!secret || secret.length < 32 || typeof token !== "string" || !TOKEN_RE.test(token)) return false;
  const [expiresText, nonce, signature] = token.split(".");
  const expires = Number(expiresText);
  if (expires <= now || expires > now + SESSION_TTL_SECONDS * 1000) return false;
  try {
    const expected = Buffer.from(sign(expires, nonce, clientAddress(request), secret));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
export function getVerifiedSession(request, opts = {}) {
  const cookie = request.headers.get("cookie") || "";
  const raw = cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith(VERIFIED_COOKIE + "="));
  const token = raw?.slice(VERIFIED_COOKIE.length + 1);
  return validSessionToken(request, token || "", opts);
}
export function verifiedCookieHeader(token) {
  return VERIFIED_COOKIE + "=" + token +
    "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + SESSION_TTL_SECONDS;
}
export function expiredCookieHeader() {
  return VERIFIED_COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}
export async function establishVerifiedSession(request, turnstileToken, options = {}) {
  if (!publicModeConfigured(options.env || process.env)) throw publicError("Public verification is disabled.");
  await verifyPublicChallenge(request, turnstileToken, options);
  return makeVerifiedSession(request, { secret: options.env?.OPEN_GEO_API_KEY || process.env.OPEN_GEO_API_KEY });
}
