'use client';

import { useState } from 'react';
import { buttonClass } from '../../components/ui/button';
import { Notice } from '../../components/ui/Notice';
import { SponsorLogo } from '../../components/ui/SponsorLogo';

interface StartResponse {
  authUrl: string;
  state: string;
}

interface StartError {
  error: string;
  missingEnv?: string[];
}

/**
 * The one human-facing button this route is allowed to have: the World ID step-up
 * (CLAUDE.md rule 4 — the only two allowed human-approval buttons in this whole codebase are
 * this one and the Recovery Desk, because the sponsor track requires demonstrating exactly
 * this human moment). Nothing here approves a payment on its own; it only starts the World
 * sandbox authorization redirect. If the sandbox is not configured, the missing env vars are
 * named plainly — never a faked approval (CLAUDE.md rule 1).
 */
export function StepUpActions({ proposalHash }: { proposalHash: string }) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingEnv, setMissingEnv] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    setError(null);
    setMissingEnv(null);
    try {
      const res = await fetch('/api/stepup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposalHash }),
      });
      const json = (await res.json()) as StartResponse | StartError;
      if (!res.ok) {
        const err = json as StartError;
        setError(err.error);
        setMissingEnv(err.missingEnv ?? null);
        return;
      }
      setAuthUrl((json as StartResponse).authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="stepup-action" className="box">
      <header className="box-head flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 sm:px-6">
        <h2 id="stepup-action" className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-navy">
          <span className="inline-flex rounded-full bg-white p-1 ring-1 ring-rule">
            <SponsorLogo sponsor="world" size={18} />
          </span>
          Approve with a fresh World ID check
        </h2>
        <span className="rounded-full bg-white px-3 py-0.5 text-xs font-semibold text-held">Held · nothing paid yet</span>
      </header>
      <div className="px-5 py-5 sm:px-6">
        <p className="mb-1 text-sm text-muted">Proposal</p>
        <p className="mb-4 break-all font-mono text-xs text-navy">{proposalHash}</p>
        <p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted">
          This starts the World sandbox authorization for this one proposal. Nothing is approved by this button itself: World verifies the
          person, and the callback re-derives the verdict before anything is paid or changed.
        </p>

        {!authUrl && (
          <button onClick={start} disabled={loading} className={buttonClass('primary')}>
            {loading ? 'Starting…' : 'Start World ID step-up'}
          </button>
        )}

        {authUrl && (
          <a href={authUrl} className={buttonClass('primary')}>
            Continue to World sandbox <span aria-hidden="true">→</span>
          </a>
        )}

        {error && (
          <Notice tone="error" role="alert" title={error} className="mt-4">
            {missingEnv && missingEnv.length > 0 && (
              <>
                Missing env var(s): <span className="font-mono">{missingEnv.join(', ')}</span>
              </>
            )}
          </Notice>
        )}
      </div>
    </section>
  );
}
