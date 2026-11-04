import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// Explicitly opt in to paid/public cloud work. These are deployment prerequisites,
// not cosmetic toggles: without durable quotas + CAPTCHA public routes fail closed.
export function publicModeConfigured(env = process.env) {
  return env.OPEN_GEO_PUBLIC_ENABLED === "true" &&
    Boolean(env.TURNSTILE_SECRET_KEY && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
      env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN &&
      env.OPEN_GEO_API_KEY?.length >= 32);
}
export function publicError(message, status = 503) {
  return Object.assign(new Error(message), { status });
}
export function clientAddress(request) {
  const value = request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "";
  const candidate = value.split(",")[0].trim();
  if (!isIP(candidate)) throw publicError("A valid visitor address is required for public rate limits.", 403);
  return candidate;
}

export async function verifyPublicChallenge(request, token, { env = process.env, fetchImpl = fetch } = {}) {
  if (!publicModeConfigured(env)) throw publicError("Public scanning is not configured. Use the owner key or import JSON.");
  if (typeof token !== "string" || !token || token.length > 2048) throw publicError("Complete the anti-bot challenge first.", 403);
  const address = clientAddress(request);
  let result;
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: address }),
      signal: AbortSignal.timeout(6_000),
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Siteverify unavailable");
    result = await response.json();
  } catch {
    throw publicError("Anti-bot verification is temporarily unavailable.", 503);
  }
  const expectedHost = new URL(request.url).hostname.toLowerCase();
  if (result?.success !== true || String(result.hostname || "").toLowerCase() !== expectedHost) {
    throw publicError("Anti-bot check failed or expired. Complete the challenge again.", 403);
  }
  return address;
}

export async function consumePublicQuota(request, category, { env = process.env, fetchImpl = fetch } = {}) {
  if (!["scan", "ai"].includes(category)) throw new Error("Unknown quota category");
  if (!publicModeConfigured(env)) throw publicError("Public service is not configured.", 503);
  const address = clientAddress(request);
  const utcDay = new Date().toISOString().slice(0, 10);
  const id = createHmac("sha256", env.OPEN_GEO_API_KEY).update(address).digest("hex").slice(0, 24);
  const personal = "opengeo:" + utcDay + ":" + category + ":ip:" + id;
  const global = "opengeo:" + utcDay + ":" + category + ":global";
  const configured = new URL(env.UPSTASH_REDIS_REST_URL);
  if (configured.protocol !== "https:" || !configured.hostname.endsWith(".upstash.io") || configured.username || configured.password) {
    throw publicError("Public quota store configuration is invalid.");
  }
  // Atomic INCR counters; EXPIRE ensures cleanup after the UTC day rollover.
  const commands = [["INCR", personal], ["EXPIRE", personal, 172800], ["INCR", global], ["EXPIRE", global, 172800]];
  let results;
  try {
    const response = await fetchImpl(configured.origin + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.UPSTASH_REDIS_REST_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(commands), cache: "no-store", signal: AbortSignal.timeout(6_000)
    });
    if (!response.ok) throw new Error("Quota backend failed");
    results = await response.json();
  } catch {
    throw publicError("Public usage quota is temporarily unavailable.");
  }
  const own = Number(results?.[0]?.result), total = Number(results?.[2]?.result);
  if (!Number.isFinite(own) || !Number.isFinite(total)) throw publicError("Quota verification failed.");
  const perVisitor = category === "scan" ? 3 : 2;
  const globally = category === "scan" ? 120 : 30;
  if (own > perVisitor || total > globally) throw publicError("Daily public " + category + " quota reached. Try again tomorrow.", 429);
  return { remaining: Math.max(0, perVisitor - own) };
}

function receiptHmac(snapshot, expires, secret) {
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return createHmac("sha256", secret).update(String(expires) + ":" + digest).digest("base64url");
}
export function signScanReceipt(snapshot, secret, now = Date.now()) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Signing secret is not configured.");
  const expires = now + 15 * 60_000;
  return expires + "." + receiptHmac(snapshot, expires, secret);
}
export function validateScanReceipt(snapshot, receipt, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof receipt !== "string" || receipt.length > 140) return false;
  const parts = receipt.split(".");
  if (parts.length !== 2 || !/^\d{13}$/.test(parts[0]) || !/^[\w-]{43}$/.test(parts[1])) return false;
  const expires = Number(parts[0]);
  if (expires < now || expires > now + 15 * 60_000) return false;
  const expected = Buffer.from(receiptHmac(snapshot, expires, secret));
  const given = Buffer.from(parts[1]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}


/**
 * Atomic one-time redemption of a signed scan receipt. One successful public
 * audit authorizes at most ONE public AI inference, without making visitors
 * complete a second CAPTCHA. Global/per-IP paid request quotas remain separate.
 * Redis failure closes access rather than allowing unbounded replay.
 */
export async function redeemScanReceipt(receipt, { env = process.env, fetchImpl = fetch } = {}) {
  if (!publicModeConfigured(env)) throw publicError("Public service is not configured.");
  if (typeof receipt !== "string" || receipt.length > 140 || !/^\d{13}\.[\w-]{43}$/.test(receipt)) {
    throw publicError("A valid recent website scan is required for AI.", 403);
  }
  const configured = new URL(env.UPSTASH_REDIS_REST_URL);
  if (configured.protocol !== "https:" || !configured.hostname.endsWith(".upstash.io") || configured.username || configured.password) {
    throw publicError("Public quota store configuration is invalid.");
  }
  const key = "opengeo:receipt-used:" + createHash("sha256").update(receipt).digest("hex");
  let result;
  try {
    const response = await fetchImpl(configured.origin + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.UPSTASH_REDIS_REST_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", key, "1", "EX", 900, "NX"]]),
      cache: "no-store",
      signal: AbortSignal.timeout(6_000)
    });
    if (!response.ok) throw new Error("Quota backend failed");
    result = await response.json();
  } catch {
    throw publicError("Public AI verification is temporarily unavailable.", 503);
  }
  if (!Array.isArray(result) || result.length !== 1 || !(result[0] && "result" in result[0])) {
    throw publicError("Public AI verification failed.", 503);
  }
  if (result[0].result !== "OK") {
    throw publicError("This scan has already been analyzed with AI. Run a new scan to request another analysis.", 409);
  }
  return true;
}
