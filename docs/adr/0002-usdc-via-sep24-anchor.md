# ADR-0002 — USDC via SEP-24 anchor como asset operacional

**Status:** Accepted (substitui plano original de issuer próprio Aegis com AUTH_CLAWBACK_ENABLED)  
**Data:** 2026-05-17  
**Decisão correspondente:** D2 + D11

---

## Contexto

O Aegis Protocol precisa manter saldo on-chain (na treasury) que possa ser usado para pagar vendors. Há três caminhos:

1. **Asset Aegis-issued** (`aUSD`) — Aegis vira issuer, tem total controle (Clawback, Auth, etc.). Mas vendors precisam de trustline para `aUSD` (asset desconhecido).
2. **USDC nativo via anchor SEP-24** — asset emitido por anchor regulado (Circle em mainnet, test-anchor em testnet). Vendors podem usar o mesmo USDC já familiar.
3. **XLM nativo** — sem trustline, sem stablecoin (volátil).

A decisão inicial (revisão 1 do plano) era opção (1) para habilitar kill switch via Clawback. O usuário trouxe duas mudanças:
- **Fiat on/off ramp obrigatório no MVP** (decisão D11) — requer integração com anchor SEP-24.
- **Kill switch rebaixado a stretch goal** (decisão D12) — não é mais requisito MVP.

Com kill switch fora do MVP, a justificativa principal de issuer próprio (controle de Clawback) some. E ter fiat ramp obrigatório implica que o asset operacional naturalmente vira USDC do anchor.

## Decisão

**O asset operacional da treasury Aegis no MVP é USDC do anchor SEP-24** (testnet: `testanchor.stellar.org`).

Implicações:
- Treasury holda USDC + XLM operacional. **Não** holda asset proprietário.
- Aegis NÃO é issuer do asset — não pode dar Clawback.
- Vendors abrem trustline para USDC do anchor (asset reconhecido).
- Fiat ramp via SEP-24 do mesmo anchor mantém coerência (deposit/withdraw direto no asset que está em uso).

Para o Stretch Goal S1 (kill switch via Clawback), planejamos asset Aegis-issued **separado** (`aUSD`) paralelo ao USDC operacional. Documentado em `docs/04-stellar-asset-design.md §7`.

## Consequências

### Positivas
- Fiat ramp end-to-end (deposit → spend → withdraw) é coerente em um único asset.
- USDC tem aceitação universal (vendors já conhecem).
- Aegis não precisa lidar com mecânica de issuer (asset creation, distribution policy, supply management).
- Onboarding de vendor é mais simples (trustline para USDC = padrão).
- Compliance/regulação fica majoritariamente com o anchor (que já é regulado).

### Negativas
- **Sem kill switch on-chain no MVP.** Comprometimento da treasury secret = drenagem total, sem reversão.
- Aegis depende do anchor (uptime, política, compliance). Se anchor for comprometido ou descontinuado, há ruptura de serviço.

### Mitigações
- Monitoria contínua de balance da treasury; alerts em mudanças bruscas.
- Hot wallet limitada ($X máximo) em testnet; em mainnet, multisig + KMS (Marco 2).
- Multi-anchor planejado para Marco 3 (Circle + Anclap + MoneyGram) — reduz dependência de um único provider.
- Stretch S1 traz kill switch via asset paralelo aUSD se sobrar tempo.

## Alternativas consideradas

- **Issuer próprio aUSD único asset:** rejeitado porque fiat ramp não funciona (anchor não emite asset Aegis). Vendors precisariam trustline desconhecida. Pequena demanda inicial.
- **Híbrido aUSD + path payment para USDC:** considerado. Treasury holda aUSD (com Clawback), no momento do pagamento converte para USDC do anchor via path payment / DEX. Mais complexo. Requer liquidez DEX aUSD↔USDC (Aegis vira market maker). Mantido como design Stretch S1.
- **XLM nativo:** rejeitado — volatilidade do XLM faz unidade econômica imprevisível para agentes e Companies; não casa com o use case "pagar API por chamada".

## Revisão

Reavaliar quando: (1) MVP estiver pronto e Stretch S1 for priorizado, (2) anchor SEP-24 mainnet escolhido (Circle/Anclap) tiver alguma restrição que justifique mudar de modelo, (3) demanda por kill switch crypto-enforçado vier de design partners.
