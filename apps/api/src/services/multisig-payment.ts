/**
 * Pagamento não-custodial em duas fases (fluxo 5a — ADR 0007 §5/§6).
 *
 *   Fase 1 (prepareSpendRequestEnvelope): após APPROVED, o Aegis resolve a
 *   carteira do agente, constrói o envelope canônico (XDR não-assinado),
 *   persiste-o e transiciona para AWAITING_AGENT_SIGNATURE. O envelope volta
 *   ao agente no response do POST /spend-requests.
 *
 *   Fase 2 (cosignSpendRequest): o agente devolve o envelope assinado no
 *   /cosign. Lock otimista AWAITING_AGENT_SIGNATURE → EXECUTING; o Aegis exige
 *   igualdade ao envelope emitido (hash), verifica a assinatura do agente,
 *   co-assina com a aegis key (derivada da company) e submete. Sucesso →
 *   EXECUTED; falha → EXECUTION_FAILED.
 */

import { createHash } from 'node:crypto';

import {
  EventType,
  type PrismaClient,
  SpendRequestStatus,
  VendorWalletStatus,
  WalletStatus,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { NotFoundError, ValidationError } from '../lib/errors.js';
import { emitSorobanAuditEvent } from './soroban-audit.js';

export type PrepareEnvelopeResult =
  | { status: 'awaiting_signature'; envelopeXdr: string }
  | { status: 'failed'; failureReason: string };

export type CosignResult =
  | { status: 'executed'; txHash: string; ledger: number }
  | { status: 'failed'; failureReason: string }
  | { status: 'noop'; reason: string };

/** sha256(spendRequestId) — memo on-chain (mesma invariante do modelo anterior). */
function memoHashOf(spendRequestId: string): Buffer {
  return createHash('sha256').update(spendRequestId).digest();
}

/**
 * Fase 1 — constrói e persiste o envelope canônico para uma SpendRequest APPROVED.
 * Pré-requisitos: agente com carteira ACTIVE + signerPubKey; vendor com wallet
 * primária ACTIVE/SPONSORED; preferredAsset USDC (path payment é follow-up).
 */
export async function prepareSpendRequestEnvelope(
  app: FastifyInstance,
  spendRequestId: string,
): Promise<PrepareEnvelopeResult> {
  const prisma = app.prisma;
  const sr = await prisma.spendRequest.findUnique({
    where: { id: spendRequestId },
    include: {
      agent: true,
      wallet: true,
      vendor: { include: { wallets: { where: { isPrimary: true } } } },
    },
  });
  if (!sr) throw new NotFoundError(`SpendRequest ${spendRequestId} not found`);

  // Falha cedo, com motivo claro, se a configuração não-custodial estiver incompleta.
  const fail = (reason: string) => markFailedPrepare(prisma, app, sr.id, reason);

  if (!sr.agent.walletId || !sr.wallet) {
    return fail('Agent não tem carteira associada (Agent.walletId). Configure no onboarding.');
  }
  if (sr.wallet.status !== WalletStatus.ACTIVE) {
    return fail(`Carteira ${sr.wallet.id} em status ${sr.wallet.status} (precisa ACTIVE).`);
  }
  if (!sr.agent.signerPubKey) {
    return fail('Agent não tem signerPubKey (chave de assinatura). Configure no onboarding.');
  }
  const vendorWallet = sr.vendor.wallets[0];
  if (!vendorWallet) {
    return fail(`Vendor ${sr.vendor.id} sem wallet primária — cadastre via sponsor.`);
  }
  if (
    vendorWallet.status !== VendorWalletStatus.ACTIVE &&
    vendorWallet.status !== VendorWalletStatus.SPONSORED_BY_AEGIS
  ) {
    return fail(`Vendor wallet em status ${vendorWallet.status} (precisa ACTIVE/SPONSORED).`);
  }
  if (sr.vendor.preferredAsset !== 'USDC') {
    return fail(
      `preferredAsset ${sr.vendor.preferredAsset} ainda não suportado no fluxo não-custodial (path payment é follow-up).`,
    );
  }

  // Um pagamento em voo por carteira. O envelope fixa a sequence da conta no
  // build; pagamentos concorrentes da mesma carteira pegariam a MESMA sequence
  // e só o primeiro /cosign submeteria (os demais → tx_bad_seq). Falhamos rápido
  // com motivo claro em vez de gerar essa colisão (ADR 0007 Q-A). Throughput
  // paralelo real (channel accounts) é follow-up.
  const inflight = await prisma.spendRequest.findFirst({
    where: {
      walletId: sr.walletId,
      id: { not: sr.id },
      status: {
        in: [SpendRequestStatus.AWAITING_AGENT_SIGNATURE, SpendRequestStatus.EXECUTING],
      },
    },
    select: { id: true },
  });
  if (inflight) {
    return fail(
      `Carteira com o pagamento ${inflight.id} pendente de assinatura/execução — conclua-o antes de iniciar outro nesta carteira.`,
    );
  }

  let envelopeXdr: string;
  try {
    envelopeXdr = await app.stellar.buildPaymentEnvelope({
      walletAddress: sr.wallet.address,
      destinationPublicKey: vendorWallet.publicKey,
      amountCents: Number(sr.amountCents),
      assetCode: 'USDC',
      memoHash: memoHashOf(sr.id),
    });
  } catch (err) {
    return fail(`Falha ao construir envelope: ${(err as Error).message}`);
  }

  // Persiste envelope + transiciona APPROVED/APPROVED_BY_HUMAN → AWAITING_AGENT_SIGNATURE.
  const locked = await prisma.spendRequest.updateMany({
    where: {
      id: sr.id,
      status: { in: [SpendRequestStatus.APPROVED, SpendRequestStatus.APPROVED_BY_HUMAN] },
    },
    data: {
      status: SpendRequestStatus.AWAITING_AGENT_SIGNATURE,
      envelopeXdr,
      vendorWalletId: vendorWallet.id,
    },
  });
  if (locked.count === 0) {
    // Outro caller já avançou o estado; devolve o envelope persistido se houver.
    const current = await prisma.spendRequest.findUnique({ where: { id: sr.id } });
    if (current?.envelopeXdr) {
      return { status: 'awaiting_signature', envelopeXdr: current.envelopeXdr };
    }
    return fail('SpendRequest não está em estado aprovável para preparar envelope.');
  }

  return { status: 'awaiting_signature', envelopeXdr };
}

/**
 * Fase 2 — co-assina e submete o envelope assinado pelo agente.
 * Idempotente via lock otimista AWAITING_AGENT_SIGNATURE → EXECUTING.
 */
export async function cosignSpendRequest(
  app: FastifyInstance,
  input: { spendRequestId: string; signedXdr: string },
): Promise<CosignResult> {
  const prisma = app.prisma;
  const { spendRequestId, signedXdr } = input;

  // Lock otimista
  const lock = await prisma.spendRequest.updateMany({
    where: { id: spendRequestId, status: SpendRequestStatus.AWAITING_AGENT_SIGNATURE },
    data: { status: SpendRequestStatus.EXECUTING },
  });
  if (lock.count === 0) {
    return {
      status: 'noop',
      reason: 'SpendRequest não está em AWAITING_AGENT_SIGNATURE — já processada ou em outro estado.',
    };
  }

  const sr = await prisma.spendRequest.findUnique({
    where: { id: spendRequestId },
    include: { agent: true },
  });
  if (!sr) throw new NotFoundError(`SpendRequest ${spendRequestId} not found`);
  if (!sr.envelopeXdr) {
    return markFailedCosign(prisma, app, sr, 'Envelope não encontrado na SpendRequest.');
  }
  if (!sr.agent.signerPubKey) {
    return markFailedCosign(prisma, app, sr, 'Agent sem signerPubKey para validar a assinatura.');
  }

  let result: { txHash: string; ledger: number };
  try {
    result = await app.stellar.cosignSpendRequestEnvelope({
      companyId: sr.companyId,
      expectedEnvelopeXdr: sr.envelopeXdr,
      signedXdr,
      expectedAgentSignerPubKey: sr.agent.signerPubKey,
    });
  } catch (err) {
    return markFailedCosign(prisma, app, sr, (err as Error).message || 'Erro ao co-assinar/submeter');
  }

  const [, executedAuditEvent] = await prisma.$transaction([
    prisma.spendRequest.update({
      where: { id: sr.id },
      data: {
        status: SpendRequestStatus.EXECUTED,
        txHash: result.txHash,
        ledger: result.ledger,
        executedAt: new Date(),
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
          multisig: true,
        } as object,
      },
    }),
  ]);

  emitSorobanAuditEvent({
    prisma,
    log: app.log,
    spendRequestId: sr.id,
    companyId: sr.companyId,
    agentId: sr.agentId,
    vendorId: sr.vendorId,
    amountCents: sr.amountCents,
    asset: sr.asset,
    policyId: sr.policyId,
    policyVersion: (sr.policySnapshot as { version?: number } | null)?.version ?? 1,
    auditEventId: executedAuditEvent.id,
    decision: 'Executed',
    reason: 'payment executed on-chain (multisig 2-of-N)',
    timestampMs: Date.now(),
  });

  app.log.info(
    { spendRequestId: sr.id, txHash: result.txHash, ledger: result.ledger },
    'multisig payment executed on-chain',
  );
  return { status: 'executed', txHash: result.txHash, ledger: result.ledger };
}

/** Marca EXECUTION_FAILED na fase de preparo (não passou pelo lock EXECUTING). */
async function markFailedPrepare(
  prisma: PrismaClient,
  app: FastifyInstance,
  spendRequestId: string,
  reason: string,
): Promise<PrepareEnvelopeResult> {
  const truncated = reason.length > 1_000 ? reason.slice(0, 1_000) + '…' : reason;
  await prisma.spendRequest.update({
    where: { id: spendRequestId },
    data: { status: SpendRequestStatus.EXECUTION_FAILED, failureReason: truncated },
  });
  app.log.warn({ spendRequestId, reason: truncated }, 'multisig envelope prepare failed');
  return { status: 'failed', failureReason: truncated };
}

/** Marca EXECUTION_FAILED na fase de cosign + audit + emit Soroban. */
async function markFailedCosign(
  prisma: PrismaClient,
  app: FastifyInstance,
  sr: {
    id: string;
    companyId: string;
    agentId: string;
    vendorId: string;
    amountCents: bigint;
    asset: string;
    policyId: string;
    policySnapshot: unknown;
  },
  reason: string,
): Promise<CosignResult> {
  const truncated = reason.length > 1_000 ? reason.slice(0, 1_000) + '…' : reason;
  const [, failedAuditEvent] = await prisma.$transaction([
    prisma.spendRequest.update({
      where: { id: sr.id },
      data: { status: SpendRequestStatus.EXECUTION_FAILED, failureReason: truncated },
    }),
    prisma.auditEvent.create({
      data: {
        companyId: sr.companyId,
        spendRequestId: sr.id,
        eventType: EventType.PAYMENT_FAILED,
        actor: 'system',
        payload: { failureReason: truncated, amountCents: Number(sr.amountCents), asset: sr.asset } as object,
      },
    }),
  ]);

  emitSorobanAuditEvent({
    prisma,
    log: app.log,
    spendRequestId: sr.id,
    companyId: sr.companyId,
    agentId: sr.agentId,
    vendorId: sr.vendorId,
    amountCents: sr.amountCents,
    asset: sr.asset,
    policyId: sr.policyId,
    policyVersion: (sr.policySnapshot as { version?: number } | null)?.version ?? 1,
    auditEventId: failedAuditEvent.id,
    decision: 'ExecutionFailed',
    reason: truncated,
    timestampMs: Date.now(),
  });

  app.log.warn({ spendRequestId: sr.id, reason: truncated }, 'multisig cosign failed');
  return { status: 'failed', failureReason: truncated };
}
