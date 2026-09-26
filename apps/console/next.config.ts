import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// One place for keys: the repo-root .env (the same file the package scripts read).
// process.loadEnvFile never overrides a variable that is already set, so values in
// apps/console/.env.local or the shell still win. Values are never printed.
const rootEnv = join(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
