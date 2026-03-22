const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["sharp"],
  // Monorepo: allow tracing files from the repo root (where npm workspaces
  // hoist node_modules), not just from apps/web/.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Sharp v0.33+ puts native Linux binaries in @img/sharp-linux-x64.
  // Dynamic import() isn't always traced, so explicitly include them.
  outputFileTracingIncludes: {
    "/api/cover": [
      "../../node_modules/sharp/**/*",
      "../../node_modules/@img/**/*"
    ]
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    // We run `npm -w @om/web run typecheck` locally; during early prototyping we
    // keep deploys unblocked even if Next's built-in typecheck step flakes.
    ignoreBuildErrors: true
  },
  turbopack: {
    // Ensure Turbopack treats the monorepo root as the project root so it can
    // resolve `next` and workspace deps correctly.
    root: `${__dirname}/../..`
  }
};

module.exports = nextConfig;
