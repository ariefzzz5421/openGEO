import { establishVerifiedSession, expiredCookieHeader, getVerifiedSession, verifiedCookieHeader } from "../../../../lib/public-session.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function reply(payload, status = 200, cookie) {
  return Response.json(payload, { status, headers: { ...HEADERS, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}
export async function GET(request) {
  return reply({ verified: getVerifiedSession(request) });
}
export async function POST(request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 4096) return reply({ error: "Request too large." }, 413);
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096) return reply({ error: "Request too large." }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return reply({ error: "Invalid JSON." }, 400); }
    const session = await establishVerifiedSession(request, body?.turnstileToken);
    return reply({ verified: true, expiresAt: new Date(session.expires).toISOString() }, 200,
      verifiedCookieHeader(session.token));
  } catch (error) {
    const status = [403, 413, 429, 503].includes(error?.status) ? error.status : 503;
    return reply({ error: status === 503 ? "Verification service unavailable. Try again later or use private owner mode." : error.message }, status);
  }
}
export async function DELETE() {
  return reply({ verified: false }, 200, expiredCookieHeader());
}
