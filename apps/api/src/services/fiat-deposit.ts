/**
 * Fiat Deposit Service — orchestrator de SEP-10 + SEP-24 deposit.
 *
 * - `initiateDeposit`: cria FiatDeposit no DB (status INITIATED) + chama anchor
 *   pra obter interactive URL. Caller (admin via dashboard) abre essa URL no
 *   browser pra completar KYC e dados bancários.
 *
 * - `pollAndSync`: consulta status atual no anchor + atualiza FiatDeposit no DB.
 *   Quando anchor reporta `completed`, emite AuditEvent FIAT_DEPOSITED.
 *
 * Stale-poll heurística: se status non-terminal e último check >30s atrás,
 * pollar de novo. GET /v1/fiat/deposits/:id usa isso pra dashboard near-real-time
 * sem worker dedicado (worker contínuo entra no Marco 2 — observability).
 */

import { isTerminalSep24Status, type Sep24Transaction } from '@aegis/stellar';
import {
  EventType,
  FiatTransactionStatus,
  type FiatDeposit,
  type PrismaClient,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { NotFoundError, StellarError } from '../lib/errors.js';

const STALE_POLL_MS = 30_000;
const ANCHOR_ID = 'stellar-test-anchor'; // único anchor no MVP

export interface InitiateDepositInput {
  app: FastifyInstance;
  companyId: string;
  userId: string;
  amountCents: number;
  asset: string;
}

export interface InitiateDepositOutput {
  deposit: FiatDeposit;
  interactiveUrl: string;
  expiresAt: Date;
}

export async function initiateFiatDeposit(
  prisma: PrismaClient,
  input: InitiateDepositInput,
): Promise<InitiateDepositOutput> {
  const { app, companyId, userId, amountCents, asset } = input;

  // Valor sugerido em string decimal (anchor pode ajustar). centsToString simples:
  const amountString = (amountCents / 100).toFixed(2);

  let anchorResp;
  try {
    anchorResp = await app.stellar.initiateDeposit({
      assetCode: asset,
      amount: amountString,
    });
  } catch (err) {
    throw new StellarError(`Anchor initiateDeposit failed: ${(err as Error).message}`);
  }

  const deposit = await prisma.fiatDeposit.create({
    data: {
      companyId,
      userId,
      anchorId: ANCHOR_ID,
      anchorTransactionId: anchorResp.id,
      interactiveUrl: anchorResp.url,
      amountCents: BigInt(amountCents),
      asset,
      status: FiatTransactionStatus.INITIATED,
    },
  });

  // Expira em 24h por padrão (anchor pode definir; sem info no body inicial)
  const expiresAt = new Date(Date.now() + 24 * 3_600_000);
  return { deposit, interactiveUrl: anchorResp.url, expiresAt };
}

/**
 * Atualiza FiatDeposit consultando anchor. Retorna deposit atualizado.
 * No-op se já em estado terminal OR se último check <30s atrás (a menos
 * que `force=true`).
 */
export async function pollAndSyncDeposit(
  prisma: PrismaClient,
  app: FastifyInstance,
  depositId: string,
  options: { force?: boolean } = {},
): Promise<FiatDeposit> {
  const existing = await prisma.fiatDeposit.findUnique({ where: { id: depositId } });
  if (!existing) throw new NotFoundError(`FiatDeposit ${depositId} not found`);

  if (isTerminalApiStatus(existing.status)) {
    return existing; // já chegou em estado final, não pollar de novo
  }

  const fresh =
    options.force ||
    Date.now() - existing.updatedAt.getTime() > STALE_POLL_MS;
  if (!fresh) {
    return existing; // recém-conferido, evita rate limit
  }

  let anchorTx: Sep24Transaction;
  try {
    anchorTx = await app.stellar.pollDepositStatus(existing.anchorTransactionId);
  } catch (err) {
    app.log.warn(
      { depositId, err: (err as Error).message },
      'fiat deposit poll failed',
    );
    return existing; // não destrói estado em falha transiente
  }

  const newStatus = mapAnchorStatusToDb(anchorTx.status);
  const txHash = anchorTx.stellar_transaction_id ?? null;
  const actualAmountCents = anchorTx.amount_out
    ? BigInt(Math.round(parseFloat(anchorTx.amount_out) * 100))
    : null;
  const completedAt =
    anchorTx.status === 'completed' && anchorTx.completed_at
      ? new Date(anchorTx.completed_at)
      : existing.completedAt;
  const failureReason = ['error', 'no_market', 'too_small', 'too_large'].includes(anchorTx.status)
    ? anchorTx.message ?? `anchor status=${anchorTx.status}`
    : existing.failureReason;

  const updated = await prisma.fiatDeposit.update({
    where: { id: depositId },
    data: {
      status: newStatus,
      txHash: txHash ?? existing.txHash,
      actualAmountCents: actualAmountCents ?? existing.actualAmountCents,
      completedAt,
      failureReason,
    },
  });

  // Audit event apenas no momento da transição para COMPLETED
  if (existing.status !== FiatTransactionStatus.COMPLETED && newStatus === FiatTransactionStatus.COMPLETED) {
    await prisma.auditEvent.create({
      data: {
        companyId: existing.companyId,
        eventType: EventType.FIAT_DEPOSITED,
        actor: `anchor:${ANCHOR_ID}`,
        payload: {
          fiatDepositId: existing.id,
          anchorTransactionId: existing.anchorTransactionId,
          asset: existing.asset,
          amountCents: actualAmountCents ? Number(actualAmountCents) : Number(existing.amountCents),
          txHash,
        } as object,
      },
    });
    app.log.info(
      { depositId, txHash, amountCents: actualAmountCents?.toString() },
      'fiat deposit completed',
    );
  }

  return updated;
}

/**
 * Serializa FiatDeposit para response HTTP (BigInt → number, etc.).
 */
export function serializeFiatDeposit(d: FiatDeposit, options?: { network?: string }) {
  const stellarExpertUrl =
    d.txHash && options?.network
      ? `https://stellar.expert/explorer/${options.network === 'mainnet' ? 'public' : 'testnet'}/tx/${d.txHash}`
      : null;
  return {
    id: d.id,
    status: d.status,
    walletId: d.walletId,
    asset: d.asset,
    amountCents: d.amountCents !== null ? Number(d.amountCents) : null,
    actualAmountCents: d.actualAmountCents !== null ? Number(d.actualAmountCents) : null,
    anchorId: d.anchorId,
    anchorTransactionId: d.anchorTransactionId,
    interactiveUrl: d.interactiveUrl,
    txHash: d.txHash,
    stellarExpertUrl,
    failureReason: d.failureReason,
    createdAt: d.createdAt,
    completedAt: d.completedAt,
    updatedAt: d.updatedAt,
  };
}

// ============================================================================
// Helpers de mapping
// ============================================================================

const ANCHOR_TO_DB_STATUS: Record<string, FiatTransactionStatus> = {
  incomplete: FiatTransactionStatus.PENDING_USER_INFO,
  pending_user_transfer_start: FiatTransactionStatus.PENDING_USER_TRANSFER,
  pending_user_transfer_complete: FiatTransactionStatus.PROCESSING,
  pending_external: FiatTransactionStatus.PROCESSING,
  pending_anchor: FiatTransactionStatus.PROCESSING,
  pending_stellar: FiatTransactionStatus.PROCESSING,
  pending_trust: FiatTransactionStatus.PROCESSING,
  pending_user: FiatTransactionStatus.PENDING_USER_INFO,
  pending_customer_info_update: FiatTransactionStatus.PENDING_USER_INFO,
  pending_transaction_info_update: FiatTransactionStatus.PENDING_USER_INFO,
  completed: FiatTransactionStatus.COMPLETED,
  refunded: FiatTransactionStatus.REFUNDED,
  expired: FiatTransactionStatus.FAILED,
  no_market: FiatTransactionStatus.FAILED,
  too_small: FiatTransactionStatus.FAILED,
  too_large: FiatTransactionStatus.FAILED,
  error: FiatTransactionStatus.FAILED,
};

function mapAnchorStatusToDb(s: string): FiatTransactionStatus {
  return ANCHOR_TO_DB_STATUS[s] ?? FiatTransactionStatus.PROCESSING;
}

function isTerminalApiStatus(s: FiatTransactionStatus): boolean {
  return (
    s === FiatTransactionStatus.COMPLETED ||
    s === FiatTransactionStatus.FAILED ||
    s === FiatTransactionStatus.REFUNDED
  );
}

/** Exposto para `routes/fiat.ts` reusar a checagem terminal. */
export const TERMINAL_DB_STATUSES = [
  FiatTransactionStatus.COMPLETED,
  FiatTransactionStatus.FAILED,
  FiatTransactionStatus.REFUNDED,
] as const;

/** Exporta isTerminal via referência ao tipo (re-export do helper do package). */
export { isTerminalSep24Status as isTerminalAnchorStatus };
