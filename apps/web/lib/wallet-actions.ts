'use server';

/**
 * Server actions do onboarding de carteira não-custodial (ADR 0007).
 *
 * Diferente das actions de <ActionForm>, estas RETORNAM DADOS para o client
 * component orquestrar o fluxo de 3 passos com assinatura no browser:
 *   createWallet → buildWalletSetup → (dono assina) → submitWalletSetup.
 *
 * Falam com a Aegis API via `lib/api` (server-only, session token do humano).
 */

import { revalidatePath } from 'next/cache';

import { api } from '@/lib/api';
import type { Wallet } from '@/lib/types';

export type OwnerKeyMode = 'GENERATED' | 'EXTERNAL';

/**
 * Cria a carteira (PROVISIONING) e atribui os agentes selecionados a ela.
 * Retorna o registro criado (inclui aegisSignerPubKey).
 */
export async function createWallet(input: {
  label: string;
  ownerKeyMode: OwnerKeyMode;
  address: string;
  agentIds: string[];
}): Promise<Wallet> {
  const wallet = await api.post<Wallet>('/v1/wallets', {
    label: input.label,
    ownerKeyMode: input.ownerKeyMode,
    address: input.address,
  });
  // Atribui cada agente selecionado a esta carteira (signer da conta).
  for (const agentId of input.agentIds) {
    await api.patch(`/v1/agents/${agentId}`, { walletId: wallet.id });
  }
  revalidatePath('/wallets');
  revalidatePath('/agents');
  return wallet;
}

/**
 * Monta a tx de setup multisig. Retorna o XDR (sponsor-assinado) para o dono
 * assinar client-side, mais a passphrase da network e flags úteis.
 */
export async function buildWalletSetup(walletId: string): Promise<{
  walletId: string;
  setupXdr: string;
  xlmSponsored: string;
  createOwnerAccount: boolean;
  signers: number;
  networkPassphrase: string;
}> {
  return api.post(`/v1/wallets/${walletId}/setup`, { openUsdcTrustline: true });
}

/** Submete o setupXdr assinado pelo dono → carteira ACTIVE. */
export async function submitWalletSetup(
  walletId: string,
  signedXdr: string,
): Promise<Wallet> {
  const wallet = await api.post<Wallet>(`/v1/wallets/${walletId}/setup/submit`, {
    signedXdr,
  });
  revalidatePath('/wallets');
  return wallet;
}
