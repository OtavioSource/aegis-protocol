/**
 * Etherfuse Ramp orchestrator — off-ramp asset Stellar → fiat BRL/MXN.
 *
 * Fluxo (espelha o on-ramp, mas a entrega do cripto é nossa):
 *   1. POST /ramp/quote (type=offramp, sourceAsset="USDC:G...", targetAsset="BRL")
 *   2. POST /ramp/order → order minimal; GET /ramp/order/{id} traz `burnTransaction`
 *   3. burnTransaction é uma tx Stellar pré-montada (source = treasury). Assinamos
 *      com a chave da treasury e submetemos ao Horizon.
 *   4. Etherfuse detecta o burn on-chain → paga o fiat na bank account.
 *   5. Sem `fiat_received` no off-ramp: o sandbox completa sozinho após o burn.
 *
 * Statuses: created → funded (burn confirmado) → completed (fiat enviado).
 */

import {
  type EtherfuseClient,
  type EtherfuseOrder,
} from '@aegis/stellar';
import {
  EventType,
  type FiatWithdrawal,
  FiatTransactionStatus,
  type PrismaClient,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { NotFoundError, StellarError } from '../lib/errors.js';
import { isTerminalDbStatus, mapEtherfuseStatusToDb } from './etherfuse-ramp.js';

const STALE_POLL_MS = 30_000;

export interface InitiateEtherfuseWithdrawalInput {
  app: FastifyInstance;
  companyId: string;
  userId: string;
  /** Asset Stellar que sai da treasury (code, ex "USDC"). */
  asset: string;
  /** Identifier completo "CODE:ISSUER" do asset Stellar (sourceAsset da quote). */
  assetIdentifier: string;
  /** Quantia em centavos do asset Stellar a sacar. */
  amountCents: number;
  /** Moeda fiat de destino ("BRL", "MXN"). */
  targetFiat: string;
  /** Public key da treasury (source da burnTransaction). */
  treasuryPublicKey: string;
  /** customerId Etherfuse (orgId). */
  customerId: string;
  /** bankAccountId Etherfuse (recebe o fiat). */
  bankAccountId: string;
  client: EtherfuseClient;
}

export interface InitiateEtherfuseWithdrawalOutput {
  withdrawal: FiatWithdrawal;
  orderId: string;
  /** Hash da burnTransaction submetida on-chain. */
  burnTxHash: string;
  /** Fiat estimado a receber (destinationAmount da quote). */
  estimatedFiat: string | null;
}

export async function initiateEtherfuseWithdrawal(
  prisma: PrismaClient,
  input: InitiateEtherfuseWithdrawalInput,
): Promise<InitiateEtherfuseWithdrawalOutput> {
  const {
    app,
    companyId,
    userId,
    asset,
    assetIdentifier,
    amountCents,
    targetFiat,
    treasuryPublicKey,
    customerId,
    bankAccountId,
    client,
  } = input;

  const sourceAmountString = (amountCents / 100).toFixed(2);
  const quoteId = crypto.randomUUID();

  // 1. Quote off-ramp (sourceAsset = asset Stellar, targetAsset = fiat)
  let quote;
  try {
    quote = await client.createQuote({
      quoteId,
      customerId,
      blockchain: 'stellar',
      quoteAssets: {
        type: 'offramp',
        sourceAsset: assetIdentifier,
        targetAsset: targetFiat,
      },
      sourceAmount: sourceAmountString,
    });
  } catch (err) {
    throw new StellarError(`Etherfuse offramp quote failed: ${(err as Error).message}`);
  }

  // 2. Order — a resposta do POST é minimal; o GET traz a burnTransaction
  let order;
  try {
    order = await client.createOrder({
      quoteId: quote.quoteId,
      publicKey: treasuryPublicKey,
      bankAccountId,
    });
  } catch (err) {
    throw new StellarError(`Etherfuse offramp order failed: ${(err as Error).message}`);
  }

  // A burnTransaction é gerada de forma assíncrona logo após a order —
  // o POST devolve só o orderId. Poll curto até ela aparecer no GET.
  let burnTransaction = order.burnTransaction;
  for (let i = 0; i < 8 && !burnTransaction; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const full = await client.getOrder(order.orderId);
    burnTransaction = full.burnTransaction;
  }
  if (!burnTransaction) {
    throw new StellarError(
      `Etherfuse offramp order ${order.orderId} returned no burnTransaction after polling`,
    );
  }

  // 3. Assina a burnTransaction com a treasury e submete on-chain
  let burnTxHash: string;
  try {
    const submitted = await app.stellar.signAndSubmitXdr(burnTransaction);
    burnTxHash = submitted.txHash;
  } catch (err) {
    throw new StellarError(`Etherfuse offramp burn submit failed: ${(err as Error).message}`);
  }

  app.log.info(
    { orderId: order.orderId, burnTxHash, asset, targetFiat },
    'etherfuse offramp burn submitted',
  );

  // 4. Persiste FiatWithdrawal (burn já on-chain → PROCESSING)
  const anchorId = client.isSandbox ? 'etherfuse-sandbox' : 'etherfuse-prod';
  const withdrawal = await prisma.fiatWithdrawal.create({
    data: {
      companyId,
      userId,
      anchorId,
      anchorTransactionId: order.orderId,
      interactiveUrl: null,
      instructions: {
        targetFiat,
        estimatedFiatAmount: quote.destinationAmount ?? null,
        exchangeRate: quote.exchangeRate ?? null,
      } as object,
      amountCents: BigInt(amountCents),
      asset,
      targetFiat,
      status: FiatTransactionStatus.PROCESSING,
      txHash: burnTxHash,
    },
  });

  return {
    withdrawal,
    orderId: order.orderId,
    burnTxHash,
    estimatedFiat: quote.destinationAmount ?? null,
  };
}

/**
 * Consulta status no Etherfuse e atualiza o FiatWithdrawal.
 * No-op se já terminal OU se último check <30s atrás (a menos que force=true).
 */
export async function pollAndSyncEtherfuseWithdrawal(
  prisma: PrismaClient,
  app: FastifyInstance,
  client: EtherfuseClient,
  withdrawalId: string,
  options: { force?: boolean } = {},
): Promise<FiatWithdrawal> {
  const existing = await prisma.fiatWithdrawal.findUnique({ where: { id: withdrawalId } });
  if (!existing) throw new NotFoundError(`FiatWithdrawal ${withdrawalId} not found`);

  if (isTerminalDbStatus(existing.status)) return existing;

  const fresh = options.force || Date.now() - existing.updatedAt.getTime() > STALE_POLL_MS;
  if (!fresh) return existing;

  let order: EtherfuseOrder;
  try {
    order = await client.getOrder(existing.anchorTransactionId);
  } catch (err) {
    app.log.warn({ withdrawalId, err: (err as Error).message }, 'etherfuse offramp poll failed');
    return existing;
  }

  const newStatus = mapEtherfuseStatusToDb(order.status);
  const actualAmountCents = order.actualAmount
    ? BigInt(Math.round(parseFloat(order.actualAmount) * 100))
    : order.targetAmount
      ? BigInt(Math.round(parseFloat(order.targetAmount) * 100))
      : existing.actualAmountCents;
  const completedAt =
    isTerminalDbStatus(newStatus) && newStatus === FiatTransactionStatus.COMPLETED
      ? (existing.completedAt ?? new Date())
      : existing.completedAt;
  const failureReason = ['failed', 'expired'].includes(order.status)
    ? order.message ?? `etherfuse status=${order.status}`
    : existing.failureReason;

  const updated = await prisma.fiatWithdrawal.update({
    where: { id: withdrawalId },
    data: { status: newStatus, actualAmountCents, completedAt, failureReason },
  });

  // Audit event apenas na transição PARA COMPLETED
  if (
    existing.status !== FiatTransactionStatus.COMPLETED &&
    newStatus === FiatTransactionStatus.COMPLETED
  ) {
    await prisma.auditEvent.create({
      data: {
        companyId: existing.companyId,
        eventType: EventType.FIAT_WITHDRAWN,
        actor: `anchor:${existing.anchorId}`,
        payload: {
          fiatWithdrawalId: existing.id,
          anchorTransactionId: existing.anchorTransactionId,
          asset: existing.asset,
          targetFiat: existing.targetFiat,
          amountCents: actualAmountCents ? Number(actualAmountCents) : null,
          txHash: existing.txHash,
          provider: 'etherfuse',
        } as object,
      },
    });
    app.log.info(
      { withdrawalId, txHash: existing.txHash },
      'etherfuse offramp completed',
    );
  }

  return updated;
}

/**
 * Serializa FiatWithdrawal para response HTTP (BigInt → number, etc.).
 */
export function serializeFiatWithdrawal(w: FiatWithdrawal, options?: { network?: string }) {
  const stellarExpertUrl =
    w.txHash && options?.network
      ? `https://stellar.expert/explorer/${
          options.network === 'mainnet' ? 'public' : 'testnet'
        }/tx/${w.txHash}`
      : null;
  return {
    id: w.id,
    status: w.status,
    asset: w.asset,
    targetFiat: w.targetFiat,
    amountCents: w.amountCents !== null ? Number(w.amountCents) : null,
    actualAmountCents: w.actualAmountCents !== null ? Number(w.actualAmountCents) : null,
    anchorId: w.anchorId,
    anchorTransactionId: w.anchorTransactionId,
    instructions: w.instructions,
    txHash: w.txHash,
    stellarExpertUrl,
    failureReason: w.failureReason,
    createdAt: w.createdAt,
    completedAt: w.completedAt,
    updatedAt: w.updatedAt,
  };
}
