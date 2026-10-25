export function safeReturnPath(value: string | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") ||
      value.includes("\\") || /%(?:2f|5c)/i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  try {
    const base = "https://thunderstrux.invalid";
    const parsed = new URL(value, base);
    // Dot segments can turn "/.//host" into "//host", which a browser treats as another site (SEC-012).
    if (parsed.origin !== base || parsed.pathname.startsWith("//")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
