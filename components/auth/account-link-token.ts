"use client";
import { useEffect, useState } from "react";
type CapturedLink = { path: string; token: string; capturedAt: number };
declare global { interface Window { __thunderstruxAccountLink?: CapturedLink | null } }
// Share one document-memory link across client bundles/router remounts.
// Full reload discards it; nothing enters history state or browser storage.
export function useAccountLinkToken(enabled = true) {
  const [token, setTokenState] = useState("");
  function setToken(value: string) {
    if (!value) window.__thunderstruxAccountLink = null;
    setTokenState(value);
  }
  useEffect(() => {
    if (!enabled) return;
    function capture() {
      // Repeated setup after history cleanup must retain the captured link.
      // Also handle a new email link opened in an already mounted page.
      const path = window.location.pathname;
      const capturedLink = window.__thunderstruxAccountLink;
      if (!window.location.hash) {
        if (capturedLink?.path === path && Date.now() - capturedLink.capturedAt < 1800000) setTokenState(capturedLink.token);
        return;
      }
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      window.__thunderstruxAccountLink = value ? { path, token: value, capturedAt: Date.now() } : null;
      setTokenState(value);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    capture(); window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, [enabled]);
  return [token, setToken] as const;
}
