'use client';

import { useState } from 'react';

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
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Proposal: <span className="font-mono text-xs">{proposalHash}</span>
      </p>

      {!authUrl && (
        <button
          onClick={start}
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? 'Starting…' : 'Start World ID step-up'}
        </button>
      )}

      {authUrl && (
        <a
          href={authUrl}
          className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Continue to World sandbox →
        </a>
      )}

      {error && (
        <div className="mt-3 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
          <div>{error}</div>
          {missingEnv && missingEnv.length > 0 && (
            <div className="mt-1">
              Missing env var(s): <span className="font-mono">{missingEnv.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
