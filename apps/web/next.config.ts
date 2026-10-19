import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // Compile workspace packages through Next's bundler.
  transpilePackages: ["@mailpilot/shared", "@mailpilot/server-core"],

  // These packages use Node-only APIs and must NOT be bundled by webpack.
  serverExternalPackages: [
    "exceljs",
    "papaparse",
    "@google/generative-ai",
    "pdf-parse",
    "mammoth",
  ],
};

export default config;
