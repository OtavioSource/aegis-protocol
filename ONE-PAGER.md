# Aegis Protocol

**Camada de governança econômica para agentes de IA.**

> Permitindo que empresas deem autonomia financeira para seus agentes sem perder o controle do caixa.

---

## O Problema

Empresas estão deployando agentes de IA em produção — LangChain, CrewAI, agentes da OpenAI — que precisam executar gastos: pagar APIs, comprar dados, renovar serviços, contratar ferramentas. Hoje, não existe nenhuma camada de governança financeira entre o agente e o dinheiro. As empresas têm apenas dois caminhos ruins:

- **Bloquear tudo** → perder a automação que justifica o agente.
- **Liberar tudo** → perder o controle do caixa e expor a operação a risco financeiro descontrolado.

## A Solução

Aegis Protocol é a infraestrutura de governança que falta entre o agente e o trilho de pagamento. Uma API que recebe pedidos de gasto, avalia contra políticas customizáveis, decide (aprovar, escalar para humano ou rejeitar) e executa pagamentos on-chain de forma auditável.

**Pensa numa Stripe para pagamentos de agentes de IA — com regras de política, botão de emergência e auditoria criptográfica.**

## Como Funciona

```
Agente → API Aegis → Política avalia → Decisão → Pagamento on-chain → Recibo on-chain
```

1. **Empresa configura políticas** — limites por transação, fornecedores permitidos, budget mensal, tipo de gasto autorizado, threshold para revisão humana.
2. **Agente solicita gasto via API** — o agente nunca tem acesso direto à carteira; a Aegis tem.
3. **Engine de políticas avalia em milissegundos** — 10 regras avaliadas em ordem de prioridade.
4. **Decisão imediata** — aprovação automática, escalação para revisor humano, ou rejeição com justificativa.
5. **Execução on-chain** — pagamento real para a carteira do fornecedor, com hash de transação verificável.
6. **Recibo cripto imutável** — cada decisão gera um NFT comprimido on-chain (~US$0.00005 cada), criando um audit trail tamper-proof.
7. **Botão de emergência** — kill switch criptográfico que varre fundos on-chain via Permanent Delegate. Não é uma flag no banco de dados — é uma operação no protocolo, irreversível sem a chave da Aegis.

## Solana hoje, multi-chain por design

A primeira versão roda em **Solana** (Token-2022, Metaplex Bubblegum para recibos, Solana Pay para invoicing). A arquitetura usa uma interface chamada **SettlementAdapter** que abstrai a camada de pagamento — adicionar uma nova rede é implementar essa interface, sem tocar na lógica de governança.

### Por que Stellar é a próxima rede natural

| Feature da Stellar | Encaixe com o Aegis |
|---|---|
| **Path Payments** | Pagamentos cross-currency atômicos via DEX nativa. Agente paga em USDC, vendor recebe em EURC, BRL ou EUR em uma única operação. Cenário ideal para fornecedores globais. |
| **Anchors (SEP-31)** | Bridge nativa para fiat. Vendor recebe em moeda local na conta bancária, sem precisar entender de cripto. Resolve o off-ramp que trava adoção em PMEs. |
| **Soroban** | Migração futura da engine de políticas para contratos on-chain, removendo a dependência do servidor central e aumentando a auditabilidade. |

A tese da Stellar — **pagamentos globais de baixo custo** — é exatamente o caso de uso de agentes pagando fornecedores cross-border em alto volume e ticket pequeno.

## Status

- **MVP funcional** — governança end-to-end rodando em Solana devnet, com transferências reais e recibos on-chain.
- **Submissão no Solana Frontier Hackathon** (Colosseum) — entrega em maio/2026.
- **17 testes unitários** na engine de políticas (pura, determinística, zero I/O).
- **Open source com licença Business Source** (uso comercial restrito por 4 anos).
- **Próximos passos** — primeiros pilots, integração Stellar, registro de marca.

## Modelo de Negócio

| Tier | Preço | Inclui |
|------|-------|--------|
| Free | US$0 | 1 agente, 100 transações/mês |
| Pro | US$49/mês | 10 agentes, regras avançadas, recibos on-chain |
| Enterprise | US$499/mês | Ilimitado, SLA, tesouraria dedicada, Permanent Delegate por tenant |
| Volume | 0.1% | Sobre volume governado, cap de US$1 por transação |

## Visão

A economia de agentes de IA está em formação agora. Em 5 anos, toda empresa de médio porte vai ter dezenas de agentes operando autonomamente, executando gastos diários. A camada de controle financeiro para essa nova economia não existe ainda.

**Aegis quer ser a Stripe dessa economia — e a Stellar é o trilho de pagamento global preferencial para o caso de uso cross-border.**

---

**Otávio Silva**
otavioaraujo.es@gmail.com
github.com/OtavioSource/aegis-protocol
