/**
 * Treasury guard — pre-check de saldo antes de submeter um pagamento.
 *
 * Evita que aprovações humanas ou execuções automáticas tentem uma tx Stellar
 * fadada a falhar por saldo insuficiente. Falha "rápida e clara" com mensagem
 * de erro que diga exatamente quanto há e quanto faltaria — em vez de propagar
 * erro genérico do Horizon.
 *
 * XLM (sem amountCents) é tratado como "pula check" — não bloqueia.
 */

import type { FastifyInstance } from 'fastify';

export type BalanceCheck =
  | { ok: true }
  | { ok: false; reason: string };

export async function ensureTreasuryBalance(
  app: FastifyInstance,
  asset: string,
  amountCents: number,
): Promise<BalanceCheck> {
  const balance = await app.stellar.getTreasuryBalance(asset);
  if (balance.amountCents === null) {
    return { ok: true };
  }
  if (balance.amountCents < amountCents) {
    const need = (amountCents / 100).toFixed(2);
    const have = balance.amount;
    return {
      ok: false,
      reason: `Insufficient treasury balance: $${need} ${balance.assetCode} required, only ${have} available.`,
    };
  }
  return { ok: true };
}
