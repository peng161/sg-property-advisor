import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent bundling of packages that use native Node.js addons or depend on
  // server-only Node.js APIs. Bundling these breaks native binary loading on Vercel.
  serverExternalPackages: ["@libsql/client", "libsql", "better-sqlite3"],
};

export default nextConfig;
