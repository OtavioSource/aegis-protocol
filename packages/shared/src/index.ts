/**
 * @aegis/shared — types, enums, Zod schemas e interfaces compartilhadas.
 *
 * Conteúdo organizado em módulos:
 * - `enums`:    enums string-baseados do domínio
 * - `schemas`:  Zod schemas (fonte de verdade canônica do shape dos tipos)
 * - `types`:    tipos TS derivados via `z.infer<typeof ...>`
 * - `decision`: discriminated union da Decision + type guards
 * - `adapters`: interface `SettlementAdapter` (Extension Point chain-agnóstico)
 */

export * from './enums.js';
export * from './schemas.js';
export * from './types.js';
export * from './decision.js';
export * from './adapters.js';

export const SHARED_PACKAGE_VERSION = '0.0.1';
