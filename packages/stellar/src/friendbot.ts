/**
 * Friendbot helper — funda contas testnet com ~10.000 XLM.
 *
 * Idempotência: Friendbot retorna 400 se a conta já existe (não desperdiça
 * fundos). Tratamos como sucesso silencioso.
 */

import type { NetworkConfig } from './network.js';

export interface FundResult {
  funded: boolean;
  reason: 'created' | 'already-funded' | 'error';
  message?: string;
}

export async function fundAccountTestnet(
  network: NetworkConfig,
  publicKey: string,
): Promise<FundResult> {
  if (!network.friendbotUrl) {
    return { funded: false, reason: 'error', message: 'Friendbot only available on testnet' };
  }

  const url = `${network.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url);

  if (res.ok) {
    return { funded: true, reason: 'created' };
  }

  const body = await res.text().catch(() => '');
  if (body.includes('createAccountAlreadyExist') || res.status === 400) {
    return { funded: false, reason: 'already-funded', message: 'Account already exists on testnet' };
  }

  return {
    funded: false,
    reason: 'error',
    message: `Friendbot returned ${res.status}: ${body.slice(0, 200)}`,
  };
}
