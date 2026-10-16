import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run 컨테이너 배포를 위한 standalone 빌드 출력 설정
  output: "standalone",
  serverExternalPackages: ["@google-cloud/firestore", "@google-cloud/storage"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

