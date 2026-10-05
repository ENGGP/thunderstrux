// Parser-executed before React/router hydration. Static code only: no user data
// is interpolated into HTML, and tokens remain solely in document memory.
export const accountLinkCaptureScript = `(() => {
  function capture(event) {
    const url = new URL(event ? event.newURL : window.location.href);
    if (url.pathname !== window.location.pathname || !["/verify-email", "/reset-password", "/change-email"].includes(url.pathname)) return;
    if (!url.hash) return;
    const token = new URLSearchParams(url.hash.slice(1)).get("token") || "";
    window.__thunderstruxAccountLink = /^[A-Za-z0-9_-]{43}$/.test(token) ? { path: url.pathname, token, capturedAt: Date.now() } : null;
  }
  capture();
  window.addEventListener("hashchange", capture);
})();`;
