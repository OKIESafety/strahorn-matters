import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Strahorn Matters",
    short_name: "Matters",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f2",
    theme_color: "#2f5d50",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
