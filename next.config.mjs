/** @type {import('next').NextConfig} */
const nextConfig = {
  // Nothing uses next/image. Turning the optimizer off removes the
  // /_next/image endpoint, which Next 14 can't be patched against (the
  // AVIF RCE and image DoS advisories are only fixed in 15.5).
  images: { unoptimized: true },
};

export default nextConfig;
