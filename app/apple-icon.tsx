import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The home-screen icon: the same lettermark as app/icon.svg, drawn from boxes so it needs no font.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#33136c", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 42 }}>
        <div style={{ width: 96, height: 25, background: "#ece4ff" }} />
        <div style={{ width: 28, height: 71, background: "#ece4ff" }} />
      </div>
    ),
    size
  );
}
