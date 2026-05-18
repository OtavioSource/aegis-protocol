/**
 * Validação de variáveis de ambiente via Zod.
 *
 * Carregadas no boot. Falha-rápido: se uma var crítica está ausente/inválida,
 * o processo morre antes de aceitar requests.
 *
 * Convenção: lê `process.env` somente AQUI. Resto do código importa `env`
 * tipado deste módulo.
 */

import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Stellar (necessárias a partir da iteração 5)
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  STELLAR_HORIZON_URL: z.string().url().default('https://horizon-testnet.stellar.org'),
  STELLAR_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  TREASURY_PUBLIC_KEY: z.string().optional(),
  TREASURY_SECRET: z.string().optional(),

  // Anchor SEP-24
  SEP24_ANCHOR_HOME_DOMAIN: z.string().default('testanchor.stellar.org'),
  SEP24_ANCHOR_TOML_URL: z
    .string()
    .url()
    .default('https://testanchor.stellar.org/.well-known/stellar.toml'),

  // Asset operacional
  USDC_ASSET_CODE: z.string().default('USDC'),
  USDC_ASSET_ISSUER: z.string().optional(),

  // Soroban contract
  AUDIT_CONTRACT_ID: z.string().optional(),

  // Auth / Web
  NEXTAUTH_SECRET: z.string().optional(),
  NEXTAUTH_URL: z.string().url().optional(),

  // Tuning
  SEP24_POLLING_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  SEP24_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(82_800),
  RATE_LIMIT_PER_AGENT_RPS: z.coerce.number().int().positive().default(10),
  IDEMPOTENCY_KEY_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:');
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
