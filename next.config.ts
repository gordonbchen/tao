import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  agentRules: false,
  devIndicators: false,
};

export default nextConfig;
