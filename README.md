<div align="center">

# ⚔️ Aegis Protocol

**Camada de governança econômica para agentes de IA que pagam autonomamente.**
Auditável on-chain. Fricção zero para quem usa.

[![Status](https://img.shields.io/badge/status-MVP%20em%20construção-orange?style=flat-square)]()
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-blueviolet?style=flat-square&logo=stellar)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)]()
[![Node](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)]()
[![Rust](https://img.shields.io/badge/Rust-Soroban-000000?style=flat-square&logo=rust)]()
[![License](https://img.shields.io/badge/licença-TBD-lightgrey?style=flat-square)]()

</div>

---

## Descrição do Projeto

Agentes de IA já estão pagando por coisas em produção — APIs de LLM, scrapers, ferramentas SaaS, microsserviços que cobram por chamada. O protocolo HTTP **402 ("Payment Required")** existe há anos na especificação HTTP, mas só agora — com o avanço dos agentes de IA e da infraestrutura blockchain — está se tornando viável como meio de pagamento real. Padrões emergentes como **MPP** (Stripe/Tempo) e **x402** (Coinbase) já estão padronizando esse fluxo.

O que **não existe** é uma camada de **governança e auditoria** entre o agente e o dinheiro.

Um agente com uma credencial pode gastar sem checagem de política por transação, sem teto de orçamento e sem ponto de aprovação humana. O **Aegis Protocol** resolve isso:

> **O Aegis não é mais um meio de pagamento. É a camada de governança que decide se um agente de IA pode gastar — antes do dinheiro se mover.**

O Aegis recebe pedidos de gasto via SDK/API, avalia contra políticas determinísticas em milissegundos, decide (`APPROVED`, `REQUIRES_APPROVAL` ou `REJECTED`), executa o pagamento on-chain na Stellar (USDC) quando aprovado — e emite um recibo imutável via contrato Soroban que qualquer pessoa pode verificar de forma independente.

---

## ✨ Funcionalidades

- **🧠 Policy Engine determinístico** — avaliação pura, sem I/O, em milissegundos. Suporta teto de orçamento, rate limit por agente, aprovação humana e rejeição automática, tudo configurável via JSON DSL.
- **💸 Pagamentos USDC on-chain** — executa pagamentos na Stellar Testnet/Mainnet quando aprovado. O agente **nunca** tem a chave; o Aegis custodia e assina.
- **📜 Auditoria verificável on-chain** — contrato Soroban global emite um evento imutável a cada decisão. Qualquer pessoa pode consultar e verificar de forma independente via Soroban RPC.
- **🪶 Fricção zero de blockchain** — via Sponsored Reserves (CAP-33) e Fee Bump (CAP-15) da Stellar. Vendors e empresas **nunca precisam ter XLM** nem entender de blockchain.
- **💵 Fiat on/off-ramp integrado** — via anchor Etherfuse (BRL/MXN com Pix/SPEI). A empresa deposita em moeda local e a treasury recebe USDC automaticamente.
- **🤖 Fluxo HTTP 402 nativo** — SDK TypeScript interpreta respostas 402 de vendors, monta a invoice e submete ao Aegis com idempotência garantida.
- **👤 Aprovação humana na fila** — pedidos de alto valor ou fora de política entram em fila de revisão manual no dashboard, sem bloquear o agente para outros pagamentos.
- **🖥️ Dashboard web para admins** — gestão de políticas, vendors, agentes, fila de aprovação, saldos de treasury e histórico de transações.

---

## 🧰 Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| 🌐 **API** | [Fastify 5](https://fastify.dev/) + TypeScript + Zod + Pino |
| 🖥️ **Web (Dashboard)** | [Next.js 14](https://nextjs.org/) + Tailwind CSS + NextAuth |
| 🗄️ **Banco de dados** | PostgreSQL 16 (local via Docker / Neon em produção) + Prisma ORM |
| ⚙️ **Policy Engine** | TypeScript puro — sem I/O, avaliação < 1ms |
| 📦 **SDK do Agente** | `@aegis/sdk` (TypeScript/ESM, publicável no npm) |
| ⛓️ **Blockchain** | [Stellar](https://stellar.org/) Testnet/Mainnet — USDC, DEX nativa, SEP-24 |
| 📜 **Smart Contract** | [Soroban](https://soroban.stellar.org/) (Rust) — contrato de auditoria imutável |
| 💱 **Fiat Ramp** | [Etherfuse](https://etherfuse.com/) Anchor — BRL/MXN via Pix/SPEI |
| 🔒 **Segurança** | `@fastify/helmet` + `@fastify/rate-limit` + API Keys + bcrypt |
| 📊 **Métricas** | `prom-client` (Prometheus-compatible) |
| 🏗️ **Monorepo** | [Turborepo](https://turbo.build/) + pnpm workspaces |
| 🧪 **Testes** | [Vitest](https://vitest.dev/) + `@vitest/coverage-v8` |
| 🐳 **Infraestrutura local** | Docker Compose (PostgreSQL) |
| 🚀 **Deploy** | [Vercel](https://vercel.com/) (web + api via Serverless Functions) |

---

## 🚀 Demonstração de Usabilidade

### Fluxo de um agente pagando via SDK

```
Agente ──► POST /v1/spend-requests ──► Policy Engine
              (SDK @aegis/sdk)              │
                                           ▼
                                    ┌─────────────┐
                                    │  APPROVED   │──► Stellar payment ──► txHash
                                    │ REQ_APPROVAL│──► Fila humana
                                    │  REJECTED   │──► 402 com motivo tipado
                                    └─────────────┘
                                           │
                                           ▼
                                   Soroban Audit Event
                                   (on-chain, imutável)
```

### Dashboard de administração

![Dashboard — visão geral da fila de aprovação](docs/assets/screenshot-dashboard-queue.png)
> **Sugestão de captura:** tela principal do dashboard mostrando a fila de aprovação humana com cards de pedidos pendentes, filtros por agente/vendor e botões de Aprovar/Rejeitar.

![Dashboard — histórico de transações](docs/assets/screenshot-dashboard-history.png)
> **Sugestão de captura:** tabela de histórico de SpendRequests com colunas de status (badge colorido), valor, vendor, hash da Stellar e link para o Stellar Expert.

### Agente em ação (terminal)

![Terminal — simple-agent demo](docs/assets/screenshot-simple-agent.png)
> **Sugestão de captura:** saída do `pnpm --filter simple-agent start` mostrando os três demos: pagamento simples aprovado com `txHash`, fluxo HTTP 402 e idempotência.

---

## 📦 Instalação e Configuração

### Pré-requisitos

| Ferramenta | Versão mínima | Para quê |
|---|---|---|
| [Node.js](https://nodejs.org/) | 22+ | Runtime da API e do web |
| [pnpm](https://pnpm.io/) | 10+ | Gerenciador de pacotes do monorepo |
| [Docker](https://www.docker.com/) | qualquer recente | PostgreSQL local |
| [Rust + soroban-cli](https://soroban.stellar.org/docs/getting-started/setup) | stable | Compilar e deployar o contrato Soroban |

### 1. Clone e instale as dependências

```bash
git clone https://github.com/seu-usuario/aegis-protocol.git
cd aegis-protocol
pnpm install
```

### 2. Suba o banco de dados local

```bash
docker compose up -d
```

### 3. Configure as variáveis de ambiente

```bash
cp apps/api/.env.example apps/api/.env.local
```

Edite `apps/api/.env.local` com seus valores:

```env
# Banco de dados
DATABASE_URL="postgresql://aegis:aegis_dev_password@localhost:5432/aegis"

# JWT / Auth
JWT_SECRET="mude-para-um-segredo-longo-e-aleatorio"

# Stellar
STELLAR_NETWORK="testnet"
STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"
STELLAR_SOROBAN_URL="https://soroban-testnet.stellar.org"
AEGIS_TREASURY_SECRET_KEY="sua-chave-secreta-stellar"
AEGIS_AUDIT_CONTRACT_ID="id-do-contrato-soroban-deployado"

# Etherfuse (opcional para fiat ramp)
ETHERFUSE_API_KEY="sua-chave-etherfuse"
```

### 4. Rode as migrations e o seed

```bash
# Aplicar migrations
pnpm --filter @aegis/api db:migrate

# Popular com dados de desenvolvimento (cria Company, Agent, Vendors de exemplo)
pnpm --filter @aegis/api db:seed
```

### 5. Inicie todos os serviços em modo desenvolvimento

```bash
pnpm dev
```

Isso inicia em paralelo via Turborepo:
- **API** → `http://localhost:4000`
- **Web** → `http://localhost:3000`

---

## ⚙️ Uso

### SDK TypeScript (`@aegis/sdk`)

O modo mais simples de integrar um agente ao Aegis:

```typescript
import { AegisClient, PolicyRejectedError, parseHttp402, payInvoice } from '@aegis/sdk';

const aegis = new AegisClient({
  apiKey: process.env.AEGIS_API_KEY,
  baseUrl: 'http://localhost:4000',
});

// Pagamento direto
const result = await aegis.pay({
  vendorId: 'uuid-do-vendor',
  amountCents: 500,          // US$ 5,00
  asset: 'USDC',
  actionType: 'api-call',
  reason: 'Chamada à API de análise de sentimento',
});

console.log(result.decision);  // 'APPROVED' | 'REQUIRES_APPROVAL' | 'REJECTED'
console.log(result.txHash);    // hash da transação Stellar quando APPROVED

// Fluxo HTTP 402 nativo
const vendorResponse = await fetch('https://vendor.example.com/analyze', { body: payload });

if (vendorResponse.status === 402) {
  const invoice = await parseHttp402(vendorResponse);
  const result = await payInvoice(aegis, invoice, {
    vendorId: 'uuid-do-vendor',
    actionType: 'api-call',
    reason: 'Pagamento automático via 402',
  });
}
```

### Tratamento de erros tipados

```typescript
import {
  PolicyRejectedError,
  RateLimitError,
  IdempotencyConflictError,
  UnauthorizedError,
} from '@aegis/sdk';

try {
  await aegis.pay({ ... }, { idempotencyKey: aegis.generateIdempotencyKey() });
} catch (err) {
  if (err instanceof PolicyRejectedError) {
    console.log(`Rejeitado pela regra: ${err.policyRuleViolated}`);
  } else if (err instanceof RateLimitError) {
    console.log(`Tente novamente em ${err.retryAfterSeconds}s`);
  }
}
```

### Endpoints REST principais

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/v1/spend-requests` | Cria e avalia um pedido de gasto |
| `GET` | `/v1/spend-requests` | Lista pedidos da Company (filtros: status, agentId, vendorId) |
| `GET` | `/v1/spend-requests/:id` | Detalhe de um pedido |
| `GET` | `/v1/audit` | Histórico de eventos de auditoria |
| `GET` | `/v1/vendors` | Lista vendors cadastrados |
| `GET` | `/v1/agents` | Lista agentes registrados |
| `GET` | `/healthz` | Health check da API |
| `GET` | `/metrics` | Métricas Prometheus |

Todos os endpoints autenticados requerem o header:
```
Authorization: Bearer <api-key>
```

### Exemplo de corpo de requisição

```json
POST /v1/spend-requests
Idempotency-Key: <uuid-v4>

{
  "vendorId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "amountCents": 1000,
  "asset": "USDC",
  "actionType": "api-call",
  "reason": "Transcrição de áudio via Whisper API",
  "metadata": {
    "jobId": "job-abc-123",
    "model": "whisper-large-v3"
  }
}
```

```json
{
  "id": "9f8e7d6c-...",
  "decision": "APPROVED",
  "status": "COMPLETED",
  "txHash": "abc123...",
  "stellarExpertUrl": "https://stellar.expert/explorer/testnet/tx/abc123...",
  "evaluatedAt": "2026-06-04T12:00:00Z"
}
```

---

## 🧪 Testes

```bash
# Rodar todos os testes do monorepo
pnpm test

# Testes de um pacote específico
pnpm --filter @aegis/policy-engine test

# Com relatório de cobertura
pnpm --filter @aegis/policy-engine test:coverage

# Modo watch (durante desenvolvimento)
pnpm --filter @aegis/sdk test:watch
```

Os testes do **Policy Engine** cobrem os cenários principais da DSL de políticas: tetos de orçamento, rate limits, aprovação humana e rejeição. Os testes do **SDK** cobrem parsing de invoices HTTP 402, tratamento de erros tipados e idempotência.

```bash
# Testes do vendor mock (integration-style)
pnpm --filter vendor-mock test
```

---

## 🏗️ Arquitetura

### Visão macro (C4 — Container)

```
┌──────────────────────────────────────────────────────────────┐
│                        Aegis Protocol                        │
│                                                              │
│  ┌───────────┐    ┌──────────────┐    ┌───────────────────┐ │
│  │ apps/web  │    │  apps/api    │    │ packages/         │ │
│  │ Next.js   │◄──►│  Fastify 5   │◄──►│ policy-engine     │ │
│  │ Dashboard │    │  REST API    │    │ stellar           │ │
│  └───────────┘    └──────┬───────┘    │ sdk               │ │
│                          │            │ shared            │ │
│                          │            └───────────────────┘ │
│                    ┌─────▼──────┐                           │
│                    │ PostgreSQL │                           │
│                    │ (Prisma)   │                           │
│                    └─────┬──────┘                           │
└──────────────────────────┼───────────────────────────────────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
    Stellar Network   Soroban Contract  Etherfuse Anchor
    (USDC payments)   (audit events)    (fiat ramp)
```

### Decisões técnicas chave

| Decisão | Escolha | Motivo |
|---|---|---|
| **Policy Engine** | TypeScript puro, sem I/O | Avaliação determinística em < 1ms, sem efeitos colaterais |
| **Blockchain** | Stellar + Soroban | Fees baixas (~0,00001 XLM), finalidade rápida (~5s), USDC nativo |
| **Custódia** | Aegis assina, agente nunca tem a chave | Separação de preocupações; kill switch via Clawback |
| **Onboarding** | Sponsored Reserves + Fee Bump | Vendor/Company nunca precisam de XLM |
| **Monorepo** | Turborepo + pnpm workspaces | Build cache incremental, pipeline paralela, pacotes internos tipados |
| **API** | Fastify 5 + Zod | Validação de schema em runtime + tipos TypeScript derivados automaticamente |
| **Banco** | PostgreSQL + Prisma | Migrations versionadas, type-safety end-to-end, fácil escalar para Neon |
| **Auditoria** | Soroban events indexados por `companyId` | Verificação independente sem confiar no Aegis |

### Estrutura do monorepo

```
aegis-protocol/
├── apps/
│   ├── api/          # Fastify REST API
│   └── web/          # Next.js 14 dashboard
├── packages/
│   ├── policy-engine # Motor de política determinístico
│   ├── sdk/          # SDK TypeScript para agentes
│   ├── stellar/      # Integração com Stellar/Soroban
│   └── shared/       # Tipos e schemas compartilhados (Zod)
├── contracts/
│   └── aegis-audit/  # Contrato Soroban (Rust)
├── examples/
│   ├── simple-agent/       # Agente mínimo com @aegis/sdk
│   ├── claude-agent-402/   # Agente Claude com fluxo HTTP 402
│   └── vendor-mock/        # Servidor vendor de exemplo
└── docs/             # Documentação técnica e ADRs
```

### Fluxo de decisão detalhado

```
Agent SDK
  │
  ▼
POST /v1/spend-requests (+ Idempotency-Key)
  │
  ├─► [1] Auth (API Key → Company + Agent)
  ├─► [2] Idempotency check (retorna cached se já existe)
  ├─► [3] Policy Engine evaluation (< 1ms, sem I/O)
  │         └─► APPROVED / REQUIRES_APPROVAL / REJECTED
  ├─► [4] Persist SpendRequest + AuditEvent (PostgreSQL)
  ├─► [5] Emit Soroban event (on-chain, se conectado)
  └─► [6] Execute Stellar payment (USDC, ~3-5s, se APPROVED)
            └─► txHash → resposta ao agente
```

---

## 🤝 Como Contribuir

Por enquanto este é um projeto em fase de fundação. Antes de propor qualquer mudança:

1. **Leia a documentação** — os ADRs em `docs/adr/` explicam o porquê de cada decisão arquitetural.
2. **Abra uma issue** descrevendo o problema ou melhoria antes de submeter um PR.
3. **Siga o processo:**

```bash
# Fork e clone
git checkout -b feature/minha-feature

# Desenvolva com testes
pnpm --filter <pacote> test:watch

# Verifique tipos em todo o monorepo
pnpm typecheck

# Formate o código
pnpm format

# Abra o PR com descrição clara do problema e da solução
```

4. **Convenções:**
   - Commits em português ou inglês (seja consistente no PR).
   - Funções e variáveis em inglês (convenção do código existente).
   - Nenhum `any` explícito sem comentário justificando.
   - Testes obrigatórios para o Policy Engine; recomendados para o SDK.

---

## 📄 Licença

A definir. Por enquanto este repositório é privado e todos os direitos são reservados.

---

## 📫 Contato e Suporte

| Canal | Link |
|---|---|
| 📧 **Email** | wrpaiva@gmail.com |
| 🐛 **Issues** | [github.com/seu-usuario/aegis-protocol/issues](https://github.com/seu-usuario/aegis-protocol/issues) |
| 📖 **Documentação** | [`docs/`](docs/) — arquitetura, ADRs, API contract, Policy DSL |

---

<details>
<summary>📋 Checklist de personalização</summary>

Use esta lista para adaptar o README ao estado atual e futuro do projeto:

**Identidade e links**
- [ ] Substituir `seu-usuario` pelo usuário/org real do GitHub em todos os links
- [ ] Atualizar o badge de licença quando a licença for definida
- [ ] Adicionar badge de CI/CD quando o pipeline estiver configurado (GitHub Actions)
- [ ] Adicionar badge de cobertura de testes quando o threshold estiver definido

**Imagens e demos**
- [ ] Capturar screenshot do dashboard (tela de fila de aprovação) e salvar em `docs/assets/screenshot-dashboard-queue.png`
- [ ] Capturar screenshot do histórico de transações e salvar em `docs/assets/screenshot-dashboard-history.png`
- [ ] Gravar GIF ou capturar screenshot do terminal com o `simple-agent` rodando e salvar em `docs/assets/screenshot-simple-agent.png`
- [ ] Considerar adicionar um GIF de onboarding rápido (< 30s do `pnpm dev` ao primeiro pagamento aprovado)

**Instalação**
- [ ] Criar `apps/api/.env.example` com todas as variáveis necessárias (sem valores reais)
- [ ] Documentar como obter `AEGIS_TREASURY_SECRET_KEY` para Stellar Testnet (Friendbot)
- [ ] Documentar o deploy do contrato Soroban e como obter o `AEGIS_AUDIT_CONTRACT_ID`

**Conteúdo técnico**
- [ ] Atualizar a tabela de endpoints REST quando novos endpoints forem adicionados
- [ ] Adicionar seção de exemplos de Policy DSL (JSON) quando estiver estável
- [ ] Criar link para documentação do SDK (`packages/sdk/README.md`) quando ela existir
- [ ] Atualizar status de "MVP em construção" para "Beta" ou "Stable" conforme avança

**Roadmap**
- [ ] Considerar adicionar seção "🗺️ Roadmap" com link para `docs/11-roadmap.md` e as fases: MVP → Hardening → Mainnet → Scale

</details>
