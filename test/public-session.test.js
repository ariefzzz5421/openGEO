import test from "node:test";
import assert from "node:assert/strict";
import { makeVerifiedSession, validSessionToken, getVerifiedSession, verifiedCookieHeader, SESSION_TTL_SECONDS } from "../lib/public-session.js";
import { actionGuide, capabilityCards } from "../lib/action-guidance.js";

const secret = "8".repeat(64);
const source = (ip = "203.0.113.21", cookie = "") => new Request("https://opengeo-studio.vercel.app/api/public/session", {
  headers: { "x-vercel-forwarded-for": ip, ...(cookie ? { cookie } : {}) }
});

test("one verified Turnstile session can authorize repeated scans without exposing the owner secret", () => {
  const now = Date.UTC(2026, 10, 4, 14, 30);
  const issued = makeVerifiedSession(source(), { secret, now, nonce: "abcd".repeat(6) });
  assert.equal(issued.expires, now + SESSION_TTL_SECONDS * 1000);
  assert.equal(validSessionToken(source(), issued.token, { secret, now: now + 5_000 }), true);
  const cookie = verifiedCookieHeader(issued.token);
  assert.match(cookie, /HttpOnly;/);
  assert.match(cookie, /Secure;/);
  assert.match(cookie, /SameSite=Lax;/);
  assert.equal(getVerifiedSession(source("203.0.113.21", "opengeo_verified=" + issued.token), {secret,now:now+12_000}), true);
  assert.equal(validSessionToken(source("203.0.113.22"), issued.token, {secret,now:now+10_000}), false);
  assert.equal(validSessionToken(source(), issued.token, {secret:"9".repeat(64),now}),false);
  assert.equal(validSessionToken(source(), issued.token, {secret,now:now+2*3600_000+1}),false);
  const altered = issued.token.slice(0,-1) + (issued.token.endsWith("x") ? "y" : "x");
  assert.equal(validSessionToken(source(),altered,{secret,now}),false);
});
test("a site with unverified evidence always gets a cautious action/verification path",()=>{
  const guide = actionGuide({rule:"readable-content",url:"https://www.msbproject.my.id/"});
  assert.match(guide.check,/View Source/);
  assert.match(guide.change,/HTML/);
  assert.match(guide.verify,/OpenGEO/);
  assert.match(guide.outcome,/no ranking/);
  assert.equal(capabilityCards().length,4);
  const unknown = actionGuide({rule:"not-in-scanner"});
  assert.match(unknown.verify,/re-run/);
});
