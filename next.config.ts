import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // small self-contained server for the Docker image
  poweredByHeader: false,
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }, // compressed product photos
  },
};

export default nextConfig;
