// Bake the upstream template's HEAD commit SHA into the build. The update
// banner compares it to upstream's *current* HEAD at runtime — a zero-token,
// zero-setup way to detect updates that works even when the user's repo is
// private (the Deploy-to-Vercel default). Each deploy is (by design) an
// upstream sync, so "upstream moved since this build" ≈ "updates available".
// Best-effort: on any failure the env is simply unset and the runtime check
// falls back to its other strategies.
async function upstreamShaAtBuild() {
  if (!process.env.VERCEL) return undefined; // skip in local dev
  const repo = process.env.UPSTREAM_REPO ?? "Meowssi/slickdeals-alerts";
  const branch = process.env.UPSTREAM_BRANCH ?? "main";
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "slickdeals-alerts-build" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data.sha === "string" ? data.sha : undefined;
  } catch {
    return undefined;
  }
}

const bakedUpstreamSha = await upstreamShaAtBuild();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@slickalerts/shared"],
  env: bakedUpstreamSha ? { UPSTREAM_SHA_AT_BUILD: bakedUpstreamSha } : {},
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
