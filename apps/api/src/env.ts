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

  // Vendor key encryption (Modo AEGIS — cifra secret keys de vendor antes de persistir)
  // Gerar com: node -e "console.log(crypto.randomBytes(32).toString('hex'))"
  VENDOR_KEY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'VENDOR_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
    .optional(),

  // Etherfuse anchor (LATAM — BRL/MXN via Pix/SPEI)
  // Cadastre na devnet.etherfuse.com → Ramp → API Keys → Create Key
  ETHERFUSE_BASE_URL: z.string().url().default('https://api.sand.etherfuse.com'),
  ETHERFUSE_API_KEY: z.string().optional(), // format: api_sand:... (sandbox) ou api_prod:... (prod)
  /// Etherfuse customerId (1 por usuário; no MVP, 1 fixo para a treasury Aegis)
  ETHERFUSE_CUSTOMER_ID: z.string().optional(),
  /// Etherfuse bankAccountId (gerado via hosted onboarding URL após KYC)
  ETHERFUSE_BANK_ACCOUNT_ID: z.string().optional(),

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
  /**
   * Secret para assinar/verificar o session token do dashboard (humano).
   * Só a API usa (emite no login, valida nas rotas). Sem ele, o login do
   * dashboard falha ao emitir token. Gerar com:
   *   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
   */
  SESSION_JWT_SECRET: z.string().optional(),

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
