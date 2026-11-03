// The Thunderstrux mark (app/icon.svg). Decorative: it always sits beside the "Thunderstrux" wordmark.
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} focusable="false" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#f0eafe" height="100" rx="20" width="100" />
      <path d="M44 10L74 10L56 50L26 50Z" fill="#5b2acb" />
      <path d="M50 50L80 50L60 90L30 90Z" fill="#2a1550" />
    </svg>
  );
}
