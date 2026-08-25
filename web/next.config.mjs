/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Convos merged into Alerts; keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/conversations", destination: "/notifications", permanent: true },
    ];
  },
};

export default nextConfig;
