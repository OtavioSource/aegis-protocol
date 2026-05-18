/**
 * Asset mapping — code → `Asset(code, issuer)` por network.
 *
 * Mainnet: hard-coded com issuers oficiais (USDC=Circle, BRL=Anclap, etc.).
 * Testnet: USDC do test-anchor é descoberto dinamicamente via SEP-1 TOML
 *   (ver `anchor-toml.ts`). Cache evita rede em hot path.
 *
 * Adicionar novo asset = PR + revisão (auditável via git).
 */

import { Asset } from '@stellar/stellar-sdk';

import { findAnchorAssetIssuer } from './anchor-toml.js';
import type { NetworkKind } from './network.js';

export interface AssetDescriptor {
  code: string;
  issuer: string | null; // null = native (XLM); para outros, NUNCA null em runtime resolvido
}

/** Issuers oficiais conhecidos em mainnet (commitar via PR para adicionar). */
const MAINNET_ASSETS: Record<string, string> = {
  USDC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', // Circle
  // EURC, BRL, ARS — adicionar quando integrarmos Marco 3 (Mainnet pilot)
};

/**
 * Resolve `Asset(code, issuer)` para uso em operações Stellar.
 *
 * - `XLM` → asset nativo
 * - testnet + asset emitido por anchor → resolve issuer via TOML cached
 * - mainnet → lookup na tabela hard-coded `MAINNET_ASSETS`
 *
 * Lança se asset não suportado / issuer não encontrado.
 */
export async function resolveAsset(
  code: string,
  network: NetworkKind,
  anchorDomain?: string,
): Promise<Asset> {
  const upper = code.toUpperCase();
  if (upper === 'XLM') return Asset.native();

  if (network === 'mainnet') {
    const issuer = MAINNET_ASSETS[upper];
    if (!issuer) {
      throw new Error(
        `Asset "${upper}" não configurado em mainnet. Atualize MAINNET_ASSETS em packages/stellar/src/assets.ts.`,
      );
    }
    return new Asset(upper, issuer);
  }

  // testnet: descobre via TOML do anchor (default test-anchor)
  const domain = anchorDomain ?? 'testanchor.stellar.org';
  const issuer = await findAnchorAssetIssuer(domain, upper);
  if (!issuer) {
    throw new Error(
      `Asset "${upper}" não encontrado no TOML de ${domain}. ` +
        `Verifique CURRENCIES em https://${domain}/.well-known/stellar.toml.`,
    );
  }
  return new Asset(upper, issuer);
}

/**
 * Converte valor em centavos USD para string decimal com precisão Stellar (7 casas).
 * Stellar usa amounts em string para evitar perda de precisão.
 *
 * Ex: 1234 cents → "12.3400000"
 */
export function centsToAssetString(cents: number | bigint): string {
  const n = typeof cents === 'bigint' ? cents : BigInt(cents);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const dollars = abs / 100n;
  const remainder = abs % 100n;
  const fractional = remainder.toString().padStart(2, '0') + '00000';
  return `${negative ? '-' : ''}${dollars.toString()}.${fractional}`;
}
