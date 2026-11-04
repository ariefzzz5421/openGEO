/**
 * Evidence-based, deterministic playbooks. No claimed changes to the audited
 * site, no fabricated rankings, products, prices, or AI citations.
 */
const GUIDES = {
  "readable-content": {
    check: "Compare View Source (Ctrl+U) with the rendered browser page. Confirm whether important copy is present in HTML or only after JavaScript.",
    change: "Add factual, genuinely helpful copy in initial HTML: who this is for, what is sold/offered, real product categories/specifications, ordering and contact details. Use prerendering/SSR where needed.",
    verify: "Re-fetch HTML without JS and run OpenGEO again. Compare visible HTML text and this exact warning, not just word count.",
    outcome: "Crawlers without JavaScript may understand the offering more clearly; no ranking or AI-recommendation guarantee."
  },
  sitemap: {
    check: "Open /sitemap.xml and confirm HTTP 200, XML instead of HTML, canonical URLs, and Google Search Console's detailed sitemap retrieval status.",
    change: "Correct sitemap generation or deployment routing if a real HTTP/XML failure is verified. Submit the valid sitemap in Search Console only when relevant.",
    verify: "Check response headers, parse the live XML and confirm Google reports a successful sitemap read.",
    outcome: "Better sitemap discovery; this does not automatically index pages."
  },
  canonical: {
    check: "Inspect the HTML canonical, redirect chain, sitemap URL and the preferred domain. Compare the target page content.",
    change: "Align canonical, internal links and sitemap URLs only when the canonical is genuinely inconsistent.",
    verify: "Re-audit the page and inspect Google's selected canonical in Search Console where accessible.",
    outcome: "Clearer canonical preference signals, not guaranteed canonical selection."
  },
  "product-schema": {
    check: "Compare Product JSON-LD to what the product page actually shows: product name, imagery, availability, price and currency.",
    change: "Repair missing properties using current verified catalog facts. Do not invent ratings or offer availability.",
    verify: "Run the Rich Results Test and rescan. Check no critical schema errors remain.",
    outcome: "More accurate product parsing and possible rich-result eligibility, never a guaranteed rich result."
  },
  indexability: {
    check: "Look for noindex in both HTML and X-Robots-Tag. Decide whether this page is intentionally private.",
    change: "Remove unintended noindex only on public pages that are supposed to appear in search.",
    verify: "Re-fetch page headers/HTML and inspect the URL in Search Console.",
    outcome: "May remove a technical indexing blocker; indexing remains Google's decision."
  },
  "http-status": {
    check: "Inspect the returned HTTP status and redirect destination using a browser and curl.",
    change: "Fix broken site routes or replace intentionally moved URLs with relevant redirects.",
    verify: "Request the canonical URL and confirm the intended final HTTP status.",
    outcome: "Users and crawlers can reach the intended resource."
  },
  "fetch-error": {
    check: "Compare audit response with browser/curl; check DNS, TLS, server limits and robots policy.",
    change: "Fix confirmed access or hosting problems, not issues caused only by the scanner's network.",
    verify: "Re-run the same URL and confirm the fetch succeeds.",
    outcome: "The auditor can collect actual page evidence."
  },
  "rendering-compare": {
    check: "Compare source HTML with browser-rendered HTML and isolate content populated by client-side JavaScript.",
    change: "Server-render or prerender core product and informational text; keep database facts consistent.",
    verify: "Compare initial HTML after deploy and repeat the rendering comparison.",
    outcome: "Content becomes accessible to more crawlers with limited JS execution."
  },
  title: {
    check: "Compare title tags across equivalent pages for duplication or vague wording.",
    change: "Write a truthful, unique title reflecting each page's actual topic.",
    verify: "Open page source, check the title and re-run the audit.",
    outcome: "More precise on-page topic signals; search snippets may still differ."
  },
  h1: {
    check: "Check the actual page heading in initial and rendered HTML.",
    change: "Use an accurate primary heading that clearly explains the page.",
    verify: "Check the server response and rescan the same URL.",
    outcome: "Clearer information hierarchy for readers and parsers."
  }
};
const GENERIC = {
  check: "Open the affected page and compare the reported finding to its live HTML and response headers.",
  change: "Apply the smallest factual correction. Review relevant source code and do not publish unverified claims.",
  verify: "Re-deploy through your normal review process and re-run the exact page audit.",
  outcome: "The flagged technical issue may be resolved if the same check passes; rankings and citations are not measured."
};
export function actionGuide(issue) {
  const selected = GUIDES[issue?.rule] || GENERIC;
  return { ...selected, source: issue?.url || "", rule: issue?.rule || "unknown" };
}
export function capabilityCards() {
  return [
    { title: "1 · Discover", description: "Crawl a bounded sample of public pages; read HTML, robots, sitemap and HTTP evidence.", limit: "A small crawl is not a full index or ranking report." },
    { title: "2 · Diagnose", description: "Classify technical checks, prioritise actual warnings, and show the exact affected URLs.", limit: "Some rules are heuristic; validate important findings." },
    { title: "3 · Fix", description: "Generate safe HTML/JSON-LD templates, practical changes and AI explanations of detected evidence.", limit: "OpenGEO never edits or deploys the target website." },
    { title: "4 · Verify", description: "Repeat the same audit and compare issue resolution across reports.", limit: "Google indexing and AI citations require separate external measurements." }
  ];
}
