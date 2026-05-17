# 00 — Visão

> Por que Aegis Protocol existe, para quem, e como vai ganhar.

---

## 1. Manifesto em uma frase

**Aegis Protocol é a camada de governança econômica que falta para você confiar capital a um agente de IA.**

---

## 2. O problema (em profundidade)

### 2.1 Contexto de mercado

Agentes de IA autônomos saíram de demos e entraram em produção. Cada vez mais workflows envolvem o agente **gastando dinheiro** sem humano no loop a cada decisão: chamando API LLM paga, comprando proxy residencial, contratando serviço de transcrição, pagando por unidade de inferência em redes descentralizadas, executando microcompras em mercados B2B emergentes.

O padrão técnico que está consolidando isso é o **HTTP 402 Payment Required** — um status code antigo que renasceu com propostas como x402 (Coinbase), e que está virando a forma natural de monetizar APIs para clientes não-humanos.

### 2.2 A lacuna

**Não existe hoje uma camada de governança que permita:**
- Definir políticas econômicas granulares (budget mensal, vendor allow/deny list, action types autorizados, threshold de aprovação humana).
- Decidir aprovação/rejeição em milissegundos sem bloquear o agente.
- Executar o pagamento atomicamente e devolver prova ao agente.
- Manter trilha auditável **externamente verificável** (não só logs do próprio app).
- Permitir intervenção humana rápida (aprovação manual, kill switch).

CTOs e founders hoje resolvem isso de quatro formas, todas insatisfatórias:

| Solução atual | Por que falha |
|---------------|---------------|
| Cartão corporativo no agente | Sem controle granular, sem auditoria forte, exposto a fraude |
| Stripe Issuing / virtual cards | Taxa alta (~2.9% + 30¢), settlement T+2, sem trilha cripto-verificável, limites grosseiros |
| Controles ad-hoc no código do agente | Cada projeto reinventa, mal testado, sem separação de privilégio |
| API key da OpenAI/Anthropic direto | Funciona só para um vendor; sem orçamento, sem aprovação humana, sem auditoria externa |

### 2.3 Por que agora

Três tendências confluem em 2025-2026:

1. **Agentes em produção** — Claude, GPT, Gemini com tool use viraram norma; agentes executam tarefas que custam dinheiro.
2. **HTTP 402 ressurgindo** — Coinbase x402, Cloudflare experimentando, micropagamentos voltando como caso de uso.
3. **Stablecoins compliance-ready** — USDC, EURC, anchors regulados em vários países; ramp fiat↔crypto sem mais ser exótico.

A janela está aberta: quem virar a referência de governança para agentes nos próximos 18-24 meses pega a primeira onda de clientes pagantes.

### 2.4 Escopo de controle: o que Aegis cobre e o que NÃO cobre no MVP

Honestidade sobre o que está e o que não está no MVP — para alinhar expectativa de cliente e evitar promessas que não cumprimos.

**Aegis cobre no MVP:**

| Caso de uso | Como funciona |
|-------------|---------------|
| Vendor expõe **HTTP 402** com pedido de pagamento on-chain (ex: proxy residencial decentralizado, scraping P2P, marketplace de dados, inferência decentralizada estilo Bittensor/Akash) | Agente recebe 402 → SDK chama `aegis.pay(invoice)` → Aegis avalia política → paga em USDC (ou converte para asset preferido do vendor) → devolve prova ao agente que reapresenta ao vendor |
| Vendor cadastrado pela Company para **pagamento direto** (sem 402) | Agente chama `aegis.pay({vendorId, amount, ...})` sabendo o vendor → fluxo idêntico (engine → política → pagamento → audit) |
| Marketplace M2M que liquida em USDC/EURC/BRL na Stellar | Tratado como vendor normal — Aegis paga, marketplace recebe |
| Pagamentos M2M entre duas empresas com Aegis em ambos os lados (futuro próximo) | Vendor recebe via Aegis também — settlement on-chain instantâneo |

**Aegis NÃO cobre no MVP:**

| Caso de uso | Por quê |
|-------------|---------|
| APIs LLM tradicionais — **OpenAI, Anthropic, Google** com billing via cartão de crédito | Essas APIs não falam HTTP 402; cobram via Stripe-like no painel próprio. Aegis não está no path da request. Cobertura desse caso → ver **"Aegis Proxy Mode"** no [roadmap Marco 4](11-roadmap.md). |
| SaaS B2B tradicional (Slack, Notion, Salesforce, etc.) com fatura mensal | Mesmo motivo — billing por cartão recorrente, fora do path do agente |
| Cloud providers (AWS, GCP, Azure) com cobrança por uso pós-pago | Mesmo motivo |
| Compras humanas (consumer checkout) | Aegis é M2M; checkout humano é caso de uso completamente diferente |
| Cobrança / factoring / split payments tradicionais | Aegis paga, não cobra. Aegis não é Stripe Connect |

**Caminho futuro para o caso LLM tradicional ("Aegis Proxy Mode" — Marco 4):**

Cliente aponta SDK do agente para `proxy.aegis.dev/anthropic/v1/messages` em vez de `api.anthropic.com`. Aegis estima custo da chamada (tokens × preço), aplica policy do agente, encaminha para Anthropic com API key gerenciada pela Aegis (sob contrato Aegis ↔ Anthropic), cobra cliente em USDC ou fiat depois. Cobre a lacuna entre "vendors HTTP 402" (do MVP) e "vendors legacy via cartão" (90% do mercado hoje). Adiciona ~6-12 meses de escopo (contratos com providers, compliance, billing maduro) — por isso fica em Marco 4, não MVP.

**Resumo para Camila e Marcos:** se o agente de vocês paga via **HTTP 402** ou via **pagamento on-chain direto** (vendor com endereço Stellar), Aegis cobre desde o MVP. Se paga via **cartão / API key tradicional** (OpenAI/Anthropic com billing painel), espera o Marco 4 ou usa Aegis em paralelo (cartão para LLM, Aegis para vendors decentralizados).

---

## 3. Persona

### Persona primária: **Camila, CTO de scale-up B2B (Série A/B)**

- **Empresa:** SaaS com 40-200 funcionários, time de eng com 10-30 pessoas.
- **Stack:** Microserviços modernos (TS/Go/Python), CI/CD maduro, Postgres + cloud (AWS/GCP).
- **Agentes em produção:** 3-15 agentes Claude/GPT fazendo: customer success automation, scraping competitivo, data enrichment, code review, ops triage.
- **Dor real:** "Meu agente de pricing intelligence consulta proxies residenciais decentralizados e marketplaces de dados que cobram via HTTP 402 em USDC. Mês passado um proxy malicioso ressubmeteu cobranças idênticas em loop e queimou $1.200 antes do meu time perceber. Eu queria policy que limitasse gasto por vendor, exigisse aprovação humana acima de X, e me desse trilha auditável que meu cliente enterprise aceite — coisa que Stripe não me dá porque Stripe não vê esses pagamentos cripto."
- **Decisão de compra:** Camila autoriza até $X/mês sem precisar do CEO. Se Aegis custa <0.5% do volume M2M que ela processa + dá governança que ela precisa para escalar agentes em produção sem medo, ela compra.
- **Critérios técnicos:** SDK TypeScript decente, latência <100ms para não atrapalhar UX do agente, observabilidade que ela possa plugar no Datadog/Grafana, audit log exportável para compliance.

### Persona secundária: **Marcos, Founder técnico de AI-native startup (Seed/Série A)**

- **Empresa:** AI startup com 5-25 pessoas; produto é o próprio agente (ex: vertical AI SDR, AI accountant, AI ops engineer).
- **Stack:** monolito moderno, agentes são o core do produto.
- **Agentes em produção:** ÚNICO produto. Cada cliente recebe um agente dedicado, ou um agente gerencia recursos do cliente.
- **Dor real:** "Meus clientes me pedem audit log para o agente que mexe no AWS deles. Hoje eu mando um JSON do meu DB; eles ficam desconfortáveis. Precisam de algo que não dependa só de mim."
- **Critérios técnicos:** Multi-tenancy nativo, white-label opcional, trilha cripto-verificável vira diferencial competitivo.

### Quem **NÃO** é persona (no MVP)

- Bancos tradicionais e fintechs reguladas — overhead regulatório alto, ciclo de venda longo.
- Indivíduos / consumer (agente pessoal de uma pessoa só) — TAM pequeno, willingness-to-pay baixa.
- Pagamentos B2C de alto volume / baixo valor — Aegis foca em pagamentos máquina↔máquina, não checkout humano.

---

## 4. Jobs-to-be-Done

Quando Camila/Marcos "contratam" Aegis Protocol, o que estão tentando realizar?

### JTBD-1: "Dormir tranquilo sabendo que meu agente não vai me falir"
- **Disparador:** medo de loop runaway, vendor malicioso, prompt injection que faz agente gastar absurdo.
- **Resultado esperado:** budget enforced no nível do gateway, alerta antes de ultrapassar, kill switch acionável.
- **Métrica de sucesso para o cliente:** zero incidentes de gasto fora do esperado em 6 meses.

### JTBD-2: "Conseguir explicar para meu board / cliente / auditor o que o agente fez"
- **Disparador:** compliance, segurança, devida diligência em rounds, contrato enterprise pedindo SOC2.
- **Resultado esperado:** trilha completa de quem gastou, quanto, em que, quando, por qual política.
- **Métrica de sucesso para o cliente:** auditoria externa concluída sem findings na área de gastos agentes de IA.

### JTBD-3: "Escalar o número de agentes em produção sem aumentar risco linearmente"
- **Disparador:** quer rodar 50 agentes onde hoje roda 5, mas cada agente adicional aumenta superfície de risco.
- **Resultado esperado:** políticas centralizadas, onboarding de novo agente em minutos, monitoria unificada.
- **Métrica de sucesso para o cliente:** time-to-deploy de novo agente <10 minutos.

### JTBD-4: "Pagar vendors internacionais sem complexidade fiat"
- **Disparador:** vendor é um anchor cripto, um modelo aberto rodando em provider P2P, um marketplace global de APIs.
- **Resultado esperado:** stablecoin como meio de pagamento universal, fiat ramp para alimentar a treasury.
- **Métrica de sucesso para o cliente:** zero conta bancária internacional adicional necessária.

---

## 5. Posicionamento competitivo

| Solução | Modo de operação | Forte | Fraco |
|---------|-----------------|-------|-------|
| **Stripe Issuing** | Cartão virtual via API | Maduro, aceitação universal | Taxa alta, settlement T+2, sem trilha cripto |
| **Mercury / Brex virtual cards** | Cartões corporativos | Bom para humanos | Sem controle granular agente, sem audit cripto |
| **Coinbase Commerce** | Aceitar cripto como vendor | Bom para receber | Não resolve governança de quem paga |
| **AgentKit, LangChain agents** | Framework de agente | Bom para construir | Não tem camada de pagamento opinada |
| **Custom in-house** | Cada um o seu | Total controle | Cada empresa reinventa, mal testado |
| **Aegis Protocol** | Gateway governado on-chain | Governança + audit + fiat ramp + zero fricção blockchain | É novo, precisa construir trust |

**Tagline competitiva (interna):** *"Stripe Issuing era para humanos. Aegis é para agentes — com audit que cliente seu pode verificar sem confiar em você."*

---

## 6. Métricas de sucesso do MVP

Marco 1 (MVP Testnet) é validado se:

| Categoria | Métrica | Target MVP |
|-----------|---------|------------|
| **Funcional** | Spend request end-to-end completa | 100% das requests válidas resultam em Payment USDC + evento Soroban |
| **Performance** | Latência decisão de política | p95 < 50ms, p99 < 100ms |
| **Performance** | Latência total request → tx submitted | p95 < 3s (limitado pelo Stellar) |
| **UX** | Time-to-onboard novo vendor (sponsored) | < 30 segundos, zero XLM no vendor |
| **UX** | Time-to-onboard nova Company | < 5 minutos (criar account, policy default, agente, depositar fiat via SEP-24) |
| **Adoção interna** | Demos com design partners | 3 demos completas com feedback positivo em 4 semanas após MVP |
| **Qualidade** | Cobertura de testes do policy engine | > 90% (engine é o coração crítico) |
| **Auditabilidade** | Eventos Soroban consultáveis | 100% das decisões → 1 evento on-chain consultável via RPC |

Marco 1 NÃO precisa validar (deixar para Marco 2-3):
- Kill switch via Clawback funcional (Stretch S1).
- Mainnet readiness, KMS, multi-anchor.
- Pricing model / billing.

---

## 7. Não-objetivos (o que Aegis explicitamente NÃO faz)

- ❌ **Não é wallet do agente** — agente não tem chave; Aegis tem.
- ❌ **Não é provedor de fiat ramp próprio** — usa anchors SEP-24 (Circle, Anclap, MoneyGram, etc.).
- ❌ **Não é AML/KYC platform** — delega ao anchor (eles são quem fazem KYC).
- ❌ **Não é orquestrador de agentes** — é a camada de pagamento; orquestração fica com LangChain/AgentKit/custom.
- ❌ **Não é multi-chain no MVP** — só Stellar. Adapter preparado para futuro (Solana, Base, etc.) mas não implementado.
- ❌ **Não é mercado de vendors / marketplace** — Aegis paga vendors que a Company cadastra; descoberta de vendor é problema do agente/Company.

---

## 8. Tese de longo prazo (1-3 anos)

Se o MVP validar, a tese é:

> **Aegis vira o "Stripe para agentes" — a infraestrutura padrão de pagamento governado para qualquer agente de IA que gasta dinheiro em produção.**

Camadas futuras possíveis (não-MVP):
- **Aegis Marketplace** — diretório de vendors prontos para pagamento de agentes de IA, com SLA garantido.
- **Aegis Insights** — analytics sobre comportamento de gasto de agentes, benchmark cross-customer (anonimizado).
- **Aegis Insurance** — apólice para reembolsar perda em caso de fraude/runaway (lastreado em audit on-chain).
- **Aegis Compliance** — relatórios prontos para SOC2, ISO 27001, requisitos de compliance regional.

Mas tudo isso é especulação. **O foco agora é o MVP do Marco 1.**
