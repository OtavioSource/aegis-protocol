# ADR-0004 — Hot wallet em env var no MVP; KMS/multisig no Mainnet

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D6

---

## Contexto

A treasury Aegis tem uma chave secreta Stellar que autoriza pagamentos USDC. Essa chave é o ativo mais sensível do sistema — comprometimento permite drenagem total dos USDC operacionais (e dos XLM operacionais).

Opções de custódia avaliadas para o MVP:

1. **Hot wallet em env var** (`TREASURY_SECRET=S...` em Railway Secrets ou `.env`).
2. **KMS managed signing** (AWS KMS, GCP KMS) desde o MVP — chave nunca sai do KMS, signing via API.
3. **Multisig 2-de-3** desde o MVP — toda transação exige assinatura humana ou de outro signer.

## Decisão

**No MVP testnet:** hot wallet com `TREASURY_SECRET` em env var (Railway Secrets para produção dev, `.env.local` para desenvolvimento, nunca em git).

**No Marco 2 (hardening, antes de Mainnet):** migrar para KMS + multisig 2-de-3.

Estrutura:
- `apps/api` carrega `TREASURY_SECRET` no boot.
- Em memória apenas (não persistido em DB, não logado).
- `TreasuryAccount` no DB referencia o **nome** da env var (`secretKeyEnvVar`) para auditabilidade, não o valor.

## Consequências

### Positivas (no MVP testnet)
- **Velocidade.** Setup imediato; sem dependência de provider cloud KMS.
- **Latência ótima.** Signing in-process (sem round-trip ao KMS).
- **Custo zero adicional** (testnet).
- **Coerente com risco aceitável** — valor em testnet é simbólico; comprometimento ≠ perda real.

### Negativas
- **Vazamento da Railway = perda total.** Se infra Railway for comprometida (improvável mas possível), atacante drena treasury.
- **Sem rotação trivial.** Mudar a chave requer migrar saldo USDC + atualizar trustlines de vendors? (Não — vendor trustline aponta para asset, não para treasury; só precisa atualizar env var e fazer nova tx.)
- **Sem proteção contra ações maliciosas de admin interno** (uma pessoa com acesso à Railway pode roubar).

### Mitigações no MVP
- `TREASURY_SECRET` nunca em logs, nunca em DB.
- Acesso à Railway Secrets restrito a 1-2 pessoas.
- Monitoria contínua do balance da treasury; alert em mudanças bruscas.
- Em testnet, valor sempre baixo (~$100 USDC para demos).
- Procedimento de rotation documentado (gerar nova chave, transferir saldo, atualizar env, restart).

### Plano para Mainnet (Marco 2)
1. **AWS KMS** ou **GCP Secret Manager** com signing via API.
   - Chave nunca sai do KMS.
   - Application signa via KMS API com IAM role.
   - Audit log do KMS = trilha de quem assinou o quê.
2. **Multisig 2-de-3** no Stellar:
   - Signer 1: API key (KMS-managed).
   - Signer 2: admin humano (hardware wallet — Ledger, Trezor).
   - Signer 3: recovery offline (cold storage paper backup).
   - Toda tx > $X exige 2 assinaturas (API + admin).
   - Decisão de "qual threshold" reavaliada conforme volume.
3. **Operational procedures:**
   - On-call rotation para approval em < 5 min.
   - Runbook: "se chave parece comprometida, como rotacionar em <30min".

## Alternativas consideradas

- **KMS + multisig desde o MVP:** rejeitado por adicionar 1-2 semanas de dev em coisa que não traz valor para o produto no MVP (testnet, valor zero real). Resolveremos quando importar.
- **HSM físico (YubiHSM):** considerado para Mainnet, mas KMS managed é suficiente para o tamanho do problema. HSM físico avalia em Marco 4+ se valor on-chain justificar.
- **Threshold signatures (FROST etc.):** elegante mas complexidade muito alta para o tamanho do time MVP. Pode entrar no Marco 4+.

## Revisão

Reavaliar:
- **Antes do Marco 3 (Mainnet):** obrigatório — implementar KMS + multisig.
- **Após qualquer incidente** (chave vazada, mesmo que em testnet): postmortem e reavaliação imediata.
- **Anualmente:** revisar threshold do multisig conforme volume.
