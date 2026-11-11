import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Docker 이미지(T10-1)는 .next/standalone만 담는다. 개발 서버(next dev)에는 영향이 없다.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
