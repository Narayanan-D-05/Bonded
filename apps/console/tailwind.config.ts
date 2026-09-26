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
 * CONSOLE THEME (added alongside, so the deck's classes above keep their exact values): the
 * console pages sit inside `.console` (components/ConsoleFrame.tsx) and use only these tokens.
 * White and blue:
 *  - canvases: `ocean-950` #FFFFFF, `ocean-900` #F4F9FF, `ocean-800` #EAF4FF (alternating bands).
 *  - Sui blue: `sui-brand` #4DA2FF (sampled from the Sui logo) for fills, bars, glows and borders;
 *    `sui` #1A63BF for text, links, key numbers and primary buttons, because #4DA2FF on white is only
 *    ~2.6:1; `sui-deep` #0B4DA2 for hover.
 *  - text: `navy` #0B1B33 headings and primary text, `muted` #475569 secondary text.
 *  - boxes: white `panel`, `rule` #CFE3FB border and dividers, `raised` #F4F9FF inset rows.
 *  - verdicts (status, not theme; always labelled): `cleared` #047857 green, `held` #92400E amber,
 *    `refused` #B91C1C red.
 * Contrast (WCAG 2.x), on white / on #EAF4FF: navy ~17 / ~15:1; muted ~7.6 / ~6.8:1; sui ~5.9 / ~5.3:1;
 * white on sui ~5.9:1; cleared ~5.5 / ~4.9:1; held ~7.1 / ~6.3:1; refused ~6.5 / ~5.8:1.
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
        // Console theme (see above).
        ocean: { 950: '#FFFFFF', 900: '#F4F9FF', 800: '#EAF4FF' },
        sui: { DEFAULT: '#1A63BF', brand: '#4DA2FF', deep: '#0B4DA2' },
        panel: '#FFFFFF',
        raised: '#F4F9FF',
        rule: '#CFE3FB',
        navy: '#0B1B33',
        muted: '#475569',
        cleared: '#047857',
        held: '#92400E',
        refused: '#B91C1C',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        accent: ['var(--font-accent)', 'ui-serif', 'Georgia', 'serif'],
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
