/**
 * @aegis/stellar — implementação Stellar do SettlementAdapter + helpers.
 *
 * Módulos:
 * - network:      config network/horizon/passphrase
 * - keypair:      load/generate treasury keypair
 * - horizon:      singleton Horizon server
 * - anchor-toml:  SEP-1 TOML resolver (cached)
 * - assets:       resolução de Asset(code, issuer) por network
 * - encryption:   AES-256-GCM para vendor secret keys
 * - friendbot:    funding de contas testnet
 * - sponsoring:   CAP-33 vendor onboarding (vem no M5.3)
 * - payment:      Payment + PathPaymentStrictReceive (vem no M5.3)
 * - adapter:      StellarSettlementAdapter (vem no M5.3)
 */

export * from './network.js';
export * from './keypair.js';
export * from './horizon.js';
export * from './anchor-toml.js';
export * from './assets.js';
export * from './encryption.js';
export * from './friendbot.js';
export * from './trustline.js';
export * from './sep10.js';
export * from './sep24.js';
export * from './etherfuse/index.js';
export * from './sponsoring.js';
export * from './payment.js';
export * from './adapter.js';

export const STELLAR_PACKAGE_VERSION = '0.0.1';
