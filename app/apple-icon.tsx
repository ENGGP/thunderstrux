import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The home-screen icon: app/icon.svg's bolt on a full-bleed tile, since iOS rounds the corners itself.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#f0eafe", display: "flex" }}>
        <svg height="180" viewBox="0 0 100 100" width="180" xmlns="http://www.w3.org/2000/svg">
          <path d="M44 10L74 10L56 50L26 50Z" fill="#5b2acb" />
          <path d="M50 50L80 50L60 90L30 90Z" fill="#2a1550" />
        </svg>
      </div>
    ),
    size
  );
}
