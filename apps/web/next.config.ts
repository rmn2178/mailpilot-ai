import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // Compile workspace packages through Next's bundler.
  transpilePackages: ["@mailpilot/shared", "@mailpilot/server-core"],

  // These packages use Node-only APIs (Redis, file I/O, native addons) and
  // must NOT be bundled by webpack — they run in the Node.js serverless
  // runtime as external modules.
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "exceljs",
    "papaparse",
    "@google/generative-ai",
  ],

  // Security: never expose server-only env to the browser bundle.
  // Only NEXT_PUBLIC_* vars are inlined automatically.
};

export default config;
