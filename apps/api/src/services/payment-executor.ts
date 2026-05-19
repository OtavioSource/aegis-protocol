/**
 * Payment Executor — submete Payment USDC on-chain após decisão APPROVED.
 *
 * Idempotente via lock otimista: atomicamente transiciona
 * APPROVED/APPROVED_BY_HUMAN → EXECUTING via `updateMany`. Race conditions
 * (2 callers simultâneos pra mesma SpendRequest) → apenas um pega o lock,
 * outro retorna `noop`.
 *
 * Fluxo:
 *  1. Lock (UPDATE ... WHERE status IN APPROVED, APPROVED_BY_HUMAN)
 *  2. Resolve VendorWallet primária ACTIVE | SPONSORED_BY_AEGIS
 *  3. Submete via app.stellar.executePayment com memo=sha256(spendRequestId)
 *  4a. Sucesso: status=EXECUTED + txHash + ledger + AuditEvent PAYMENT_EXECUTED
 *  4b. Falha:    status=EXECUTION_FAILED + failureReason + AuditEvent PAYMENT_FAILED
 *
 * Vendor sem wallet primária → marca EXECUTION_FAILED com motivo claro.
 */

import { createHash } from 'node:crypto';

import {
  EventType,
  type PrismaClient,
  type SpendRequest,
  SpendRequestStatus,
  VendorWalletStatus,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { NotFoundError } from '../lib/errors.js';

export interface ExecutePaymentInput {
  app: FastifyInstance;
  spendRequestId: string;
}

export type ExecutePaymentOutput =
  | { status: 'executed'; txHash: string; ledger: number }
  | { status: 'failed'; failureReason: string }
  | { status: 'noop'; reason: string };

const DEFAULT_SLIPPAGE = 0.01;

export async function executeSpendRequestPayment(
  prisma: PrismaClient,
  input: ExecutePaymentInput,
): Promise<ExecutePaymentOutput> {
  const { app, spendRequestId } = input;

  // 1. Lock otimista — atomicamente promove APPROVED → EXECUTING
  const lockResult = await prisma.spendRequest.updateMany({
    where: {
      id: spendRequestId,
      status: { in: [SpendRequestStatus.APPROVED, SpendRequestStatus.APPROVED_BY_HUMAN] },
    },
    data: { status: SpendRequestStatus.EXECUTING },
  });

  if (lockResult.count === 0) {
    return {
      status: 'noop',
      reason: 'SpendRequest not in APPROVED/APPROVED_BY_HUMAN — already processed or in another state',
    };
  }

  // 2. Carrega SpendRequest + vendor + wallet primária
  const sr = await prisma.spendRequest.findUnique({
    where: { id: spendRequestId },
    include: {
      vendor: { include: { wallets: { where: { isPrimary: true } } } },
    },
  });
  if (!sr) throw new NotFoundError(`SpendRequest ${spendRequestId} not found`);

  const wallet = sr.vendor.wallets[0];
  const walletOk =
    wallet &&
    (wallet.status === VendorWalletStatus.ACTIVE ||
      wallet.status === VendorWalletStatus.SPONSORED_BY_AEGIS);

  if (!wallet) {
    return await markFailed(
      prisma,
      app,
      sr,
      `Vendor ${sr.vendor.id} has no primary wallet — cadastre via POST /v1/vendors/:id/wallets/sponsor`,
    );
  }
  if (!walletOk) {
    return await markFailed(
      prisma,
      app,
      sr,
      `Vendor wallet in status ${wallet.status} (need ACTIVE or SPONSORED_BY_AEGIS)`,
    );
  }

  // 3. Memo: sha256(spendRequestId) — backup off-chain do recibo
  const memoHash = createHash('sha256').update(spendRequestId).digest();

  // 4. Submeter on-chain
  const slippage =
    (sr.policySnapshot as { pathPaymentSlippage?: number } | null)?.pathPaymentSlippage ??
    DEFAULT_SLIPPAGE;

  try {
    const result = await app.stellar.executePayment({
      destinationPublicKey: wallet.publicKey,
      amountCents: Number(sr.amountCents),
      destAssetCode: sr.vendor.preferredAsset,
      slippageTolerance: slippage,
      memoHash,
    });

    // 4a. Sucesso — UPDATE EXECUTED + AuditEvent atomicamente
    await prisma.$transaction([
      prisma.spendRequest.update({
        where: { id: sr.id },
        data: {
          status: SpendRequestStatus.EXECUTED,
          txHash: result.txHash,
          ledger: result.ledger,
          executedAt: new Date(),
          vendorWalletId: wallet.id,
        },
      }),
      prisma.auditEvent.create({
        data: {
          companyId: sr.companyId,
          spendRequestId: sr.id,
          eventType: EventType.PAYMENT_EXECUTED,
          actor: 'system',
          payload: {
            txHash: result.txHash,
            ledger: result.ledger,
            amountCents: Number(sr.amountCents),
            asset: sr.asset,
            destAssetCode: sr.vendor.preferredAsset,
            destinationPublicKey: wallet.publicKey,
          } as object,
        },
      }),
    ]);

    app.log.info(
      { spendRequestId: sr.id, txHash: result.txHash, ledger: result.ledger },
      'payment executed on-chain',
    );
    return { status: 'executed', txHash: result.txHash, ledger: result.ledger };
  } catch (err) {
    const reason = (err as Error).message || 'Unknown Stellar error';
    return await markFailed(prisma, app, sr, reason);
  }
}

async function markFailed(
  prisma: PrismaClient,
  app: FastifyInstance,
  sr: Pick<SpendRequest, 'id' | 'companyId' | 'amountCents' | 'asset'>,
  reason: string,
): Promise<ExecutePaymentOutput> {
  // Trunca razão (PostgreSQL text é unlimited, mas mantém log limpo)
  const truncated = reason.length > 1_000 ? reason.slice(0, 1_000) + '…' : reason;

  await prisma.$transaction([
    prisma.spendRequest.update({
      where: { id: sr.id },
      data: {
        status: SpendRequestStatus.EXECUTION_FAILED,
        failureReason: truncated,
      },
    }),
    prisma.auditEvent.create({
      data: {
        companyId: sr.companyId,
        spendRequestId: sr.id,
        eventType: EventType.PAYMENT_FAILED,
        actor: 'system',
        payload: {
          failureReason: truncated,
          amountCents: Number(sr.amountCents),
          asset: sr.asset,
        } as object,
      },
    }),
  ]);

  app.log.warn({ spendRequestId: sr.id, reason: truncated }, 'payment execution failed');
  return { status: 'failed', failureReason: truncated };
}
