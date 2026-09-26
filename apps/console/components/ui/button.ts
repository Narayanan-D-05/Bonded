/**
 * Button styles as class strings, so a `<button>`, an `<a>` and a `next/link` share them.
 * `primary` is Sui blue with black text (~7.9:1) and a blue glow: the one strong call to action.
 * `secondary` is black with a light outline, for the alternative action.
 */
export type ButtonTone = 'primary' | 'secondary';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-sui text-white shadow-[0_10px_30px_-12px_rgba(26,99,191,0.7)] hover:bg-sui-deep',
  secondary: 'border border-sui/40 bg-white text-sui hover:border-sui hover:bg-ocean-900',
};

export function buttonClass(tone: ButtonTone = 'primary', extra = ''): string {
  return `${BASE} ${TONES[tone]} ${extra}`;
}
