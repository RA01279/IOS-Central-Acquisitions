import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Nothing uses next/image. Turning the optimizer off removes the
  // /_next/image endpoint and the image-optimizer attack surface with it.
  images: { unoptimized: true },
  // Pin the project root; a stray lockfile higher up the tree otherwise
  // makes Next guess the wrong workspace root for output tracing.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
