/**
 * Etherfuse Ramp orchestrator — on-ramp BRL/MXN → asset Stellar via Pix/SPEI.
 *
 * Fluxo (slide 21 do masterclass Stellar 37):
 *   1. POST /ramp/quote (sourceAsset=BRL, targetAsset=USDC:G..., walletAddress=treasury)
 *   2. POST /ramp/order com quoteId
 *   3. Response: { orderId, paymentInstructions: { pixKey, value, expiresAt } }
 *   4. Admin paga via app bancário (sandbox: simulamos via POST /ramp/order/:id/fiat_received)
 *   5. Etherfuse detecta → emite asset pra treasury → webhook (opcional) ou polling
 *
 * No MVP, sem webhook — usamos polling on-demand via GET /v1/fiat/deposits/:id/refresh.
 *
 * Anchor ID no DB: "etherfuse-sandbox" ou "etherfuse-prod" (derivado da API key).
 */

import {
  EtherfuseClient,
  type EtherfuseOrder,
  isTerminalEtherfuseStatus,
  type EtherfuseOrderStatus,
} from '@aegis/stellar';
import {
  EventType,
  type FiatDeposit,
  FiatTransactionStatus,
  type PrismaClient,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { NotFoundError, StellarError } from '../lib/errors.js';

const STALE_POLL_MS = 30_000;

export interface InitiateEtherfuseDepositInput {
  app: FastifyInstance;
  companyId: string;
  userId: string;
  /** Asset Stellar destino (USDC, EURC, TESOURO). */
  targetAsset: string;
  /** Asset Stellar identifier completo "CODE:ISSUER" (descoberto via /ramp/assets). */
  targetAssetIdentifier: string;
  /** Moeda fiat source ("BRL", "MXN", "USD"). */
  sourceAsset: string;
  /** Quantidade em smallest unit da source (centavos BRL, etc.). */
  sourceAmountCents: number;
  /** Carteira não-custodial de destino do crédito. */
  walletId: string;
  /** Endereço (public key) da carteira de destino — recebe o asset on-chain. */
  destinationPublicKey: string;
  /** customerId Etherfuse (vem do .env). */
  customerId: string;
  /** bankAccountId Etherfuse (gerado no registerCustomer, vem do .env). */
  bankAccountId: string;
  client: EtherfuseClient;
}

export interface InitiateEtherfuseDepositOutput {
  deposit: FiatDeposit;
  /** Instruções de pagamento (Pix key, valor, expiresAt) que o admin precisa seguir. */
  paymentInstructions: Record<string, unknown> | null;
  /** ID da order no Etherfuse — útil pra polling/simulação sandbox. */
  orderId: string;
}

export async function initiateEtherfuseDeposit(
  prisma: PrismaClient,
  input: InitiateEtherfuseDepositInput,
): Promise<InitiateEtherfuseDepositOutput> {
  const {
    app,
    companyId,
    userId,
    targetAsset,
    targetAssetIdentifier,
    sourceAsset,
    sourceAmountCents,
    walletId,
    destinationPublicKey,
    customerId,
    bankAccountId,
    client,
  } = input;

  const sourceAmountString = (sourceAmountCents / 100).toFixed(2);
  const quoteId = crypto.randomUUID();

  // 0. Garante a carteira de destino registrada na org (idempotente; sob a org
  //    KYB-aprovada volta com kycStatus=approved → pode receber on-ramp).
  try {
    await client.registerWallet(destinationPublicKey);
  } catch (err) {
    app.log.warn(
      { destinationPublicKey, err: (err as Error).message },
      'etherfuse registerWallet falhou (pode já existir) — seguindo para o quote',
    );
  }

  // 1. Cria quote (sem walletAddress — vai no publicKey do order)
  let quote;
  try {
    quote = await client.createQuote({
      quoteId,
      customerId,
      blockchain: 'stellar',
      quoteAssets: {
        type: 'onramp',
        sourceAsset,
        targetAsset: targetAssetIdentifier,
      },
      sourceAmount: sourceAmountString,
    });
  } catch (err) {
    throw new StellarError(`Etherfuse quote failed: ${(err as Error).message}`);
  }

  // 2. Cria order com o quoteId + publicKey da treasury (recebe o asset)
  let order;
  try {
    order = await client.createOrder({
      quoteId: quote.quoteId,
      publicKey: destinationPublicKey,
      bankAccountId,
    });
  } catch (err) {
    throw new StellarError(`Etherfuse order failed: ${(err as Error).message}`);
  }

  // 3. Persiste FiatDeposit
  const anchorId = client.isSandbox ? 'etherfuse-sandbox' : 'etherfuse-prod';
  const deposit = await prisma.fiatDeposit.create({
    data: {
      companyId,
      userId,
      walletId,
      anchorId,
      anchorTransactionId: order.orderId,
      interactiveUrl: null, // Etherfuse não usa interactive URL
      instructions: (order.paymentInstructions ?? {}) as object,
      sourceAsset,
      sourceAmountCents: BigInt(sourceAmountCents),
      asset: targetAsset,
      amountCents: (() => {
        const target = quote.destinationAmountAfterFee ?? quote.destinationAmount;
        return target ? BigInt(Math.round(parseFloat(target) * 100)) : null;
      })(),
      status: mapEtherfuseStatusToDb(order.status),
    },
  });

  return {
    deposit,
    paymentInstructions: order.paymentInstructions ?? null,
    orderId: order.orderId,
  };
}

/**
 * Consulta status atual no Etherfuse e atualiza FiatDeposit no DB.
 * No-op se já terminal OR se último check <30s atrás (a menos que force=true).
 */
export async function pollAndSyncEtherfuseDeposit(
  prisma: PrismaClient,
  app: FastifyInstance,
  client: EtherfuseClient,
  depositId: string,
  options: { force?: boolean } = {},
): Promise<FiatDeposit> {
  const existing = await prisma.fiatDeposit.findUnique({ where: { id: depositId } });
  if (!existing) throw new NotFoundError(`FiatDeposit ${depositId} not found`);

  if (isTerminalDbStatus(existing.status)) return existing;

  const fresh = options.force || Date.now() - existing.updatedAt.getTime() > STALE_POLL_MS;
  if (!fresh) return existing;

  let order: EtherfuseOrder;
  try {
    order = await client.getOrder(existing.anchorTransactionId);
  } catch (err) {
    app.log.warn(
      { depositId, err: (err as Error).message },
      'etherfuse poll failed',
    );
    return existing;
  }

  const newStatus = mapEtherfuseStatusToDb(order.status);
  const txHash = order.stellarTxHash ?? existing.txHash;
  const actualAmountCents = order.actualAmount
    ? BigInt(Math.round(parseFloat(order.actualAmount) * 100))
    : order.targetAmount
      ? BigInt(Math.round(parseFloat(order.targetAmount) * 100))
      : existing.actualAmountCents;
  const completedAt =
    order.status === 'completed' && order.completedAt
      ? new Date(order.completedAt)
      : existing.completedAt;
  const failureReason = ['failed', 'expired'].includes(order.status)
    ? order.message ?? `etherfuse status=${order.status}`
    : existing.failureReason;

  const updated = await prisma.fiatDeposit.update({
    where: { id: depositId },
    data: {
      status: newStatus,
      txHash,
      actualAmountCents,
      completedAt,
      failureReason,
    },
  });

  // Audit event apenas na transição PARA COMPLETED
  if (
    existing.status !== FiatTransactionStatus.COMPLETED &&
    newStatus === FiatTransactionStatus.COMPLETED
  ) {
    await prisma.auditEvent.create({
      data: {
        companyId: existing.companyId,
        eventType: EventType.FIAT_DEPOSITED,
        actor: `anchor:${existing.anchorId}`,
        payload: {
          fiatDepositId: existing.id,
          anchorTransactionId: existing.anchorTransactionId,
          asset: existing.asset,
          sourceAsset: existing.sourceAsset,
          amountCents: actualAmountCents ? Number(actualAmountCents) : null,
          txHash,
          provider: 'etherfuse',
        } as object,
      },
    });
    app.log.info(
      { depositId, txHash, amountCents: actualAmountCents?.toString() },
      'etherfuse deposit completed',
    );
  }

  return updated;
}

/**
 * Simula recebimento de Pix em sandbox (POST /ramp/order/:id/fiat_received).
 * Atalho para desbloqueio do caminho feliz sem precisar pagar Pix real.
 */
export async function simulateEtherfuseFiatReceived(
  prisma: PrismaClient,
  app: FastifyInstance,
  client: EtherfuseClient,
  depositId: string,
): Promise<FiatDeposit> {
  if (!client.isSandbox) {
    throw new StellarError('simulate fiat_received only available in sandbox');
  }
  const existing = await prisma.fiatDeposit.findUnique({ where: { id: depositId } });
  if (!existing) throw new NotFoundError(`FiatDeposit ${depositId} not found`);

  try {
    await client.simulateFiatReceived(existing.anchorTransactionId);
  } catch (err) {
    throw new StellarError(`Etherfuse simulate failed: ${(err as Error).message}`);
  }

  // Após simular, poll para refletir novo status
  return await pollAndSyncEtherfuseDeposit(prisma, app, client, depositId, { force: true });
}

// ============================================================================
// Mapping helpers
// ============================================================================

const ETHERFUSE_TO_DB_STATUS: Record<EtherfuseOrderStatus, FiatTransactionStatus> = {
  created: FiatTransactionStatus.PENDING_USER_TRANSFER,
  funded: FiatTransactionStatus.PROCESSING,
  completed: FiatTransactionStatus.COMPLETED,
  finalized: FiatTransactionStatus.COMPLETED,
  failed: FiatTransactionStatus.FAILED,
  expired: FiatTransactionStatus.FAILED,
};

/** Mapeia status de order Etherfuse → FiatTransactionStatus do DB. */
export function mapEtherfuseStatusToDb(s: string): FiatTransactionStatus {
  return (
    ETHERFUSE_TO_DB_STATUS[s as EtherfuseOrderStatus] ?? FiatTransactionStatus.PROCESSING
  );
}

/** true se o status do DB é terminal (não vale mais fazer polling). */
export function isTerminalDbStatus(s: FiatTransactionStatus): boolean {
  return (
    s === FiatTransactionStatus.COMPLETED ||
    s === FiatTransactionStatus.FAILED ||
    s === FiatTransactionStatus.REFUNDED
  );
}

export { isTerminalEtherfuseStatus };
