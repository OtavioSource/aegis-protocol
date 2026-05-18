/**
 * Tipos TypeScript derivados dos Zod schemas (fonte de verdade canônica).
 *
 * Para garantir que types e schemas nunca divirjam, todas as estruturas
 * passíveis de validação na borda são definidas via `z.infer<typeof ...>`.
 *
 * Tipos sem schema correspondente (Decision, AssetCode, etc.) vivem em
 * arquivos próprios.
 */

import type { z } from 'zod';
import type {
  PolicyRulesSchema,
  PolicySchema,
  RuntimeContextSchema,
  SpendRequestInputSchema,
} from './schemas.js';

/** Asset code curto na Stellar: "USDC", "EURC", "BRL", "XLM", etc. */
export type AssetCode = string;

/** Regras declarativas do Policy DSL — derivado de `PolicyRulesSchema`. */
export type PolicyRules = z.infer<typeof PolicyRulesSchema>;

/** Policy completa com metadata — derivado de `PolicySchema`. */
export type Policy = z.infer<typeof PolicySchema>;

/** Payload de spend request validado — derivado de `SpendRequestInputSchema`. */
export type SpendRequestInput = z.infer<typeof SpendRequestInputSchema>;

/** Contexto runtime pré-carregado — derivado de `RuntimeContextSchema`. */
export type RuntimeContext = z.infer<typeof RuntimeContextSchema>;
