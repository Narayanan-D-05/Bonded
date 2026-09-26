import type { Config } from 'tailwindcss';

/**
 * Tailwind v3, matching the shape `components.json` (already present in this directory)
 * expects: a `tailwind.config.ts` path, `cssVariables: false`, `baseColor: "slate"`. Content
 * globs include `components/**` (the existing, untouched `GradientWaves`/`Grainient`/`deck`
 * siblings) so their class names are never purged, even though this pass's own pages live
 * only under `app/` and `lib/`.
 */
const config: Config = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
