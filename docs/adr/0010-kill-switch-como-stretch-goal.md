# ADR-0010 — Kill switch via Clawback rebaixado a Stretch Goal

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D12

---

## Contexto

A descrição inicial do produto incluía como **requisito desejável** um kill switch criptograficamente enforçado: a treasury Aegis emitiria um asset próprio com `AUTH_CLAWBACK_ENABLED`, permitindo que em caso de comprometimento (chave vazou, atacante drenando fundos), a Aegis pudesse emitir uma operação `Clawback` que **revoga os tokens** mesmo já distribuídos, voltando-os para uma quarantine account.

Esse mecanismo é poderoso porque:
- Atua **on-chain** (não é apenas flag em DB que atacante pode burlar).
- É verificável publicamente.
- Funciona mesmo se DB Aegis estiver comprometido.

Mas tem custos significativos:
1. **Asset precisa ser Aegis-issued.** Implica que vendors abrem trustline para `aUSD` (asset desconhecido), não USDC familiar.
2. **Conflito com fiat ramp via SEP-24.** Anchor emite USDC. Se asset operacional é `aUSD`, precisamos swap USDC ↔ aUSD (path payment ou DEX manual).
3. **Treasury vira "tesouraria de 2 assets"** — operacional (USDC) + governance (`aUSD`) — com swap sob demanda.
4. **Aegis precisa atuar como market maker** de `aUSD ↔ USDC` na DEX nativa Stellar para garantir liquidez.
5. **Chave do issuer é mais sensível** que a da treasury operacional — comprometimento do issuer permite criar tokens infinitos.
6. **UX do vendor degrada:** trustline para asset desconhecido reduz confiança.

Durante o planejamento, o usuário ponderou duas mudanças que afetam essa decisão:
- **Fiat on/off ramp obrigatório no MVP** (D11) — força integração SEP-24 com USDC.
- **Lembrete explícito:** kill switch é desejável, "só vamos implementá-lo se sobrar bastante tempo".

## Decisão

**Kill switch via Clawback é Stretch Goal S1**, executado **somente** após o Marco 1 (MVP Testnet) estar completo e validado, e se houver tempo restante.

Para o MVP:
- Treasury holda **USDC do anchor** (não Aegis-issued).
- Kill switch funciona apenas como **flag de DB** (status `KILL_SWITCH_ACTIVATED` em todas as Policies da Company) e **suspensão de signing** (API se recusa a submeter novas txs).
- **Não há revogação on-chain.** Se chave for comprometida, Aegis depende de:
  - Detecção rápida (monitoria + alerts).
  - Off-ramp manual via anchor (transfere USDC para conta segura).
  - Procedure de incident response.

Para o Stretch S1 (após MVP):
- Criar asset `aUSD` Aegis-issued com `AUTH_REVOCABLE_FLAG` + `AUTH_CLAWBACK_ENABLED`.
- Treasury holda paralelamente: USDC (operacional) + `aUSD` (governance).
- Swap entre eles via DEX nativa Stellar (Aegis atua como market maker inicial).
- Operação Clawback funcional via dashboard com dupla confirmação.

Documentação técnica do Stretch em `docs/04-stellar-asset-design.md §7`.

## Consequências

### Positivas (de rebaixar)
- **MVP entrega mais cedo.** ~10 dias de dev economizados.
- **UX do vendor mantém-se simples.** USDC familiar, trustline única.
- **Sem necessidade de Aegis virar market maker** de aUSD↔USDC.
- **Custódia mais simples no MVP.** Treasury não tem 2 assets + issuer separado.
- **Coerência arquitetural com fiat ramp** — anchor emite USDC, Aegis usa USDC, fim de papo.

### Negativas (de rebaixar)
- **Sem proteção on-chain real no MVP.** Se chave vazar e atacante drenar, perda é total até detecção+off-ramp manual.
- **Comunicação externa precisa ser honesta:** "kill switch on-chain virá no Marco 2/Stretch" — não vender o que não temos.
- **Comparação com concorrentes:** se algum competidor lançar com kill switch real, marketing precisa argumentar com outros diferenciais (UX, fiat ramp, audit Soroban).

### Mitigações no MVP
- **Aceitamos o risco em testnet:** valor envolvido é simbólico.
- **Em mainnet (Marco 3) sem Stretch S1 implementado:** treasury opera com saldo limitado ($X máximo), multisig + KMS (do Marco 2) reduzem chance de comprometimento.
- **Stretch S1 fica priorizado para Marco 2** se não fizer parte do MVP — antes do Marco 3 (Mainnet) é desejável tê-lo.

## Alternativas consideradas

- **Manter kill switch via Clawback no MVP:** rejeitado pelo trade-off com fiat ramp e pelo lembrete explícito do usuário ("desejável, só se sobrar tempo").
- **Kill switch via "soft freeze" sem on-chain:** o que estamos fazendo no MVP (flag DB + signing suspenso). Reconhecidamente incompleto.
- **Kill switch via Stellar account freeze (set signer weights to 0):** considerado. Reduz o impacto de comprometimento (se atacante não tem nova chave de assinatura, não consegue submeter txs). Mas se atacante já tem a chave, freeze não impede uso. Mantemos como complemento, não substituto.

## Revisão

Reavaliar:
- **Ao final do Marco 1:** decidir se Stretch S1 vai pro Marco 2 obrigatoriamente ou continua como nice-to-have.
- **Antes do Marco 3 (Mainnet):** decisão forçada — ou implementamos Stretch S1, ou comunicamos publicamente a limitação.
- **Se qualquer incidente de segurança ocorrer em qualquer fase:** kill switch on-chain vira prioridade #1.
