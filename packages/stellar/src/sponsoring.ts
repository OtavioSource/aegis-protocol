/**
 * CAP-33 Sponsored Reserves — onboarding zero-fricção de vendor.
 *
 * Atomic tx (treasury é source):
 *   1. BeginSponsoringFutureReserves(sponsoredId=vendor)   ← treasury assina
 *   2. CreateAccount(vendor, startingBalance=0)            ← treasury assina
 *   3. ChangeTrust(source=vendor, asset=preferredAsset)    ← VENDOR assina
 *   4. EndSponsoringFutureReserves(source=vendor)          ← VENDOR assina
 *
 * Resultado:
 *   - Vendor account criada com 0 XLM próprio.
 *   - Trustline aberta para preferredAsset (USDC/EURC/BRL/...).
 *   - ~1 XLM (0.5 account + 0.5 trustline) trava em reserves da treasury,
 *     recuperável via RevokeSponsorship quando vendor for removido.
 *
 * Ver `docs/05-zero-friction-onboarding.md` para racional completo.
 */

import {
  type Asset,
  BASE_FEE,
  type Horizon,
  type Keypair,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import type { NetworkConfig } from './network.js';

export interface SponsorVendorParams {
  horizon: Horizon.Server;
  network: NetworkConfig;
  treasuryKeypair: Keypair;
  /** Keypair gerado pela Aegis no Modo AEGIS; ou fornecido pelo vendor no Modo SELF. */
  vendorKeypair: Keypair;
  /** Asset que o vendor prefere receber (USDC default; EURC/BRL/ARS aceitos). */
  preferredAsset: Asset;
}

export interface SponsorVendorResult {
  txHash: string;
  ledger: number;
  /** XLM travado em reserves da treasury (recuperável via RevokeSponsorship). */
  xlmLocked: string;
}

const RESERVES_LOCKED_PER_VENDOR = '1.0000000'; // 0.5 (account) + 0.5 (trustline)

export async function sponsorVendor(
  params: SponsorVendorParams,
): Promise<SponsorVendorResult> {
  const { horizon, network, treasuryKeypair, vendorKeypair, preferredAsset } = params;
  const vendorPublicKey = vendorKeypair.publicKey();

  const treasuryAccount = await horizon.loadAccount(treasuryKeypair.publicKey());

  // Fee: BASE_FEE × 4 operações + buffer de 50% para safety
  const totalFee = Math.ceil(Number(BASE_FEE) * 4 * 1.5).toString();

  const tx = new TransactionBuilder(treasuryAccount, {
    fee: totalFee,
    networkPassphrase: network.passphrase,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({ sponsoredId: vendorPublicKey }),
    )
    .addOperation(
      Operation.createAccount({ destination: vendorPublicKey, startingBalance: '0' }),
    )
    .addOperation(
      Operation.changeTrust({ source: vendorPublicKey, asset: preferredAsset }),
    )
    .addOperation(
      Operation.endSponsoringFutureReserves({ source: vendorPublicKey }),
    )
    .setTimeout(60)
    .build();

  // Ambas as chaves precisam assinar:
  // - treasuryKeypair: ops 1 e 2 (sponsoring + create)
  // - vendorKeypair: ops 3 e 4 (changeTrust + endSponsoring, source=vendor)
  tx.sign(treasuryKeypair);
  tx.sign(vendorKeypair);

  const result = await horizon.submitTransaction(tx);
  return {
    txHash: result.hash,
    ledger: result.ledger,
    xlmLocked: RESERVES_LOCKED_PER_VENDOR,
  };
}
