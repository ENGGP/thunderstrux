"use client";
import { useEffect, useState } from "react";
type CapturedLink = { path: string; token: string; capturedAt: number };
declare global { interface Window { __thunderstruxAccountLink?: CapturedLink | null } }
// Share one document-memory link across client bundles/router remounts.
// Full reload discards it; nothing enters history state or browser storage.
// `ready` turns true once the link has been read: until then the token is unknown,
// not missing, so a page must not say the link stopped working.
export function useAccountLinkToken(enabled = true) {
  const [token, setTokenState] = useState("");
  const [ready, setReady] = useState(false);
  function setToken(value: string) {
    if (!value) window.__thunderstruxAccountLink = null;
    setTokenState(value);
  }
  useEffect(() => {
    if (!enabled) return;
    function capture(event?: HashChangeEvent) {
      // Repeated setup after history cleanup must retain the captured link.
      // Also handle a new email link opened in an already mounted page.
      const path = window.location.pathname;
      const eventUrl = event ? new URL(event.newURL) : new URL(window.location.href);
      if (eventUrl.pathname !== path) return;
      const capturedLink = window.__thunderstruxAccountLink;
      if (!eventUrl.hash) {
        if (capturedLink?.path === path && Date.now() - capturedLink.capturedAt < 1800000) setTokenState(capturedLink.token);
        setReady(true);
        return;
      }
      const candidate = new URLSearchParams(eventUrl.hash.slice(1)).get("token") ?? "";
      const value = /^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : "";
      window.__thunderstruxAccountLink = value ? { path, token: value, capturedAt: Date.now() } : null;
      setTokenState(value);
      setReady(true);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    capture(); window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, [enabled]);
  return [token, setToken, ready] as const;
}
