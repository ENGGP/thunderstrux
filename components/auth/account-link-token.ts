"use client";
import { useEffect, useState } from "react";
// One bounded, document-memory link survives a router remount after URL cleanup.
// Full reload discards it; nothing enters history state or browser storage.
let capturedLink: { path: string; token: string; capturedAt: number } | null = null;
export function useAccountLinkToken(enabled = true) {
  const [token, setTokenState] = useState("");
  function setToken(value: string) {
    if (!value) capturedLink = null;
    setTokenState(value);
  }
  useEffect(() => {
    if (!enabled) return;
    function capture() {
      // Repeated setup after history cleanup must retain the captured link.
      // Also handle a new email link opened in an already mounted page.
      const path = window.location.pathname;
      if (!window.location.hash) {
        if (capturedLink?.path === path && Date.now() - capturedLink.capturedAt < 1800000) setTokenState(capturedLink.token);
        return;
      }
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      capturedLink = value ? { path, token: value, capturedAt: Date.now() } : null;
      setTokenState(value);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    capture(); window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, [enabled]);
  return [token, setToken] as const;
}
