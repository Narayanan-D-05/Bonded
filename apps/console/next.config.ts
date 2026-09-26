import type { NextConfig } from 'next';

/**
 * Minimal Next.js config — this app has no custom webpack/Turbopack rules, no
 * `transpilePackages` need (every `@bonded/*` workspace package already ships compiled
 * `dist/*.js` + `.d.ts`, consumed like an ordinary npm dependency), and no image/remote
 * pattern requirements. Kept deliberately small per the task brief: "a hackathon demo
 * screen, not a design pass."
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
