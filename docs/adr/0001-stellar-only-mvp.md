# ADR-0001 — Stellar-only no MVP, com SettlementAdapter como Extension Point

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D4

---

## Contexto

Aegis Protocol é uma camada de governança econômica para agentes de IA. A camada de pagamento on-chain pode tecnicamente ser implementada em várias blockchains (Stellar, Solana, Base, Ethereum, etc.).

Há tentação de fazer "multi-chain desde o início" para maximizar TAM, mas isso adiciona complexidade significativa: diferentes SDKs, semânticas de fee, tempos de finalidade, mecanismos de stablecoin, mecanismos de auditoria on-chain, modelos de custódia.

Histórico relevante: a branch `feature/stellar` deste repo tem uma implementação anterior multi-chain (Solana + Stellar coexistindo via SettlementAdapter), que foi descartada — ver ADR sucessor implícito na decisão D1.

## Decisão

**No MVP, suportamos apenas Stellar como rede on-chain de settlement.** A interface `SettlementAdapter` é preservada em `@aegis/shared` como **Extension Point** para futuras chains, mas não há outra implementação no MVP.

Critérios para escolha de Stellar sobre alternativas:
1. **Fees baixíssimos** (~0.00001 XLM) — viável para micropayments feitos por agentes de IA.
2. **Sponsored Reserves (CAP-33) e Fee Bump (CAP-15) nativos** — permite zero fricção UX (vendor sem XLM).
3. **SEP-24 maduro** — fiat on/off ramp padronizado, anchors testnet disponíveis (`testanchor.stellar.org`).
4. **Soroban** — smart contracts em Rust, suficiente para o contrato `aegis_audit`.
5. **USDC nativo** via Circle (mainnet) ou test-anchor (testnet) — sem precisar bridge.
6. **Finalidade rápida** (~5s por ledger).
7. **Comunidade compliance-friendly** — anchors regulados em vários países, alinhado com persona empresarial.

## Consequências

### Positivas
- Foco reduz tempo até MVP funcional.
- Stack Stellar tem todas as primitivas necessárias sem hacks.
- Documentação técnica fica coerente (um único mental model).
- Fee model previsível (custo desprezível).

### Negativas
- TAM teórico inicial menor (clientes que só fazem cripto Solana/EVM precisam esperar).
- Stellar tem menor mindshare em ecossistemas dev mais novos (LangChain, AgentKit) — precisamos educar.

### Mitigações
- `SettlementAdapter` preserva opcionalidade: adicionar Solana/Base no futuro é re-implementar a interface, não refactor de toda a API.
- Comunicação externa pode reposicionar "Stellar-native" como diferencial (compliance, fiat ramp, governance contracts) ao invés de limitação.

## Alternativas consideradas

- **Solana-only:** ecossistema vibrante de agentes (AgentKit do Solana), mas fees variáveis (priority fees), sem fiat ramp embutido equivalente a SEP-24, sponsoring de account requer Token-2022 e é mais complexo.
- **EVM L2 (Base, Optimism):** ecossistema dev massivo, mas fees ainda significativos para micropayments, fiat ramp via Coinbase/Circle disponível mas menos padronizado.
- **Multi-chain desde MVP:** descartado — código mostrou em `feature/stellar` que coexistência ativa dobra superfície de bugs e atrasa entrega.

## Revisão

Reavaliar quando: (1) clientes empresariais pedirem outra chain explicitamente, (2) tecnologia Stellar tiver alguma limitação descoberta em produção, (3) regulação tornar Stellar inviável em geografia chave.
