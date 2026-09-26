/**
 * Hashes, digests and addresses: always mono with tabular figures. Truncated in the middle for
 * display, never hidden: the full value is in `title` and in the accessible name, and `full`
 * renders it whole (wrapping, so a 66-character address never widens the page).
 */
export function truncateMiddle(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function Hash({ value, full = false, className = '' }: { value: string; full?: boolean; className?: string }) {
  if (full) return <span className={`break-all font-mono ${className}`}>{value}</span>;
  return (
    <span title={value} className={`whitespace-nowrap font-mono ${className}`}>
      <span aria-hidden="true">{truncateMiddle(value)}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
