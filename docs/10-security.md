# 10 — Security & Threat Model

> Threat model resumido do Aegis Protocol no MVP testnet, com mitigações implementadas e limitações conhecidas. Plano de hardening para Mainnet.

---

## 1. Escopo deste documento

- **Cobre:** ameaças à integridade, confidencialidade e disponibilidade da API Aegis, da treasury Stellar, e dos dados das Companies.
- **Não cobre:** compliance regulatória (LGPD, GDPR, AML) — abordado separadamente quando aproximar de Mainnet.
- **Modelo:** STRIDE adaptado.

---

## 2. Ativos protegidos

| Ativo | Por quê é crítico |
|-------|-------------------|
| **Treasury secret key** | Acesso total ao saldo USDC + XLM da Aegis. Comprometimento = perda total no MVP (kill switch é stretch). |
| **API keys de Agents** (`cr_...`) | Permite fazer spend requests em nome do agente. Comprometimento = agente faz pagamentos não-autorizados (mas limitado pela policy). |
| **Sessions de Users** (NextAuth cookies) | Acesso ao dashboard, pode criar policies, aprovar spends, fazer withdraw. |
| **Policies** | Regras que controlam gasto. Manipulação = bypass de controles. |
| **Audit log** (DB + Soroban events) | Prova externa do que aconteceu. Manipulação compromete confiança no produto. |
| **Vendor secret keys** (modo AEGIS) | Acesso ao USDC dos vendors custodiados. |
| **DB completo** | Toda informação operacional. |

---

## 3. Atores e suas motivações

| Ator | Capabilities | Motivação possível |
|------|-------------|---------------------|
| **Agent comprometido** (prompt injection, código corrompido) | Pode emitir spend requests com qualquer payload via API key | Drenar budget do agente, pagar vendor malicioso |
| **Vendor malicioso** | Pode receber pagamentos, expor API com 402 falso | Receber pagamentos sem entregar serviço |
| **Usuário interno malicioso** (insider) | Acesso DB, secrets, infra | Roubo, sabotagem, evasão de auditoria |
| **Atacante externo** | Sem acesso prévio | Acesso inicial via vulns web, supply chain, credential leak |
| **Stellar/Soroban down** | N/A (não-ator) | — |
| **Anchor comprometido** | Recebe/envia fiat, pode reter ou falsificar deposits | Roubo de fundos em ramp |

---

## 4. Análise STRIDE

### 4.1 Spoofing
| Ameaça | Vetor | Mitigação MVP | Limitação |
|--------|-------|--------------|-----------|
| Agente falsifica `companyId` em request | API valida companyId do Bearer cr_ via DB lookup; não confia em campo do payload | Mitigado | OK |
| Atacante usa API key roubada | Rate limit por agentId; admin pode revogar key no dashboard | Mitigado parcialmente | API keys não rotacionam automaticamente; depende do admin |
| Phishing de admin → captura cookie | NextAuth com httpOnly + secure cookies; CSRF tokens nas mutations | Mitigado | Phishing humano não é resolvível 100% |
| Vendor finge ser outro vendor | Vendor.publicKey é único; payments só vão para `vendorWallet.publicKey` cadastrado | Mitigado | OK |
| Anchor finge ser test-anchor | SEP-10 valida assinatura do anchor via stellar.toml signing key | Mitigado | Confiança inicial no DNS/TLS do anchor |

### 4.2 Tampering
| Ameaça | Vetor | Mitigação MVP | Limitação |
|--------|-------|--------------|-----------|
| Modificar SpendRequest após decisão | DB row level: triggers proíbem `UPDATE` em campos imutáveis após status terminal | Parcial via aplicação | DB admin pode bypassar |
| Modificar Policy retroativamente | Policies versionadas + immutables; SpendRequest tem `policySnapshot` | Mitigado por design | OK |
| Modificar AuditEvent | DB-side: append-only via convenção; Soroban events são imutáveis on-chain | Mitigado parcial (DB) + total (Soroban) | DB admin pode mexer; Soroban dá prova externa |
| Replay de tx Stellar | Stellar protocol já garante (sequence numbers) | Mitigado | OK |
| Replay de spend request via API | Idempotency-Key + unique constraint `(company_id, idempotency_key)` | Mitigado | OK |

### 4.3 Repudiation
| Ameaça | Vetor | Mitigação MVP | Limitação |
|--------|-------|--------------|-----------|
| Company nega ter aprovado spend | Approval registra `userId`, IP, timestamp; AuditEvent persistido + Soroban event | Mitigado | OK |
| Aegis nega ter recebido request | Idempotency-Key retorna 200 com mesma response; logs por requestId | Mitigado | OK |
| Vendor nega ter recebido USDC | Stellar tx hash publicamente verificável | Mitigado | OK |

### 4.4 Information Disclosure
| Ameaça | Vetor | Mitigação MVP | Limitação |
|--------|-------|--------------|-----------|
| Vazamento de secret key da treasury | Env vars Railway (não em DB, não em logs, não em git) | Mitigado parcialmente | Hot wallet — comprometimento da infra Railway = perda. ADR-004 detalha plano Mainnet (KMS) |
| Vazamento de API keys de Agent | Armazenadas como hash (bcrypt/argon2); só prefix exposto em listagens | Mitigado | OK |
| Vazamento PII bancária | Aegis nunca toca PII bancária — fica no anchor (SEP-24 hosted flow) | Mitigado por design | OK |
| Tenant A vê dados de Tenant B | Prisma middleware aplica `where: { companyId }` automaticamente; testes específicos | Mitigado | Bug no middleware = vazamento; cobrir com fuzz tests |
| Audit events on-chain expõem `amountCents`, `vendorId` | Eventos Soroban são públicos por design | Trade-off aceito | UUIDs não vazam identidades reais; valores são abstratos sem mapping |
| Logs vazam dados sensíveis | Pino configurado com redactPath para `secretKey`, `apiKey`, `cookie`, `authorization` | Mitigado | Depende de aderência dev |

### 4.5 Denial of Service
| Ameaça | Vetor | Mitigação MVP | Limitação |
|--------|-------|--------------|-----------|
| Agente comprometido faz 10k req/s | Rate limit por agentId (10 req/s default, configurável) | Mitigado | OK |
| Burst de spend requests esgota Horizon | Queue de submit Stellar com worker dedicado; backpressure | Mitigado parcial | Volume MVP baixo; revisar em mainnet |
| DDoS na API pública | Railway/Cloudflare proxy (free tier) | Parcial | Não temos DDoS protection avançada no MVP |
| Anchor down | Fiat ramp degrada graciosamente; deposits ficam em FAILED com retry manual | Mitigado | UX impactada |
| Soroban RPC down | Event queue acumula; emite quando volta | Mitigado | Audit on-chain atrasa |
| Treasury sem XLM operacional | Alert quando XLM < 50; testnet refunda via Friendbot | Mitigado | Mainnet precisa procedimento |

### 4.6 Elevation of Privilege
| Ameaça | Vetor | Mitigação MVP | Limitação |
|--------|-------|--------------|-----------|
| User VIEWER tenta aprovar spend | RBAC: middleware valida `role IN ['OWNER', 'ADMIN']` | Mitigado | OK |
| Agent tenta acessar endpoint de admin | Bearer cr_ não dá acesso a `/companies/me/users`, `/policies`, etc. | Mitigado | Validação no middleware |
| Privilege escalation via SQL injection | Prisma elimina raw SQL exceto em casos auditados | Mitigado | OK |
| XSS no dashboard | Next.js auto-escapa; CSP header | Mitigado | OK |
| CSRF em mutations | NextAuth CSRF token nas mutations | Mitigado | OK |

---

## 5. Limitações conhecidas (riscos aceitos do MVP)

Estas são limitações **explícitas** do MVP, documentadas para alinhamento de expectativas.

### L1 — Treasury hot wallet
- **Limitação:** secret key em env var.
- **Impacto:** comprometimento da infra Railway = drenagem total da treasury USDC.
- **Por que aceitar no MVP:** testnet, baixo valor real, velocidade de iteração crítica.
- **Plano de mitigação:** Marco 2 = KMS (AWS KMS ou GCP Secret Manager). Marco 3 = multisig com signers humanos + Aegis API.

### L2 — Sem kill switch on-chain
- **Limitação:** se chave comprometida e atacante drena treasury, não há como reverter on-chain (USDC não é Aegis-issued).
- **Impacto:** perda total dos USDC operacionais até a detecção e off-ramp manual via anchor.
- **Por que aceitar:** kill switch via Clawback foi rebaixado a stretch S1 (ADR-0010); requer asset Aegis-issued separado.
- **Mitigação no MVP:** monitoria + alerts no balance USDC; rotation procedure documentada; saldo operacional sempre <$10k em testnet.

### L3 — Custódia de vendor keys (Modo AEGIS)
- **Limitação:** secret keys de vendors em modo AEGIS armazenadas no DB cifradas com chave única.
- **Impacto:** vazamento do DB + da `VENDOR_KEY_ENCRYPTION_KEY` = perda total dos saldos dos vendors custodiados.
- **Plano:** Marco 2 = chave por vendor via KMS, ou migrar vendors críticos para Modo SELF.

### L4 — Tenancy lógica, não cripto
- **Limitação:** treasury é singleton; isolamento por Company é via `companyId` no DB.
- **Impacto:** bug no middleware Prisma = vazamento cross-tenant.
- **Mitigação:** testes específicos de isolamento; reviewa periódica.
- **Plano:** Marco 3 — opção de Company com account/sub-account Stellar isolada para clientes enterprise.

### L5 — Sem DDoS protection avançada
- **Limitação:** apenas Railway built-in (capacity-based throttling).
- **Impacto:** disponibilidade pode degradar sob ataque coordenado.
- **Plano:** Marco 2 = Cloudflare em frente.

### L6 — Sem auditoria de código formal
- **Limitação:** sem auditoria de segurança externa do código.
- **Impacto:** vulns podem passar despercebidas.
- **Plano:** Marco 3 = auditoria por firma reputada antes de mainnet com valor real.

### L7 — Sem incident response plan formal
- **Limitação:** sem runbook de incidente (chave vazada, anchor comprometido, etc.).
- **Plano:** Marco 2 = redigir runbook com escalation paths.

---

## 6. Práticas de segurança no desenvolvimento

### 6.1 Secrets
- Nunca em código fonte. Nunca em git. Nunca em logs.
- `.env.example` documenta nomes das vars, valores são fakes (`G_REPLACE_ME`).
- Secrets reais em **Railway Secrets** (produção) e `.env.local` (gitignored, dev).
- CI usa secrets do GitHub Actions, nunca expostos no log.

### 6.2 Dependências
- Renovate ou Dependabot configurado para atualizar deps.
- `npm audit` no CI; falha o build em high/critical vulns.
- Lockfile commitado (`pnpm-lock.yaml`).

### 6.3 Code review
- Toda PR exige aprovação de outro dev (mesmo no MVP solo, futuro near).
- PRs mexendo em `apps/api/middleware/auth.ts` ou `packages/stellar/src/signing.ts` recebem escrutínio extra.

### 6.4 Testes de segurança
- Unit tests cobrem casos negativos (auth ausente, role insuficiente, etc.).
- Integration tests verificam isolamento multi-tenant.
- Fuzz testing de `evaluate()` (policy engine) com inputs randomizados.

### 6.5 Logging seguro
- `pino` com `redact: ['*.password', '*.secretKey', '*.apiKey', '*.authorization', '*.cookie']`.
- IDs sensíveis (apiKeyHash, secretKey) **nunca** logados, mesmo em error stacks.
- requestId propagado em todo log line.

### 6.6 Headers HTTP
- Helmet middleware no Fastify (CSP, HSTS, X-Frame-Options, etc.).
- CORS estrito (apenas origens conhecidas: dashboard URL).

---

## 7. Plano de hardening para Mainnet (Marco 2-3)

Lista de ações antes de processar valor real significativo.

### Prioridade alta (Marco 2)
- [ ] Migrar treasury secret para AWS KMS ou GCP Secret Manager.
- [ ] Implementar multisig na treasury (2-de-3 com signers humanos + API).
- [ ] Cloudflare em frente da API.
- [ ] Sentry/Datadog para error tracking + alerts críticos.
- [ ] Incident response runbook escrito e testado (game day).
- [ ] Rotação automática de API keys de agente (default 90 dias).
- [ ] 2FA obrigatório para Users com role OWNER/ADMIN.

### Prioridade média (Marco 3)
- [ ] Auditoria de segurança externa.
- [ ] SOC2 Type 1 readiness.
- [ ] Penetration test.
- [ ] Bug bounty program (HackerOne/Immunefi).
- [ ] Kill switch via Clawback (asset Aegis-issued; Stretch S1).
- [ ] Compliance: LGPD/GDPR DPA, termos de uso, política de privacidade.
- [ ] Backup automatizado de DB com retention 30 dias.
- [ ] Disaster recovery plan testado.

---

## 8. Resumo executivo

**O MVP é seguro para testnet com valores limitados.**
**O MVP NÃO é pronto para mainnet com valor real — falta hardening listado em §7.**

O design fundamental (engine pura, idempotência, audit dual on/off-chain, RBAC, isolamento por companyId) está correto. Os gaps são operacionais (KMS, multisig, IR, auditoria externa) — todos conhecidos e endereçados no roadmap.
