/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    // Ensure Turbopack treats the monorepo root as the project root so it can
    // resolve `next` and workspace deps correctly.
    root: path.join(__dirname, "../..")
  }
};

module.exports = nextConfig;
