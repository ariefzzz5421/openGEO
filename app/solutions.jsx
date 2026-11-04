"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { remediationPlan } from "../lib/remediation.js";
import { buildAISnapshot } from "../lib/ai-evidence.js";
import { actionGuide, capabilityCards } from "../lib/action-guidance.js";

const priorities = ["all", "critical", "high", "medium", "low"];

function Card({ item, onCopy, copyState }) {
  const guide = actionGuide(item);
  return <article className="fix-card">
    <div className="fix-heading">
      <span className={"fix-priority fix-" + item.priority}>{item.priority} priority</span>
      <span className="fix-category">{item.category}</span>
      <span className="fix-status">{item.status?.toUpperCase()}</span>
    </div>
    <h3>{item.title}</h3>
    <p className="fix-why">{item.why}</p>
    <div className="fix-evidence"><span>DETECTED</span><p>{item.detected}</p><small>{item.url}</small></div>
    <div className="fix-action"><strong>RECOMMENDED ACTION</strong><p>{item.action}</p></div>
    <div className="fix-execution-guide">
      <strong>STEP-BY-STEP REMEDIATION</strong>
      <div className="fix-guide-steps">
        <div><span>01 · Confirm</span><p>{guide.check}</p></div>
        <div><span>02 · Change</span><p>{guide.change}</p></div>
        <div><span>03 · Verify</span><p>{guide.verify}</p></div>
      </div>
      <div className="fix-guide-outcome"><b>Expected technical result:</b> {guide.outcome}</div>
    </div>
    {item.snippet && <div className="fix-snippet"><div className="fix-code-head"><span>STARTER TEMPLATE — REVIEW BEFORE USING</span><button type="button" onClick={() => onCopy(item.key, item.snippet)}>{copyState === item.key ? "✓ Copied" : "Copy code ↗"}</button></div><pre><code>{item.snippet}</code></pre></div>}
    {item.caution && <p className="fix-caution">ⓘ {item.caution}</p>}
  </article>;
}

export default function Solutions({ report, accessKey, publicReceipt = "", savedAIResult = null, onAIResult }) {
  const [filter, setFilter] = useState("all");
  const [copyState, setCopyState] = useState("");
  const [term, setTerm] = useState("");
  const [aiBusy, setAIBusy] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastDurationSeconds, setLastDurationSeconds] = useState(null);
  useEffect(() => {
    if (!aiBusy) return;
    const started = Date.now();
    setElapsedSeconds(0);
    const id = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, [aiBusy]);
  const aiResult = savedAIResult;
  const resultRef = useRef(null);
  useEffect(() => { if (aiResult) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [aiResult]);
  const [aiError, setAIError] = useState("");
  const plan = useMemo(() => remediationPlan(report), [report]);
  const items = useMemo(() => plan.issues.filter((item) =>
    (filter === "all" || item.priority === filter) &&
    (item.title + " " + item.url + " " + item.rule + " " + item.action).toLowerCase().includes(term.toLowerCase())
  ), [plan, filter, term]);

  async function askAI() {
    if (aiBusy) return;
    setAIError("");
    if (!accessKey && !publicReceipt) {
      setAIError("Public AI needs a fresh website scan. Import-only reports still have the offline Fix Advisor.");
      return;
    }
    setAIBusy(true);
    const started = performance.now();
    try {
      const snapshot = buildAISnapshot(report);
      const response = await fetch("/api/ai/analyze", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...(accessKey ? { "x-opengeo-key": accessKey } : {}) },
        body: JSON.stringify({ snapshot, ...(!accessKey ? { receipt: publicReceipt } : {}) })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AI analysis request failed.");
      if (!body.analysis || !body.provider) throw new Error("Provider response is incomplete.");
      setLastDurationSeconds((performance.now() - started) / 1000);
      onAIResult?.(body);
    } catch (error) { setAIError(error.message || "AI inference unavailable."); }
    finally { setAIBusy(false); }
  }
  async function copyCode(key, code) {
    try { await navigator.clipboard.writeText(code); setCopyState(key); }
    catch { setCopyState(""); }
  }
  async function copyAIPlan() {
    if (!aiResult?.analysis) return;
    const lines = [
      "# OpenGEO AI Action Plan",
      "Website: " + report.target,
      "Provider: " + aiResult.provider + " / " + aiResult.model,
      "",
      aiResult.analysis.summary || "",
      "",
      ...(aiResult.analysis.fixes || []).flatMap((fix, i) => [
        String(i + 1) + ". " + fix.rule + " (" + fix.priority + ")",
        "URL: " + fix.url,
        "Reason: " + fix.reason,
        ...fix.steps.map((step) => " - " + step),
        "Verify: " + fix.verify,
        ""
      ]),
      "These recommendations require human review; they do not verify search ranking or AI citations."
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyState("ai-plan");
    } catch { setAIError("Could not copy the AI action plan. Use your browser clipboard permissions."); }
  }

  function exportPlan() {
    const lines = [
      "# OpenGEO — prioritized fix plan", "",
      "Target: " + report.target, "Scanned: " + (report.scannedAt ?? "Unknown"),
      "Audited pages: " + report.pages.length, "Findings: " + plan.issues.length, "",
      "Important: deterministic recommendations; not automatically applied or verified.", ""
    ];
    for (const item of plan.issues) {
      lines.push("## [" + item.priority.toUpperCase() + "] " + item.title, "",
        "Page: " + item.url, "Rule: " + item.rule, "Evidence: " + item.detected, "",
        "Why: " + item.why, "", "Fix: " + item.action, "", "Caution: " + item.caution, "");
      if (item.snippet) lines.push("~~~html", item.snippet, "~~~", "");
    }
    lines.push("## Additional optimization / verification opportunities", "");
    for (const item of plan.opportunities) lines.push("### " + item.title, "", item.action, "");
    const file = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "opengeo-fix-plan.md";
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  }

  return <section className="solution-page">
    <div className="solution-hero">
      <div><div className="overline">ACTIONABLE AUDIT</div><h2>Optimization & Fix Advisor</h2><p>Rule-based fixes derived from actual audit findings. Review every proposed change before editing your codebase.</p></div>
      <button type="button" className="button-outline" onClick={exportPlan}>↓ Export Fix Plan</button>
    </div>
    <section className="ai-advisor-panel">
      <div className="ai-advisor-head">
        <div className="ai-advisor-symbol">✳</div>
        <div className="ai-advisor-intro"><div className="overline">OPTIONAL CLOUD INFERENCE</div><h3>AI-assisted SEO diagnosis</h3><p>GPT-6 Luna primary · Gemini fallback (optional Groq backup). Only bounded audit findings are sent to the provider; no AI calls run automatically.</p></div>
        <button type="button" className="button-primary" disabled={aiBusy || (!accessKey && Boolean(aiResult))} onClick={askAI}>{aiBusy ? "Analyzing…" : aiResult ? "✓ AI analysis ready" : "✦ Analyze with AI"}</button>
      </div>
      {aiBusy && <div className="ai-loading" role="status" aria-live="polite">
        <span className="ai-loading-orbit" aria-hidden="true"/>
        <div className="ai-loading-copy"><strong>Analyzing audit evidence…</strong>
          <p>Running GPT-6 Luna and checking the response; Gemini may be used as fallback.</p>
          <div className="ai-loading-track"><span/></div>
          <small>Elapsed {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")} · Typical estimate 10–45 seconds, not a countdown. {elapsedSeconds >= 45 ? "Taking longer than usual; fallback may be running." : ""}</small>
        </div>
      </div>}
      {!accessKey && !aiResult && <div className="ai-public-info">✓ Browser verification completed during scan. <strong>No second CAPTCHA required.</strong> One public scan permits one AI analysis within 15 minutes. {!publicReceipt && <span>For imported or old reports, run a fresh website scan first.</span>}</div>}
      {aiError && <div className="ai-advisor-error" role="alert">{aiError}<p>Rule-based recommendations below remain available without any AI API.</p></div>}
      {aiResult && <div className="ai-response" ref={resultRef} aria-label="AI analysis results">
        <div className="ai-result-head"><span className="ai-result-success">✓ AI ANALYSIS COMPLETE</span><h3>Here is your SEO/GEO action plan</h3><p>Read the summary, apply the specific changes below, then scan your site again to verify.</p><button type="button" className="ai-copy-plan" onClick={copyAIPlan}>{copyState === "ai-plan" ? "✓ Copied" : "Copy AI Action Plan"}</button></div>
        <div className="ai-response-meta"><span>PROVIDER: {aiResult.provider.toUpperCase()}</span><span>MODEL: {aiResult.model}</span>{aiResult.fallbackUsed && <span>FALLBACK USED</span>}{lastDurationSeconds !== null && <span>COMPLETED IN {lastDurationSeconds.toFixed(1)}s</span>}</div>
        <p className="ai-summary">{aiResult.analysis.summary || "Analysis completed based on the submitted audit evidence."}</p>
        {(aiResult.analysis.fixes || []).map((fix) => <article key={fix.ref} className="ai-fix-card">
          <div className="ai-fix-title"><span className={"fix-priority fix-" + fix.priority}>{fix.priority}</span><strong>{fix.rule.replaceAll("-", " ")}</strong><span className="ai-ref">{fix.ref}</span></div>
          <small className="ai-fix-url">{fix.url}</small>
          <p>{fix.reason}</p>
          {!!fix.steps.length && <ol>{fix.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
          {fix.code && <div className="fix-snippet"><div className="fix-code-head"><span>AI SUGGESTION — REVIEW BEFORE APPLYING</span><button type="button" onClick={() => copyCode("ai-" + fix.ref, fix.code)}>{copyState === "ai-" + fix.ref ? "✓ Copied" : "Copy code ↗"}</button></div><pre><code>{fix.code}</code></pre></div>}
          {fix.verify && <div className="ai-verify"><strong>VERIFY:</strong> {fix.verify}</div>}
        </article>)}
        {(aiResult.analysis.caveats || []).map((notice, i) => <p className="ai-caveat" key={i}>ⓘ {notice}</p>)}
        <p className="ai-disclosure">AI answers may be inaccurate. They are derived from user-supplied audit evidence, not live Google indexing, AI citations, or source-code access. Re-run the deterministic scanner to verify fixes.</p>
      </div>}
    </section>
    <section className="geo-capability-panel">
      <div className="overline">HOW OPENGEO WORKS</div>
      <h3>Discover → Diagnose → Fix → Verify</h3>
      <p>Technical SEO/GEO readiness checks with reproducible evidence. The AI explains what was detected; it does not automatically change your website or measure real search ranking.</p>
      <div className="geo-capability-grid">{capabilityCards().map((card) => <article key={card.title}>
        <strong>{card.title}</strong><p>{card.description}</p><small>{card.limit}</small>
      </article>)}</div>
    </section>
    <div className="solution-metrics">
      {["critical", "high", "medium", "low"].map((priority) => <div className="solution-metric" key={priority}><span className={"fix-priority fix-" + priority}>{priority}</span><strong>{plan.counts[priority]}</strong><small>issue(s)</small></div>)}
    </div>
    <div className="solution-toolbar"><div className="filter-tabs">{priorities.map((priority)=><button key={priority} className={filter===priority?"chosen":""} onClick={()=>setFilter(priority)}>{priority === "all"?"All priorities":priority}</button>)}</div><input className="search-input" aria-label="Search solutions" placeholder="Find a rule or page…" value={term} onChange={(e)=>setTerm(e.target.value)}/></div>
    <div className="solution-count">{items.length} recommended fix(es) · ordered by urgency</div>
    {items.length ? items.map((item)=><Card key={item.key} item={item} onCopy={copyCode} copyState={copyState}/>)
      : <div className="panel fix-empty"><h3>{plan.issues.length ? "No fixes in this filter" : "No failed or warning checks detected"}</h3><p>{plan.issues.length ? "Try another priority or search." : "This means no detected issues within the current scanner rules, not that the site is fully optimized."}</p></div>}
    <div className="opportunity-panel panel">
      <div className="panel-heading"><div><div className="overline">NEXT IMPROVEMENTS</div><h2>Verification & optimization opportunities</h2></div><span className="subtle-badge">{plan.opportunities.length} ideas</span></div>
      <p className="opportunity-intro">These are possible next checks, not confirmed site defects.</p>
      {plan.opportunities.length ? plan.opportunities.map((item)=><div key={item.id} className="opportunity-row"><span className={"fix-priority fix-" + item.priority}>{item.priority}</span><div><strong>{item.title}</strong><p>{item.action}</p></div></div>) : <p className="opportunity-intro">No additional rules triggered for this report.</p>}
    </div>
    <p className="solution-disclaimer">OpenGEO does not modify websites, make Google indexing decisions, or claim verified AI citations. Re-run the audit after applying changes to see whether the original issue disappears.</p>
  </section>;
}
