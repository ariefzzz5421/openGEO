import test from "node:test";
import assert from "node:assert/strict";
import {
  publicModeConfigured, verifyPublicChallenge, consumePublicQuota,
  signScanReceipt, validateScanReceipt, redeemScanReceipt
} from "../lib/public-access.js";

const env = {
  OPEN_GEO_PUBLIC_ENABLED: "true",
  OPEN_GEO_API_KEY: "x".repeat(64),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "sitekey-test",
  TURNSTILE_SECRET_KEY: "test-secret",
  UPSTASH_REDIS_REST_URL: "https://test-org.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-redis"
};
const request = new Request("https://opengeo-studio.vercel.app/api/audit", {
  headers: { "x-vercel-forwarded-for": "203.0.113.10" }
});
test("public mode fails closed unless all security/configuration keys exist", () => {
  assert.equal(publicModeConfigured(env), true);
  assert.equal(publicModeConfigured({...env, OPEN_GEO_API_KEY: ""}), false);
  assert.equal(publicModeConfigured({...env, UPSTASH_REDIS_REST_TOKEN: ""}), false);
  assert.equal(publicModeConfigured({...env, OPEN_GEO_PUBLIC_ENABLED: "false"}), false);
});
test("Turnstile validates hostname and never trusts an unverified/expired token", async () => {
  const ok = async (url, opts) => {
    assert.match(url, /challenges.cloudflare.com/);
    assert.equal(JSON.parse(opts.body).secret, "test-secret");
    return Response.json({success:true,hostname:"opengeo-studio.vercel.app"});
  };
  assert.equal(await verifyPublicChallenge(request,"valid-test-token",{env,fetchImpl:ok}),"203.0.113.10");
  const forged = async () => Response.json({success:true,hostname:"attacker.example"});
  await assert.rejects(verifyPublicChallenge(request,"valid",{env,fetchImpl:forged}), (e)=>e.status===403);
  await assert.rejects(verifyPublicChallenge(request,"",{env,fetchImpl:ok}), (e)=>e.status===403);
});
test("distributed Upstash quota uses IP pseudonym and both per-IP/global counts", async () => {
  const seen = [];
  const fake = async (url, opts) => {
    seen.push({url,opts});
    return Response.json([{result:2},{result:1},{result:5},{result:1}]);
  };
  const result = await consumePublicQuota(request,"scan",{env,fetchImpl:fake});
  assert.equal(result.remaining,1);
  assert.match(seen[0].url,/upstash.io\/pipeline/);
  assert.equal(seen[0].opts.body.includes("203.0.113.10"),false);
  await assert.rejects(consumePublicQuota(request,"ai",{env,fetchImpl:async()=>Response.json([
    {result:3},{result:1},{result:5},{result:1}
  ])}),e=>e.status===429);
  await assert.rejects(consumePublicQuota(request,"scan",{env,fetchImpl:async()=>{throw Error("Redis down")}}),
    e=>e.status===503);
});
test("signed public receipts bind the exact scan evidence and expire after 15m", () => {
  const snapshot = {target:"https://example.com",issues:[{ref:"F1",rule:"title"}]};
  const now = Date.UTC(2026,10,4);
  const receipt = signScanReceipt(snapshot,env.OPEN_GEO_API_KEY,now);
  assert.equal(validateScanReceipt(snapshot,receipt,env.OPEN_GEO_API_KEY,now+1000),true);
  assert.equal(validateScanReceipt({...snapshot,target:"https://evil.example"},receipt,env.OPEN_GEO_API_KEY,now+1000),false);
  assert.equal(validateScanReceipt(snapshot,receipt,"y".repeat(64),now+1000),false);
  assert.equal(validateScanReceipt(snapshot,receipt,env.OPEN_GEO_API_KEY,now+901_000),false);
  assert.equal(validateScanReceipt(snapshot,"not-a-receipt",env.OPEN_GEO_API_KEY,now),false);
});


test("one valid audit receipt can be redeemed for AI once, without a second Turnstile token", async () => {
  const commands = [];
  const fake = async (url, opts) => {
    assert.match(url, /upstash.io\/pipeline/);
    commands.push(JSON.parse(opts.body));
    return Response.json([{result:commands.length === 1 ? "OK" : null}]);
  };
  const validReceipt = signScanReceipt({target:"https://example.com/"}, env.OPEN_GEO_API_KEY);
  assert.equal(await redeemScanReceipt(validReceipt, {env,fetchImpl:fake}),true);
  assert.equal(commands[0][0][0],"SET");
  assert.match(commands[0][0][1],/^opengeo:receipt-used:[0-9a-f]{64}$/);
  assert.equal(commands[0][0][3],"EX");
  assert.equal(commands[0][0][5],"NX");
  await assert.rejects(redeemScanReceipt(validReceipt,{env,fetchImpl:fake}), (e) => e.status === 409);
});
test("public AI receipt redemption fails closed if Redis is unavailable or receipt malformed", async () => {
  await assert.rejects(redeemScanReceipt("not-a-receipt",{env}), e=>e.status === 403);
  const signed = signScanReceipt({target:"https://example.com/"},env.OPEN_GEO_API_KEY);
  await assert.rejects(redeemScanReceipt(signed,{env,fetchImpl:async()=>{throw Error("Redis unavailable")}}),e=>e.status===503);
  await assert.rejects(redeemScanReceipt(signed,{env,fetchImpl:async()=>Response.json([{result:{error:"bad"}}])}),e=>e.status===409);
});
