import { authorizeAIRequest } from "../../../../lib/ai-access.js";
import { validateAISnapshot } from "../../../../lib/ai-evidence.js";
import { runHybridAnalysis } from "../../../../lib/ai-providers.js";
import { verifyPublicChallenge, consumePublicQuota, validateScanReceipt } from "../../../../lib/public-access.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
const MAX_REQUEST_BYTES = 18_000;
let lastOwnerStarted = 0;

function respond(data, status) { return Response.json(data, { status, headers: NO_STORE }); }

export async function POST(request) {
  try {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_REQUEST_BYTES) return respond({ error: "AI request exceeds 18 KB." }, 413);
    const key = request.headers.get("x-opengeo-key") || "";
    const isOwner = Boolean(key);
    if (process.env.OPEN_GEO_AI_ENABLED !== "true") {
      return respond({ error: "AI is disabled by the site operator." }, 503);
    }
    if (isOwner) authorizeAIRequest(key, process.env.OPEN_GEO_API_KEY, true);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) return respond({ error: "AI request exceeds 18 KB." }, 413);
    let payload;
    try { payload = JSON.parse(raw); }
    catch { return respond({ error: "Invalid JSON request." }, 400); }
    try { validateAISnapshot(payload?.snapshot); }
    catch (error) { return respond({ error: error.message }, 400); }

    if (isOwner) {
      if (Date.now() - lastOwnerStarted < 30_000) return respond({ error: "Owner AI cooldown active: 30 seconds." }, 429);
      lastOwnerStarted = Date.now();
    } else {
      if (!validateScanReceipt(payload.snapshot, payload?.receipt, process.env.OPEN_GEO_API_KEY)) {
        return respond({ error: "Run a fresh public website scan before requesting AI analysis." }, 403);
      }
      await verifyPublicChallenge(request, payload?.turnstileToken);
      await consumePublicQuota(request, "ai");
    }
    const result = await runHybridAnalysis(payload.snapshot, {
      openaiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPEN_GEO_OPENAI_MODEL || "gpt-6-luna",
      geminiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.OPEN_GEO_GEMINI_MODEL || "gemini-3.5-flash-lite",
      groqKey: process.env.GROQ_API_KEY,
      groqModel: process.env.OPEN_GEO_GROQ_MODEL || "openai/gpt-oss-20b",
      preferred: process.env.OPEN_GEO_AI_PROVIDER || "openai"
    });
    return respond(result, 200);
  } catch (error) {
    const status = [400, 401, 403, 413, 429, 502, 503].includes(error?.status) ? error.status : 502;
    const message = status === 502 && error?.status !== 502 ?
      "AI analysis failed. Use offline Fix Advisor and check provider settings." : error.message;
    return respond({ error: message }, status);
  }
}
