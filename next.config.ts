import type { NextConfig } from "next";

// Stripe Checkout is a redirect (not an embedded iframe or script), so the
// policy below doesn't need to allow any Stripe origins.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Standalone output exists for the container image, where it keeps only the
  // server and its traced dependencies. Platforms that build the app
  // themselves supply their own packaging, so it is opt-in via the Dockerfile
  // rather than always on.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
