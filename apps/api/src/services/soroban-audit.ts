/**
 * Fire-and-forget Soroban audit emit.
 *
 * Não bloqueia o response. Falhas são logadas (nunca propagadas).
 * Quando bem-sucedida, atualiza AuditEvent.sorobanTxHash no DB.
 *
 * Requer AUDIT_CONTRACT_ID e TREASURY_SECRET configurados.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

import {
  invokeRecordDecision,
  loadTreasuryKey,
  type SorobanDecision,
} from '@aegis/stellar';
import { env } from '../env.js';

export interface EmitSorobanEventInput {
  prisma: PrismaClient;
  log: FastifyBaseLogger;
  spendRequestId: string;
  companyId: string;
  agentId: string;
  vendorId: string;
  amountCents: bigint | number;
  asset: string;
  policyId: string;
  policyVersion: number;
  decision: SorobanDecision;
  reason: string;
  timestampMs: number;
}

/** Call without await — fire and forget. */
export function emitSorobanAuditEvent(input: EmitSorobanEventInput): void {
  if (!env.AUDIT_CONTRACT_ID || !env.TREASURY_SECRET) {
    input.log.debug(
      { spendRequestId: input.spendRequestId },
      'Soroban emit skipped — AUDIT_CONTRACT_ID or TREASURY_SECRET not configured',
    );
    return;
  }

  void (async () => {
    try {
      const { keypair, publicKey } = loadTreasuryKey(env.TREASURY_SECRET);
      const result = await invokeRecordDecision(
        {
          contractId: env.AUDIT_CONTRACT_ID!,
          sorobanRpcUrl: env.SOROBAN_RPC_URL,
          networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
          treasuryPublicKey: publicKey,
          treasuryKeypair: keypair,
        },
        input.companyId,
        {
          spendRequestId: input.spendRequestId,
          agentId: input.agentId,
          vendorId: input.vendorId,
          amountCents: Number(input.amountCents),
          assetCode: input.asset,
          decision: input.decision,
          reason: input.reason,
          timestampMs: input.timestampMs,
          policyId: input.policyId,
          policyVersion: input.policyVersion,
        },
      );

      // Update the most-recent AuditEvent for this SpendRequest with the txHash
      const auditEvent = await input.prisma.auditEvent.findFirst({
        where: { spendRequestId: input.spendRequestId },
        orderBy: { createdAt: 'desc' },
      });
      if (auditEvent) {
        await input.prisma.auditEvent.update({
          where: { id: auditEvent.id },
          data: { sorobanTxHash: result.txHash, sorobanEmittedAt: new Date() },
        });
      }

      input.log.info(
        {
          spendRequestId: input.spendRequestId,
          txHash: result.txHash,
          ledger: result.ledger,
        },
        'Soroban audit event emitted',
      );
    } catch (err) {
      input.log.error(
        { spendRequestId: input.spendRequestId, err },
        'Soroban audit emit failed (non-fatal)',
      );
    }
  })();
}
