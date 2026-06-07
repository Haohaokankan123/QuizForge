import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// OpenNext (Cloudflare) dev integration: lets `next dev` use the Cloudflare
// bindings locally so local behavior matches the deployed Worker. No-op in
// production builds. Required by @opennextjs/cloudflare.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
