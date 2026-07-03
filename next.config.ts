import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Seed advertorials (examples/advertorials/*.json) are read from disk at
  // request time by lib/advertorialStore.ts. Next's output tracing can't see
  // runtime fs reads, so include them explicitly or the serverless bundle
  // ships without them and /p/[slug] 404s on the deployed URL.
  outputFileTracingIncludes: {
    "/p/[slug]": ["./examples/advertorials/**/*"],
  },
};

export default nextConfig;
