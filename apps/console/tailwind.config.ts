import type { Config } from 'tailwindcss';

/**
 * Tailwind v3. The Bonded "customs and port authority" palette (original design spec, Part F):
 * a dark harbor canvas, deepwater panels, 1px hairline rules, and manifest-paper documents with ink
 * text. seal / stamp / hold are RESERVED for the three verdicts (CLEARED / REFUSED /
 * HELD_FOR_STEPUP) and nothing else.
 *
 * Contrast notes (WCAG 2.x, computed on the hex values):
 *  - `fog` is the secondary-text tone: ~7.0:1 on harbor, ~6.1:1 on deepwater.
 *  - `stamp` (#C2452C) is ~3.5:1 on harbor, so it is used for borders and large stamp text only;
 *    small refusal/error text on the dark canvas uses `stamp-lit` (~5.8:1).
 *  - On manifest paper the verdict hues are too light, so paper surfaces use the `-ink`
 *    variants (each >= 4.5:1 on #ECEEEA).
 *
 * Content globs cover `components/**` so the untouched, gitignored `deck` siblings keep their
 * class names when they exist locally; nothing here imports them.
 */
const config: Config = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        harbor: '#0B1A22',
        deepwater: '#122733',
        hairline: '#1E3A47',
        manifest: '#ECEEEA',
        ink: '#0E1614',
        fog: '#93A7AE',
        seal: { DEFAULT: '#3FA37A', ink: '#1C6E4C' },
        stamp: { DEFAULT: '#C2452C', lit: '#E8735A', ink: '#A3361F' },
        hold: { DEFAULT: '#E0A33C', ink: '#7F540A' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        doc: '3px',
        control: '6px',
      },
      maxWidth: {
        content: '1120px',
      },
    },
  },
  plugins: [],
};

export default config;
