import type { NextConfig } from "next";

// Everything runs in the browser (WebGL), so the app ships as a static export
// to `out/`, which Render serves as a static site.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // The dev-only Next badge defaults to bottom-left, on top of the timeline's play button
  devIndicators: { position: "top-left" },
};

export default nextConfig;
