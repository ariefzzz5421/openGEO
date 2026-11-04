import { auditSite } from "../../../src/audit.js";
import { validateUrl } from "../../../src/network.js";
import { checkAuditAccess } from "../../../lib/audit-access.js";
import { buildAISnapshot } from "../../../lib/ai-evidence.js";
import { verifyPublicChallenge, consumePublicQuota, signScanReceipt } from "../../../lib/public-access.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_CACHE = { "Cache-Control": "no-store, private", "Content-Type": "application/json" };
function respond(body, status) { return Response.json(body, { status, headers: NO_CACHE }); }

// Defense-in-depth in-process throttle; durable public quotas are in Upstash.
const started = new Map();
function throttle(id) {
  const now = Date.now();
  if (started.size > 500) for (const [k, v] of started) if (now - v > 120_000) started.delete(k);
  const previous = started.get(id);
  if (previous && now - previous < 15_000) return false;
  started.set(id, now);
  return true;
}

export async function POST(request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 8_192) return respond({ error: "Request body is too large." }, 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8_192) return respond({ error: "Request body is too large." }, 413);
    let payload;
    try { payload = JSON.parse(raw); }
    catch { return respond({ error: "Invalid JSON request." }, 400); }
    const url = String(payload?.url || "");
    if (!url || url.length > 2000) return respond({ error: "Provide a valid website URL (max 2000 characters)." }, 400);
    const key = request.headers.get("x-opengeo-key") || "";
    const isOwner = Boolean(key);
    const maxPages = payload?.maxPages == null ? 3 : Number(payload.maxPages);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > (isOwner ? 5 : 3)) {
      return respond({ error: "Public scans support 1–3 pages; owner scans support up to 5." }, 400);
    }
    const target = isOwner ? checkAuditAccess({
      url, key, allowedHosts: process.env.OPEN_GEO_ALLOWED_HOSTS,
      expectedKey: process.env.OPEN_GEO_API_KEY,
      production: process.env.NODE_ENV === "production",
      allowAuthenticatedPublicHosts: process.env.OPEN_GEO_ALLOW_AUTHENTICATED_PUBLIC_HOSTS === "true"
    }) : validateUrl(url);
    if (!isOwner) {
      // Every public scan requires a fresh one-time challenge AND cross-instance quota.
      await verifyPublicChallenge(request, payload?.turnstileToken);
      await consumePublicQuota(request, "scan");
    } else if (!throttle(target.hostname)) {
      return respond({ error: "Wait 15 seconds between owner scans of this site." }, 429);
    }
    // No Playwright, no JS execution, no cross-domain canonical probes.
    const report = await auditSite(target.href, { maxPages, renderJs: false, verifyCanonical: false });
    if (isOwner) return respond(report, 200);
    const receipt = signScanReceipt(buildAISnapshot(report), process.env.OPEN_GEO_API_KEY);
    return respond({ report, receipt, publicScan: true }, 200);
  } catch (error) {
    const status = Number(error?.status) ||
      (/URL|address|hostname|HTTP|protocol|port/i.test(error?.message || "") ? 400 : 502);
    const safe = status >= 500 && status !== 503 ?
      "Website scan failed. Check site availability, robots policy and server logs." :
      error.message;
    return respond({ error: safe }, status);
  }
}
