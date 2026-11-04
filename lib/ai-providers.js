import { makeModelPrompt, parseModelAnswer, validateAISnapshot } from "./ai-evidence.js";

const DEFAULT_OPENAI_MODEL = "gpt-6-luna";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const MAX_PROVIDER_RESPONSE = 60_000;
function validModelId(model) {
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.\/-]{1,90}$/.test(model)) throw new Error("Invalid AI model ID in server configuration.");
  return model;
}
async function requestJSON(fetchImpl, url, opts) {
  let res;
  try {
    res = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(18_000), cache: "no-store" });
  } catch {
    throw new Error("Inference connection failed or timed out.");
  }
  if (!res.ok) throw new Error("Provider returned HTTP " + res.status);
  const raw = await res.text();
  if (raw.length > MAX_PROVIDER_RESPONSE) throw new Error("Provider response exceeds size limit.");
  try { return JSON.parse(raw); }
  catch { throw new Error("Provider returned unreadable response JSON."); }
}

export async function analyzeWithOpenAI(snapshot, { key, model = DEFAULT_OPENAI_MODEL, fetchImpl = fetch } = {}) {
  if (!key) throw new Error("OpenAI API key not configured.");
  validateAISnapshot(snapshot);
  const prompt = makeModelPrompt(snapshot);
  const id = validModelId(model);
  const payload = {
    model: id,
    instructions: prompt.system,
    input: prompt.user,
    reasoning: { effort: "low" },
    text: { format: { type: "json_object" } },
    max_output_tokens: 2400,
    store: false
  };
  const response = await requestJSON(fetchImpl, "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload)
  });
  const output = response.output?.flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("") || response.output_text || "";
  return { provider: "openai", model: id, analysis: parseModelAnswer(output, snapshot) };
}

export async function analyzeWithGemini(snapshot, { key, model = DEFAULT_GEMINI_MODEL, fetchImpl = fetch } = {}) {
  if (!key) throw new Error("Gemini key not configured.");
  validateAISnapshot(snapshot);
  const prompt = makeModelPrompt(snapshot);
  const id = validModelId(model);
  const payload = {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: "user", parts: [{ text: prompt.user }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2400 }
  };
  const response = await requestJSON(fetchImpl,
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(id) + ":generateContent",
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload) });
  const output = response.candidates?.[0]?.content?.parts?.filter((p) => typeof p.text === "string").map((p) => p.text).join("") || "";
  return { provider: "gemini", model: id, analysis: parseModelAnswer(output, snapshot) };
}

export async function analyzeWithGroq(snapshot, { key, model = DEFAULT_GROQ_MODEL, fetchImpl = fetch } = {}) {
  if (!key) throw new Error("Groq key not configured.");
  validateAISnapshot(snapshot);
  const prompt = makeModelPrompt(snapshot);
  const id = validModelId(model);
  const payload = {
    model: id,
    messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    response_format: { type: "json_object" },
    max_completion_tokens: 2400
  };
  const response = await requestJSON(fetchImpl, "https://api.groq.com/openai/v1/chat/completions",
    { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(payload) });
  const output = response.choices?.[0]?.message?.content || "";
  return { provider: "groq", model: id, analysis: parseModelAnswer(output, snapshot) };
}

// Provider fallback is only attempted when the first call fails. The API does
// not silently generate an AI answer from static rules and label it inference.
// Order is server-configured; there is no client-controlled provider selection.
// Fallback only starts after a real API failure or invalid provider response.
export async function runHybridAnalysis(snapshot, {
  openaiKey = "", geminiKey = "", groqKey = "", preferred = "openai",
  openaiModel = DEFAULT_OPENAI_MODEL, geminiModel = DEFAULT_GEMINI_MODEL,
  groqModel = DEFAULT_GROQ_MODEL, fetchImpl = fetch
} = {}) {
  validateAISnapshot(snapshot);
  const handlers = {
    openai: () => analyzeWithOpenAI(snapshot, { key: openaiKey, model: openaiModel, fetchImpl }),
    gemini: () => analyzeWithGemini(snapshot, { key: geminiKey, model: geminiModel, fetchImpl }),
    groq: () => analyzeWithGroq(snapshot, { key: groqKey, model: groqModel, fetchImpl })
  };
  const keys = { openai: Boolean(openaiKey), gemini: Boolean(geminiKey), groq: Boolean(groqKey) };
  if (!keys.openai && !keys.gemini && !keys.groq) {
    throw Object.assign(new Error("No provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY on the server."), { status: 503 });
  }
  const priority = ["openai", "gemini", "groq"];
  const chosen = priority.includes(preferred) ? preferred : "openai";
  const order = [chosen, ...priority.filter((p) => p !== chosen)];
  let fallbackUsed = false;
  for (const name of order) {
    if (!keys[name]) continue;
    try {
      const result = await handlers[name]();
      return { ...result, fallbackUsed, userProvidedEvidence: true };
    } catch {
      // Never log provider keys, raw payloads, or provider error bodies.
      fallbackUsed = true;
    }
  }
  throw Object.assign(new Error("AI providers unavailable or returned invalid JSON. Offline Fix Advisor still works."), { status: 502 });
}
