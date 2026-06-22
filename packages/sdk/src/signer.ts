/**
 * Assinador da agent key (modelo não-custodial 5a — ADR 0007).
 *
 * No fluxo two-phase, o Aegis devolve um envelope canônico (XDR não-assinado).
 * O agente assina aqui, client-side, com sua secret Stellar (`S...`), e devolve
 * ao `/cosign`. A secret NUNCA sai do ambiente do agente.
 *
 * Usa `@stellar/stellar-base` (multi-runtime: Node/Bun/Deno/Workers).
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-base';

/**
 * Assina um envelope XDR com a secret do agente, devolvendo o XDR assinado.
 *
 * @param envelopeXdr        XDR base64 não-assinado emitido pelo Aegis.
 * @param networkPassphrase  Passphrase da network (vem no response do Aegis).
 * @param agentSignerSecret  Secret Stellar do agente (`S...`).
 */
export function signEnvelope(
  envelopeXdr: string,
  networkPassphrase: string,
  agentSignerSecret: string,
): string {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  tx.sign(Keypair.fromSecret(agentSignerSecret));
  return tx.toXDR();
}
