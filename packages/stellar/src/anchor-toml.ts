/**
 * SEP-1 Stellar TOML resolver — descobre issuers de assets emitidos por
 * anchors (USDC do test-anchor, EURC da Circle, BRL da Anclap, etc.).
 *
 * Resultado é cached em memória — TOMLs raramente mudam, refresh manual
 * via restart do processo é suficiente para MVP.
 */

import { StellarToml } from '@stellar/stellar-sdk';

interface CachedToml {
  fetchedAt: number;
  toml: StellarToml.Api.StellarToml;
}

const cache = new Map<string, CachedToml>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Resolve TOML do domínio do anchor. Resultado é o objeto parseado
 * (campos como `CURRENCIES`, `SIGNING_KEY`, `WEB_AUTH_ENDPOINT`, etc.).
 */
export async function resolveAnchorToml(
  domain: string,
): Promise<StellarToml.Api.StellarToml> {
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.toml;
  }
  const toml = await StellarToml.Resolver.resolve(domain);
  cache.set(domain, { fetchedAt: Date.now(), toml });
  return toml;
}

/**
 * Acha o issuer de um asset emitido por um anchor, dado seu code.
 * Retorna null se não encontrado.
 */
export async function findAnchorAssetIssuer(
  domain: string,
  assetCode: string,
): Promise<string | null> {
  const toml = await resolveAnchorToml(domain);
  const currencies = (toml.CURRENCIES ?? []) as Array<{ code?: string; issuer?: string }>;
  const found = currencies.find((c) => c.code === assetCode);
  return found?.issuer ?? null;
}
