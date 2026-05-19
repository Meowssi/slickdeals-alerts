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
  },
};

export default nextConfig;
