"use client";
import { useEffect, useState } from "react";
export function useAccountLinkToken(enabled = true) {
  const [token, setToken] = useState("");
  useEffect(() => {
    if (!enabled) return;
    function capture() {
      // Repeated setup after history cleanup must retain the captured link.
      // Also handle a new email link opened in an already mounted page.
      if (!window.location.hash) return;
      setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    capture(); window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, [enabled]);
  return [token, setToken] as const;
}
