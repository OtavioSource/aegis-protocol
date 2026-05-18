/**
 * Vendor sponsoring orchestration — Modo AEGIS.
 *
 * Fluxo:
 * 1. Gera keypair aleatório para o vendor (Aegis custodia).
 * 2. Cifra secret key com VENDOR_KEY_ENCRYPTION_KEY (AES-256-GCM).
 * 3. Invoca StellarSettlementAdapter.sponsorVendor (4-op atomic tx).
 * 4. Persiste VendorWallet com status ACTIVE + secretKeyEncrypted + sponsorshipTxHash.
 *
 * Idempotência: se Vendor já tem wallet primária ACTIVE, retorna sem refazer.
 */

import { encryptSecret, generateKeypairStrings } from '@aegis/stellar';
import {
  ChainType,
  type PrismaClient,
  type Vendor,
  type VendorWallet,
  VendorSignMode,
  VendorWalletStatus,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { ConflictError } from '../lib/errors.js';

export interface SponsorVendorWalletInput {
  app: FastifyInstance;
  vendor: Vendor;
  encryptionKey: string;
  network: 'testnet' | 'mainnet';
  /** Asset issuer USDC (para popular trustlines jsonb). Opcional — engine resolve via TOML. */
  usdcIssuer?: string;
}

export interface SponsorVendorWalletResult {
  vendorWallet: VendorWallet;
  txHash: string;
  xlmLocked: string;
  /** true se já existia (idempotência). */
  alreadyExisted: boolean;
}

export async function sponsorVendorWallet(
  prisma: PrismaClient,
  input: SponsorVendorWalletInput,
): Promise<SponsorVendorWalletResult> {
  const { app, vendor, encryptionKey } = input;

  // 1. Idempotência: vendor já tem wallet primária ACTIVE?
  const existing = await prisma.vendorWallet.findFirst({
    where: { vendorId: vendor.id, isPrimary: true, status: VendorWalletStatus.ACTIVE },
  });
  if (existing) {
    return {
      vendorWallet: existing,
      txHash: existing.sponsorshipTxHash ?? '',
      xlmLocked: '1.0000000',
      alreadyExisted: true,
    };
  }

  // 2. Gera keypair Stellar (via @aegis/stellar — sem dep direta no stellar-sdk)
  const { publicKey: vendorPublicKey, secret: vendorSecret } = generateKeypairStrings();
  const secretEncrypted = encryptSecret(vendorSecret, encryptionKey);

  // 3. Cria VendorWallet em PROVISIONING + dispara sponsoring on-chain
  const wallet = await prisma.vendorWallet.create({
    data: {
      vendorId: vendor.id,
      chain: ChainType.STELLAR,
      publicKey: vendorPublicKey,
      secretKeyEncrypted: secretEncrypted,
      signMode: VendorSignMode.AEGIS,
      status: VendorWalletStatus.PROVISIONING,
      trustlines: [],
      isPrimary: true,
    },
  });

  try {
    const result = await app.stellar.sponsorVendor({
      vendorPublicKey,
      vendorSecretKey: vendorSecret,
      preferredAssetCode: vendor.preferredAsset,
    });

    // 4. Promove wallet para ACTIVE + persiste txHash + trustlines
    const updated = await prisma.vendorWallet.update({
      where: { id: wallet.id },
      data: {
        status: VendorWalletStatus.SPONSORED_BY_AEGIS,
        sponsorshipTxHash: result.txHash,
        trustlines: [
          {
            asset: vendor.preferredAsset,
            issuer: input.usdcIssuer ?? null,
            sponsored: true,
          },
        ],
      },
    });

    return {
      vendorWallet: updated,
      txHash: result.txHash,
      xlmLocked: result.xlmLocked,
      alreadyExisted: false,
    };
  } catch (err) {
    // Sponsoring on-chain falhou — marca wallet como INACTIVE e propaga
    await prisma.vendorWallet.update({
      where: { id: wallet.id },
      data: { status: VendorWalletStatus.INACTIVE },
    });
    throw new ConflictError(
      `On-chain sponsoring failed for vendor ${vendor.id}: ${(err as Error).message}`,
    );
  }
}
