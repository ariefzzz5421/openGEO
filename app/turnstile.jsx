"use client";
import { useEffect, useRef } from "react";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

// Cloudflare's widget is a public anti-bot challenge; secrets and verification
// live ONLY in the API routes. A new token is required for each API action.
export default function TurnstileChallenge({ onToken, resetSignal = 0, label = "Verification" }) {
  const host = useRef(null);
  const widgetId = useRef(null);
  const callbackRef = useRef(onToken);
  callbackRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !host.current) return;
    let disposed = false;
    const render = () => {
      if (disposed || !host.current || widgetId.current !== null || !window.turnstile?.render) return;
      try {
        widgetId.current = window.turnstile.render(host.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          callback: (token) => callbackRef.current(token),
          "expired-callback": () => callbackRef.current(""),
          "error-callback": () => callbackRef.current("")
        });
      } catch { callbackRef.current(""); }
    };
    if (window.turnstile?.render) render();
    let script = document.querySelector('script[data-opengeo-turnstile]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.opengeoTurnstile = "1";
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => {
      disposed = true;
      script.removeEventListener("load", render);
      if (widgetId.current !== null && window.turnstile?.remove) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already removed */ }
      }
      widgetId.current = null;
    };
  }, []);
  useEffect(() => {
    if (resetSignal <= 0 || widgetId.current === null || !window.turnstile?.reset) return;
    window.turnstile.reset(widgetId.current);
    callbackRef.current("");
  }, [resetSignal]);

  if (!TURNSTILE_SITE_KEY) return <p className="challenge-note">Public access is not configured yet. Use the owner key or import a JSON report.</p>;
  return <div className="challenge-wrap"><span className="challenge-label">{label}</span><div ref={host} aria-label="Cloudflare Turnstile anti-bot verification"/></div>;
}
