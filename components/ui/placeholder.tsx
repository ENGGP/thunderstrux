// A branded stand-in where a society hasn't added an image: night violet with
// one lighter stripe and, when given, an initial in glow. Decorative; the name
// beside it carries the meaning. Size, shape and text size come from className.
export function Placeholder({ initial, className = "" }: { initial?: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-night font-display font-semibold text-glow ${className}`}
    >
      <span className="absolute -inset-x-[10%] bottom-[22%] h-[16%] -rotate-[7deg] bg-night-stripe" />
      {initial ? <span className="relative leading-none">{initial.trim().charAt(0).toUpperCase()}</span> : null}
    </div>
  );
}
