/**
 * Helpers para gerenciar trustlines.
 *
 * `ensureTrustline` é idempotente: verifica se a wallet já tem trustline
 * para o asset; se não, cria via operação `ChangeTrust`.
 */

import {
  type Asset,
  BASE_FEE,
  Horizon,
  type Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import type { NetworkConfig } from './network.js';

export interface EnsureTrustlineParams {
  horizon: Horizon.Server;
  network: NetworkConfig;
  keypair: Keypair;
  asset: Asset;
}

export interface EnsureTrustlineResult {
  alreadyExisted: boolean;
  txHash?: string;
}

export async function ensureTrustline({
  horizon,
  network,
  keypair,
  asset,
}: EnsureTrustlineParams): Promise<EnsureTrustlineResult> {
  const account = await horizon.loadAccount(keypair.publicKey());
  const code = asset.getCode();
  const issuer = asset.getIssuer();
  const hasIt = account.balances.some(
    (b) =>
      b.asset_type !== 'native' &&
      'asset_code' in b &&
      'asset_issuer' in b &&
      (b as { asset_code: string }).asset_code === code &&
      (b as { asset_issuer: string }).asset_issuer === issuer,
  );

  if (hasIt) return { alreadyExisted: true };

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: network.passphrase,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);
  return { alreadyExisted: false, txHash: result.hash };
}
