/**
 * @bonded/issuer-oracle — public index.
 *
 * The disclosed, controlled reference oracle for item truth (ticket face
 * value/status/seller-authorization, e-commerce listed price) — see
 * `tickets-fixture.ts` and `ecomm-fixture.ts` for the disclosure this
 * package exists to make honest, and `schemas.ts` for the `resolvePremise`
 * calling convention. Import from '@bonded/issuer-oracle', never from deep
 * paths.
 */
export * from './tickets-fixture.js';
export * from './ecomm-fixture.js';
export * from './schemas.js';
