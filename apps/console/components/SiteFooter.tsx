/** The repository this console is built from (git remote `origin`). */
const REPO_URL = 'https://github.com/Narayanan-D-05/Bonded';

const DOCS = [
  { path: 'README.md', label: 'README' },
  { path: 'USECASE.md', label: 'Use case' },
  { path: 'docs/THREATMODEL.md', label: 'Threat model' },
  { path: 'sponsers.md', label: 'Sponsor notes' },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-hairline">
      <div className="mx-auto grid max-w-content gap-4 px-4 py-8 text-sm text-fog sm:grid-cols-[1fr_auto] sm:px-6">
        <p className="max-w-2xl leading-relaxed">
          Bonded re-derives the facts a payment relies on, right before money moves. The vendor master is a disclosed, controlled fixture
          standing in for a real issuer or accounting API (or a live Xero org when configured); see the threat model.
        </p>
        <nav aria-label="Repository docs">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {DOCS.map((d) => (
              <li key={d.path}>
                <a
                  href={`${REPO_URL}/blob/main/${d.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:text-manifest hover:underline"
                >
                  {d.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
