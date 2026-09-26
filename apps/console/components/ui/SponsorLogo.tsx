import Image from 'next/image';
import interceptaLogo from '../../app/sponsor_logos/intercepta.png';
import suiLogo from '../../app/sponsor_logos/sui.png';
import worldLogo from '../../app/sponsor_logos/world.png';

/**
 * Sponsor marks, served through next/image from static imports (bundled docs:
 * 03-api-reference/02-components/image.md, `src` "A static import").
 *
 * The files in app/sponsor_logos/ are square 256px PNGs cropped from the user-supplied originals
 * in /sponsers with sharp (a one-off step; nothing here depends on sharp at runtime):
 *  - sui.png: the blue circle cut out of the 1600x900 canvas, transparent corners;
 *  - world.png: the natural black mark, white background removed (transparent), trimmed;
 *  - intercepta.png: the 12-dot grid on its own dark tile, cropped to a rounded square (white dots
 *    alone would vanish on the white theme).
 *
 * Every placement shows the sponsor's name beside the mark, so `alt` defaults to "" (decorative)
 * and a caller passes real alt text only where the name is not adjacent.
 */
export type Sponsor = 'sui' | 'world' | 'intercepta';

const LOGOS = {
  sui: { src: suiLogo, name: 'Sui' },
  world: { src: worldLogo, name: 'World' },
  intercepta: { src: interceptaLogo, name: 'Intercepta' },
} as const;

export function sponsorName(sponsor: Sponsor): string {
  return LOGOS[sponsor].name;
}

export function SponsorLogo({ sponsor, size = 20, alt = '', className = '' }: { sponsor: Sponsor; size?: number; alt?: string; className?: string }) {
  return (
    <Image
      src={LOGOS[sponsor].src}
      alt={alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A logo with the sponsor's name (or a custom label) next to it. */
export function SponsorTag({ sponsor, size = 16, label, className = '' }: { sponsor: Sponsor; size?: number; label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <SponsorLogo sponsor={sponsor} size={size} />
      <span>{label ?? LOGOS[sponsor].name}</span>
    </span>
  );
}
