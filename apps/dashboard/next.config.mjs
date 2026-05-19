/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@slickalerts/shared"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.slickdeals.net" },
      { protocol: "https", hostname: "slickdeals.net" },
    ],
  },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
    // Disable typed routes — generates .next/types/routes.d.ts and triggers
    // Next to add a triple-slash reference to next-env.d.ts that breaks clean
    // checkouts where .next/ doesn't exist yet. Re-enable when 15.5+ stable.
    typedRoutes: false,
  },
};

export default nextConfig;
