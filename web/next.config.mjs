/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // /conversations is a real page again (the Conversations tab), and Alerts
  // is what folded into it — the reverse of the earlier merge. The redirect
  // lives in app/(app)/notifications/page.tsx rather than here, so leaving a
  // rule for /conversations would make an infinite loop.
};

export default nextConfig;
