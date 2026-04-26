import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent bundling of packages with native Node.js addons.
  // libsql is lazily required at runtime only for local SQLite dev databases.
  serverExternalPackages: ["libsql", "better-sqlite3"],
};

export default nextConfig;
