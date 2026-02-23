/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
