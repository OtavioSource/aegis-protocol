/**
 * Derivação da aegis key (co-signer) por company — modelo não-custodial (ADR 0007 §8).
 *
 * Uma chave Ed25519 determinística por company é derivada de uma seed-raiz via
 * HKDF-SHA256. Vantagens: isolamento on-chain por company (pubkeys distintas)
 * sem guardar N secrets — derivamos on-demand no executor e persistimos só a
 * pubkey. Rotação = trocar a raiz (re-deriva todas).
 *
 * Tradeoff conhecido: vazar a raiz = derivar todas. Evoluir para KMS/HSM
 * por-chave quando houver usuários reais (ADR 0007 §8).
 *
 * A raiz NUNCA é commitada; vem de `AEGIS_SIGNER_ROOT_SECRET` (64 hex = 32 bytes).
 */

import { hkdfSync } from 'node:crypto';

import { Keypair } from '@stellar/stellar-sdk';

/** Salt versionado — mudar invalida todas as derivações (rotação total). */
const HKDF_SALT = Buffer.from('aegis-protocol/aegis-signer/v1');

/**
 * Deriva a keypair do co-signer do Aegis para uma company.
 *
 * @param rootSecretHex seed-raiz (64 chars hex = 32 bytes), de `AEGIS_SIGNER_ROOT_SECRET`.
 * @param companyId     UUID da company — entra como `info` do HKDF (domínio de derivação).
 */
export function deriveAegisSigner(rootSecretHex: string, companyId: string): Keypair {
  if (!/^[0-9a-f]{64}$/i.test(rootSecretHex)) {
    throw new Error(
      'AEGIS_SIGNER_ROOT_SECRET inválido: esperado 64 chars hex (32 bytes). ' +
        'Gerar com: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"',
    );
  }
  const ikm = Buffer.from(rootSecretHex, 'hex');
  const info = Buffer.from(`company:${companyId}`);
  // 32 bytes de saída = seed Ed25519 para o keypair Stellar.
  const seed = Buffer.from(hkdfSync('sha256', ikm, HKDF_SALT, info, 32));
  return Keypair.fromRawEd25519Seed(seed);
}
