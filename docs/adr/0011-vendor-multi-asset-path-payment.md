# ADR-0011 — Vendor pode receber em múltiplos assets via Path Payment Strict Receive

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** RF11

---

## Contexto

A treasury Aegis holda apenas USDC (decisão D2 / ADR-0002). Mas vendors podem ter preferências diferentes:

- **Vendor brasileiro:** prefere receber **BRL** (familiar; não precisa converter ele mesmo depois).
- **Vendor europeu:** prefere **EURC**.
- **Vendor cripto-nativo:** aceita **USDC** sem problema.
- **Vendor de outros mercados:** ARS, CLP, MXN — conforme anchors disponíveis.

Forçar todos os vendors a receber USDC contradiz nossa tese de "zero fricção blockchain": um vendor brasileiro recebendo USDC ainda precisa converter para BRL em algum exchange ou anchor para usar. Mesmo problema persiste, só transferido.

Stellar tem operação nativa **`PathPaymentStrictReceive`** que faz conversão atomic entre dois assets via DEX:
- Source: treasury Aegis envia até `sendMax` USDC.
- Destination: vendor recebe **exatamente** `destAmount` no asset escolhido.
- DEX executa ou tudo falha — atomic, sem estado intermediário.

## Decisão

**Implementar `PathPaymentStrictReceive` no fluxo principal de pagamento do MVP.** Vendor declara `preferredAsset` no cadastro; Aegis usa Path Payment quando esse asset ≠ USDC, mantendo treasury sempre em USDC.

### Comportamento
1. Vendor cadastrado com `preferredAsset` (default `"USDC"`; aceita `"EURC"`, `"BRL"`, `"ARS"`, etc.).
2. Onboarding sponsored abre trustline para `preferredAsset` (não fixo em USDC).
3. Na hora do pagamento:
   - Se `preferredAsset = USDC` → operação `Payment` direta (sem conversão).
   - Se `preferredAsset ≠ USDC` → operação `PathPaymentStrictReceive` com `sendAsset = USDC`, `destAsset = preferredAsset`, `destAmount = valor exato em asset destino`, `sendMax = valor USDC + slippage`.
4. Slippage tolerance configurável por Company (`Policy.rules.pathPaymentSlippage`, default 0.01 = 1%).
5. Falhas tratadas explicitamente:
   - `PATH_NOT_FOUND` (sem liquidez no order book) → SpendRequest vira `EXECUTION_FAILED` com mensagem clara.
   - `EXCEEDS_SLIPPAGE` (mercado moveu) → falha clara; admin pode aumentar slippage e retry.

## Consequências

### Positivas
- **Refor√ßa a tese "zero fricção blockchain":** vendor brasileiro recebe BRL; europeu recebe EURC; todos sem nunca ter ouvido falar de Stellar.
- **Treasury continua simples:** holda APENAS USDC. Não vira "tesouraria multi-moeda" (que traria complexidade de balance management, reconciliation, etc.).
- **TAM amplia internacionalmente:** Aegis fica utilizável fora dos EUA sem o vendor precisar "lidar com dólar".
- **Mantém coerência com fiat ramp:** ramp Company continua só USDC (anchor único); só o "lado vendor" é multi-asset.

### Negativas
- **Dependência de liquidez DEX para o par USDC ↔ preferredAsset.**
  - **Mainnet:** anchors como Anclap (BRL/ARS/EURC), Circle (USDC/EURC), Tempo (EURC) mantêm pares ativos. Risco baixo.
  - **Testnet:** test-anchor pode ter liquidez limitada. Validar antes de prometer demo multi-asset.
- **Slippage real existe.** Pequeno (~0.1-1% em pares líquidos mainnet), pode ser maior em testnet ou em movimentos bruscos.
- **Maior complexidade no Stellar adapter:** lib `@aegis/stellar` precisa de:
  - Resolução de `asset_code → Asset(code, issuer)` via mapping mantido em código.
  - Path calculation via `server.strictReceivePaths(...)`.
  - Slippage application.
  - Error mapping de Horizon errors específicos (`tx_bad_seq`, `op_no_trust`, etc.) já existentes + novos (`op_no_path`, `op_under_dest_min`).
- **UX de configuração:** admin precisa entender que escolher BRL/EURC implica dependência de liquidez. Documentar em tooltip no dashboard.

### Mitigações
- **Mapping de assets explícito em código** (`packages/stellar/src/assets.ts`) — auditável via git, sem dynamic asset resolution risk.
- **Whitelist de assets suportados** — não aceitar qualquer asset_code arbitrário. Adicionar novo asset = PR + revisão.
- **Validação prévia no cadastro do vendor:** chamada teste `getOrderbook(USDC, preferredAsset)` para garantir liquidez mínima antes de aceitar; falha cedo se par não existe.
- **Em testnet:** se par USDC↔EURC/BRL não tem maker, Aegis pode atuar como market maker temporário para demo (`manageBuyOffer`/`manageSellOffer`). Documentado como "demo helper", não produção.
- **Slippage default conservador** (1%); admin pode ajustar via policy.

## Alternativas consideradas

- **USDC-only (status quo antes desta decisão):** rejeitado pelo motivo central — vendor não-USDC enfrenta a mesma fricção que tentamos eliminar. "Zero fricção blockchain" vira meia-verdade.
- **Treasury multi-asset (Aegis holda USDC + EURC + BRL):** rejeitado por complexidade massiva — Aegis viraria operação de tesouraria multi-moeda, com fiat ramp em N anchors, reconciliation cross-asset, exposição cambial. Adia para Marco 3+ se demanda real surgir.
- **Cliente cuida da conversão off-chain:** rejeitado — empurra fricção para o vendor (exato problema que queremos resolver).
- **Path Payment Strict Send (variante):** rejeitado para o MVP — queremos garantir que vendor receba o valor exato cobrado (`destAmount`), não que treasury despenda valor exato (`sendAmount`). Strict Send seria útil em fluxo "treasury tem 100 USDC, gaste isso e veja o que vendor recebe" — não é nosso caso.

## Revisão

Reavaliar quando:
- Demanda por mais assets exigir mapping crescer demais → considerar carregamento dinâmico via SEP-1 stellar.toml dos anchors.
- Volume multi-asset crescer → analisar economics (slippage agregado vs operar treasury multi-asset).
- Algum par crítico (ex: USDC↔BRL mainnet) perder liquidez → reavaliar parceria com anchor.
- Mainnet do Marco 3 → integrar mais anchors (Circle, Anclap, MoneyGram) tanto para fiat ramp quanto para suportar mais assets de destino.
