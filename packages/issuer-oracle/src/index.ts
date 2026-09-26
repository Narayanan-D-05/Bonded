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
export * from './vendor-fixture.js';
export * from './vendor-master-changes.js';
export * from './schemas.js';
// Live vendor-master source (Xero Accounting API), selected by
// VENDOR_MASTER_SOURCE=xero; the fixture stays the default. See sources/xero.ts.
export * from './sources/xero.js';
export * from './sources/select.js';
export * from './sources/bank-change.js';
