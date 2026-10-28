import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#2f5d50",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 78,
            height: 102,
            border: "10px solid white",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 12,
            padding: "0 12px",
          }}
        >
          <div style={{ height: 8, background: "white", borderRadius: 4 }} />
          <div style={{ height: 8, background: "white", borderRadius: 4 }} />
          <div style={{ height: 8, width: 28, background: "white", borderRadius: 4 }} />
        </div>
      </div>
    ),
    size
  );
}
