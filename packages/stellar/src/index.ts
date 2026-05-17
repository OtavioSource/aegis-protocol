/**
 * @aegis/stellar — implementação Stellar do SettlementAdapter + SEP-24 client + sponsoring helpers.
 *
 * Módulos planejados (iterações 5-9 do roadmap):
 * - assets.ts:        mapping asset_code → Asset(code, issuer) por network
 * - treasury.ts:      setup, balance, signing
 * - sponsoring.ts:    CAP-33 (vendor onboarding zero-fricção)
 * - payment.ts:       Payment direto + PathPaymentStrictReceive (multi-asset)
 * - sep10.ts:         autenticação anchor via challenge tx
 * - sep24.ts:         deposit/withdraw interactive flow
 * - soroban.ts:       invoke aegis_audit contract + getEvents
 *
 * Detalhes em docs/04-stellar-asset-design.md, docs/05-zero-friction-onboarding.md,
 * docs/06-fiat-onramp-sep24.md, docs/08-soroban-audit.md.
 */

export const STELLAR_PACKAGE_VERSION = '0.0.1';
