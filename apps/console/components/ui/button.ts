/**
 * Button styles as class strings, so a `<button>`, an `<a>` and a `next/link` share them.
 * `primary` is the manifest-paper button: the one strong call to action on a page.
 */
export type ButtonTone = 'primary' | 'secondary';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-manifest text-ink hover:bg-white',
  secondary: 'border border-hairline bg-deepwater text-manifest hover:border-fog',
};

export function buttonClass(tone: ButtonTone = 'primary', extra = ''): string {
  return `${BASE} ${TONES[tone]} ${extra}`;
}
