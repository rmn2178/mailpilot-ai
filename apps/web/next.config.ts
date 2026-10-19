import type { NextConfig } from "next";

// Vercel deployment build
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
    "pdf-parse",
    "mammoth",
  ],

  webpack(webpackConfig, { isServer }) {
    if (isServer) {
      // Force webpack to treat these as externals even when encountered inside
      // transpiled workspace packages. Prevents "cannot resolve" errors at
      // build time for packages that are only needed at runtime.
      const existing = webpackConfig.externals ?? [];
      const extra = [
        "bullmq",
        "ioredis",
        "pdf-parse",
        "mammoth",
        "exceljs",
      ];
      webpackConfig.externals = [
        ...(Array.isArray(existing) ? existing : [existing]),
        ({ request }: { request?: string }, callback: (err?: Error | null, result?: string) => void) => {
          if (request && extra.some((pkg) => request === pkg || request.startsWith(pkg + "/"))) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return webpackConfig;
  },

  // Security: never expose server-only env to the browser bundle.
  // Only NEXT_PUBLIC_* vars are inlined automatically.
};

export default config;
