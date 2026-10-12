import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits on the phone menu and would show in demo recordings.
  devIndicators: false,
};

export default nextConfig;
