/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // 빌드 시 타입 에러 무시 (dev 에서는 정상 동작하므로)
    ignoreBuildErrors: true,
  },
  // ★ 핵심: Node.js 네이티브 패키지를 번들에서 제외
  // Next.js 15+에서 프로덕션 빌드 시 이 패키지들이 번들링되면
  // MongoDB 연결/CoolSMS API 호출이 멈추거나 타임아웃 발생
  serverExternalPackages: ['mongoose', 'coolsms-node-sdk'],
};

export default nextConfig;
