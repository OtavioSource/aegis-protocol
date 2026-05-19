/**
 * SEP-10 client — Stellar Web Authentication.
 *
 * Fluxo:
 *   1. GET <webAuthEndpoint>?account=<treasuryPK>
 *   2. Anchor responde com challenge transaction (XDR) + network_passphrase
 *   3. Cliente valida que challenge é bem-formada e assinada pelo anchor SIGNING_KEY
 *   4. Cliente assina o challenge com a treasury secret
 *   5. POST <webAuthEndpoint> { transaction: signedXDR }
 *   6. Anchor valida + retorna { token: JWT } (válido ~24h)
 *
 * JWT é cached em memória até ~1min antes de expirar (refresh proativo).
 *
 * Spec oficial: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

import {
  type Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';
import { LRUCache } from 'lru-cache';

import type { NetworkConfig } from './network.js';

export interface Sep10Params {
  network: NetworkConfig;
  webAuthEndpoint: string;
  anchorHomeDomain: string;
  /** SIGNING_KEY do anchor (extraído via TOML em anchor-toml.ts). */
  anchorSigningKey: string;
  treasuryKeypair: Keypair;
  /** Optional client domain (multi-tenant SEP-10). Não usado no MVP. */
  clientDomain?: string;
}

export interface Sep10Result {
  token: string;
  expiresAt: number;
}

/**
 * Cache de JWTs por (webAuthEndpoint, treasuryPublicKey).
 * TTL é setado dinamicamente a partir do exp claim do JWT.
 * Limite de tamanho protege contra leak se múltiplos anchors forem usados.
 */
const jwtCache = new LRUCache<string, Sep10Result>({
  max: 50,
  // TTL aplicado por entrada via `ttl` option em set()
});

const REFRESH_BUFFER_MS = 60_000; // refresh 1min antes de expirar

/**
 * Autentica no anchor via SEP-10. Retorna JWT (cached quando possível).
 */
export async function authenticateWithAnchor(params: Sep10Params): Promise<string> {
  const cacheKey = `${params.webAuthEndpoint}::${params.treasuryKeypair.publicKey()}`;
  const cached = jwtCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return cached.token;
  }

  // 1. GET challenge
  const url = new URL(params.webAuthEndpoint);
  url.searchParams.set('account', params.treasuryKeypair.publicKey());
  url.searchParams.set('home_domain', params.anchorHomeDomain);
  if (params.clientDomain) url.searchParams.set('client_domain', params.clientDomain);

  const challengeResp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!challengeResp.ok) {
    throw new Error(
      `SEP-10 challenge failed: HTTP ${challengeResp.status} ${await safeText(challengeResp)}`,
    );
  }
  const challengeBody = (await challengeResp.json()) as {
    transaction?: string;
    network_passphrase?: string;
  };

  if (!challengeBody.transaction) {
    throw new Error('SEP-10 challenge response missing "transaction" field');
  }

  // 2. Validar challenge (assinatura do anchor + estrutura SEP-10)
  // WebAuth.readChallengeTx valida: source = anchor SIGNING_KEY, op manage_data correta, etc.
  const networkPassphrase = challengeBody.network_passphrase ?? params.network.passphrase;
  try {
    WebAuth.readChallengeTx(
      challengeBody.transaction,
      params.anchorSigningKey,
      networkPassphrase,
      params.anchorHomeDomain,
      new URL(params.webAuthEndpoint).hostname,
    );
  } catch (err) {
    throw new Error(`SEP-10 challenge validation failed: ${(err as Error).message}`);
  }

  // 3. Assinar challenge com a treasury keypair
  const tx = TransactionBuilder.fromXDR(challengeBody.transaction, networkPassphrase) as Transaction;
  tx.sign(params.treasuryKeypair);
  const signedXdr = tx.toXDR();

  // 4. POST signed challenge → recebe JWT
  const tokenResp = await fetch(params.webAuthEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ transaction: signedXdr }),
  });
  if (!tokenResp.ok) {
    throw new Error(
      `SEP-10 token exchange failed: HTTP ${tokenResp.status} ${await safeText(tokenResp)}`,
    );
  }
  const tokenBody = (await tokenResp.json()) as { token?: string };
  if (!tokenBody.token) {
    throw new Error('SEP-10 token response missing "token" field');
  }

  // 5. Cachear com TTL derivado do exp claim
  const expiresAt = decodeJwtExpiry(tokenBody.token) ?? Date.now() + 23 * 3_600_000; // default 23h
  jwtCache.set(cacheKey, { token: tokenBody.token, expiresAt }, { ttl: expiresAt - Date.now() });
  return tokenBody.token;
}

/** Decoda o `exp` claim de um JWT (sem validação de assinatura — uso interno). */
function decodeJwtExpiry(jwt: string): number | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payloadB64 = parts[1]!;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1_000 : null;
  } catch {
    return null;
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** Apaga JWT cache (uso em testes ou rotação de chave). */
export function clearSep10Cache(): void {
  jwtCache.clear();
}

// Re-export para conveniência (alguns consumers querem testar a transação isolada)
export { Networks };
