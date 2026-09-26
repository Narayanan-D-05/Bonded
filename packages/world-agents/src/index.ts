/**
 * @bonded/world-agents — public index.
 *
 * The World ID for Agents sandbox OIDC step-up flow (`flow.ts`) and the fresh-enough/
 * matching-enough decision built on top of it (`stepup-gate.ts`), plus the proposal-keyed
 * store both depend on (`store.ts`). Import from '@bonded/world-agents', never from deep
 * paths — same convention as `@bonded/seam`.
 *
 * `flow.ts`'s `initiateStepUp`/`handleCallback` are server-side only (PRD H.2); nothing
 * exported here may be imported into browser code.
 */
export * from './flow.js';
export * from './stepup-gate.js';
export * from './store.js';
