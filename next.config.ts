import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// OpenNext (Cloudflare) dev integration: lets `next dev` use the Cloudflare
// bindings locally so local behavior matches the deployed Worker.
//
// IMPORTANT: only run this in local development. It pulls in the
// @opennextjs/cloudflare dev tooling, which is irrelevant to a Vercel build and
// can break it. Guarding on NODE_ENV !== "production" keeps Vercel's build
// (and the Cloudflare production build, which sets its own env) clean, while
// still enabling the bindings during `next dev`.
if (process.env.NODE_ENV === "development") {
  void import("@opennextjs/cloudflare")
    .then(({ initOpenNextCloudflareForDev }) => initOpenNextCloudflareForDev())
    .catch(() => {
      // Adapter not available in this context — safe to ignore.
    });
}
