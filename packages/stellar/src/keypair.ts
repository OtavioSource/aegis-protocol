/**
 * Helpers de keypair Stellar — load da treasury + generate utility.
 *
 * Treasury secret SEMPRE vem de env var (nunca persistida em DB).
 * Em MVP testnet: hot wallet em `TREASURY_SECRET`.
 * Em Marco 2+: substituir por KMS signing (sem expor secret).
 */

import { Keypair } from '@stellar/stellar-sdk';

export interface TreasuryKey {
  publicKey: string;
  keypair: Keypair;
}

/**
 * Carrega a keypair da treasury a partir do secret em env var.
 * Se `secret` não estiver configurado ou for placeholder, lança erro
 * descritivo apontando o setup-treasury script.
 */
export function loadTreasuryKey(secret: string | undefined | null): TreasuryKey {
  if (!secret || secret.startsWith('S_REPLACE')) {
    throw new Error(
      'TREASURY_SECRET não configurado. Rode `pnpm --filter @aegis/api setup:treasury` ' +
        'para gerar/fundar uma keypair em testnet e popular o .env.local.',
    );
  }
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch (err) {
    throw new Error(
      `TREASURY_SECRET inválido (formato esperado: "S..." 56 chars). ${(err as Error).message}`,
    );
  }
  return { publicKey: keypair.publicKey(), keypair };
}

/** Gera novo keypair aleatório (uso: setup-treasury, modo AEGIS de vendor). */
export function generateKeypair(): TreasuryKey {
  const keypair = Keypair.random();
  return { publicKey: keypair.publicKey(), keypair };
}

/**
 * Variante "API-friendly" que retorna apenas as strings (sem expor o objeto
 * Keypair do stellar-sdk). Útil para callers que não querem dep direta no SDK.
 */
export function generateKeypairStrings(): { publicKey: string; secret: string } {
  const keypair = Keypair.random();
  return { publicKey: keypair.publicKey(), secret: keypair.secret() };
}
