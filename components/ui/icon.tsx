// Outline icons drawn on a 24px grid. Decorative by default: the text beside
// an icon always carries the meaning.
const paths = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5",
  chart: "M4 20V10M10 20V4M16 20v-7M2 20h20",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  profile: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9h5M7 13h10M7 16h6",
  users: "M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.6 5.2",
  card: "M4.5 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2.5 10h19M6.5 15h4",
  mail: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 7l8.5 6 8.5-6",
  ticket: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 7v10",
  user: "M12 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 20c.7-3.6 3.5-5.5 7-5.5s6.3 1.9 7 5.5",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5.5M12 7.5v.3",
  success: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8 12.5l2.8 2.8L16 9.5",
  warning: "M12 4 2.5 20h19zM12 10v4.5M12 17.2v.3",
  error: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9 9l6 6M15 9l-6 6",
  close: "M6 6l12 12M18 6 6 18",
  pin: "M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  search: "M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM16 16l4.5 4.5",
  shield: "M12 3 5 6v6c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6zM9 12l2.2 2.2L15 10.4",
  bag: "M5 8h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8zM9 8V6.5a3 3 0 0 1 6 0V8",
  lock: "M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  badge: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM6 17c.5-1.3 1.6-2 3-2s2.5.7 3 2M14.5 10h3.5M14.5 13.5h3.5"
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 18,
  className = ""
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={paths[name]} />
    </svg>
  );
}
