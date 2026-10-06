import { ImageResponse } from "next/og";
import { SITE } from "@/config/site";

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "radial-gradient(900px 500px at 15% 0%, rgba(242,85,90,0.22), transparent 60%), #08080a",
          color: "#eeeef1",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(135deg, #ff6b6b, #c62a2a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
            }}
          >
            ▶
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {SITE.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 70,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 940,
            }}
          >
            Turn YouTube into something you can read, search, and talk to.
          </div>
          <div style={{ fontSize: 30, color: "#b6b6c0", maxWidth: 860 }}>
            Read it. Search it. Ask it.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 22, color: "#8b8b98" }}>
          <span>Readable overviews</span>
          <span>·</span>
          <span>Timestamped answers</span>
          <span>·</span>
          <span>Ask the video</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
