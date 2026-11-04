import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not let `next dev` write apps/web/AGENTS.md: the repository has one AGENTS.md at the root.
  agentRules: false,
  // The app is opened through Caddy at http://localhost:<port> or http://sN.localhost:<port>.
  // Matching uses the hostname only (no port). Entries are listed explicitly even though the
  // dev server already allows localhost and its subdomains.
  allowedDevOrigins: ["localhost", "*.localhost"],
};

export default nextConfig;
