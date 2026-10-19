import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // transpilePackages makes Next compile our workspace packages.
  transpilePackages: ["@mailpilot/shared", "@mailpilot/server-core"],
  // Security: never expose server-only env to the browser bundle.
  // Only NEXT_PUBLIC_* vars are inlined automatically.
};

export default config;
