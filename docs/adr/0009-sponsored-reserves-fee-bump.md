# ADR-0009 — Sponsored Reserves (CAP-33) + Fee Bump (CAP-15) para zero fricção

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D10

---

## Contexto

A maior barreira de adoção de pagamentos cripto B2B é a **fricção UX da blockchain**: para receber qualquer token na Stellar, o destinatário precisa:

1. **Ter uma account criada** — requer 0.5 XLM de base reserve.
2. **Abrir trustline para o asset** (USDC, EURC, etc.) — requer +0.5 XLM de reserve.
3. **Gerenciar uma chave Stellar** com algum saldo XLM.
4. **Pagar fees** das transações que iniciar (mesmo que ínfimas).

Para um vendor não-técnico — uma empresa que oferece API B2B e quer receber pagamento de agentes — esses passos são impeditivos. Comprar XLM em uma exchange, fazer KYC, transferir para uma wallet, configurar Freighter, abrir trustline — **90% desiste antes do passo 3**.

Stellar tem dois primitivos nativos para resolver isso:

- **CAP-33 (Sponsored Reserves):** uma account A pode pagar os reserves de uma account B. Os reserves continuam contados em B mas o XLM que os cobre vem de A.
- **CAP-15 (Fee Bump):** uma account A pode envelopar uma transação T (cujo source é B) e pagar a fee dela.

## Decisão

**Aegis usa Sponsored Reserves (CAP-33) por default para todo onboarding de vendor.** Fee Bump (CAP-15) fica disponível para casos futuros (vendor iniciando transação) mas não é necessário no fluxo MVP padrão.

### Onboarding de vendor: 1 transação atomic
```
Operation 1: BeginSponsoringFutureReserves(sponsoredId: vendor)   ← treasury assina
Operation 2: CreateAccount(destination: vendor, startingBalance: 0)
Operation 3: ChangeTrust(source: vendor, asset: USDC)              ← vendor assina
Operation 4: EndSponsoringFutureReserves(source: vendor)           ← vendor assina
```

Resultado:
- Vendor account existe com **0 XLM próprio**.
- Trustline USDC ativa (reserves cobertas pela treasury).
- Vendor pronto para receber USDC sem nunca ter tocado em XLM.

### Custo operacional
| Item | Reserves locked na treasury |
|------|------------------------------|
| Vendor account | 0.5 XLM |
| Trustline USDC | 0.5 XLM |
| **Por vendor** | **1.0 XLM** |

Recuperável via `RevokeSponsorship` quando vendor for removido.

### Quem assina o quê
- Operations 1 (sponsoring) e a tx em si: treasury Aegis.
- Operations 3 e 4 (autorização do vendor): vendor.
  - **Modo A (default MVP):** Aegis gera o keypair do vendor, assina como vendor + treasury.
  - **Modo B (opcional):** vendor fornece publicKey e assina out-of-band (Freighter/LOBSTR).

Detalhes em `docs/05-zero-friction-onboarding.md §4`.

### Fee Bump (não usado por default)
- Toda transação MVP tem `source = treasury Aegis` → treasury já paga a fee por ser source. Fee Bump seria redundante.
- Fee Bump fica como capability disponível em `@aegis/stellar` para casos futuros:
  - Vendor inicia transação (ex: solicitar refund).
  - Company tem account própria e Aegis cobre as fees dela.
  - Vendor precisa fazer claim de Claimable Balance.

## Consequências

### Positivas
- **Onboarding de vendor: <30 segundos**, sem nenhum passo blockchain do vendor (no Modo A).
- **Diferencial competitivo claro:** "vendor não precisa ter XLM nem entender Stellar". Marketing-friendly.
- **TAM amplia drasticamente:** vendors não-cripto-nativos se tornam endereçáveis.
- **Custo controlado:** 1 XLM por vendor é negligível (10k vendors = 10k XLM = $10k em mainnet hoje, recuperável via RevokeSponsorship).

### Negativas
- **Treasury Aegis precisa manter XLM operacional suficiente.** Cada vendor onboarded consome 1 XLM. Em testnet refundamos via Friendbot; em mainnet, requer planejamento.
- **Custódia da chave do vendor (Modo A):** secret key fica com a Aegis. Vazamento do DB + da chave de encriptação = perda dos USDC dos vendors. Mitigação: KMS por vendor no Marco 2.
- **RevokeSponsorship requer saldo zerado** do vendor (não pode revogar trustline com saldo) — endpoint `DELETE /vendors/:id` precisa validar.
- **Vendor desabilitado fica "preso"** se Aegis não fizer cleanup correto — Aegis tem responsabilidade operacional.

### Mitigações
- Monitoria: alert quando XLM operacional da treasury < 50 (ou X% do necessário para N vendors esperados).
- Documentar custo operacional para Companies (transparência sobre tarifa potencial futura).
- Suportar Modo B (vendor self-custody) para vendors técnicos que queiram autonomia.

## Comparação UX

| Cenário | Fluxo padrão Stellar | Aegis com CAP-33 |
|---------|----------------------|------------------|
| Vendor cadastrar para receber USDC | T+0: precisa comprar XLM<br>T+10min: cria conta exchange<br>T+1h: faz KYC<br>T+1d: recebe XLM comprado<br>T+1d+10m: configura wallet, abre trustline<br>T+1d+20m: avisa Aegis "pronto"<br>**Desistência: ~80-90%** | T+0: admin clica "Add Vendor"<br>T+15s: vendor account criado + trustline ativa<br>T+15s: vendor pronto pra receber USDC<br>**Desistência: 0%** |

## Alternativas consideradas

- **Vendor self-onboarding tradicional Stellar:** rejeitado pela fricção UX descrita acima.
- **Custodial-puro (sem account Stellar do vendor):** rejeitado porque eventualmente vendor quer ter custódia do próprio USDC. Custodial torna Aegis um wallet provider regulado.
- **Sub-accounts via muxed accounts (M...):** considerado. Muxed accounts compartilham a account base, com sub-IDs por vendor. Mais simples on-chain, mas: (a) vendors muxed não conseguem ter próprias trustlines, (b) atomic transfer entre muxed accounts não tem isolamento real. Rejeitado por reduzir flexibilidade do vendor.
- **Lightning-style payment channels (não existe em Stellar nativo):** N/A.

## Revisão

Reavaliar quando:
- Custo XLM mainnet escalar — considerar tarifa de onboarding repassada ao cliente.
- Stellar lançar primitivos novos que simplifiquem ainda mais (ex: `account-less assets`, se algum dia existir).
- Modo B (self-custody) virar default — quando ecossistema vendor amadurecer cripto-nativamente.
