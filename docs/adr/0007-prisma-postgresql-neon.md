# ADR-0007 — Prisma + PostgreSQL hospedado no Neon

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** parte de D8

---

## Contexto

Aegis precisa de persistência para o domínio off-chain (Company, Agent, Policy, SpendRequest, Approval, Vendor, VendorWallet, AuditEvent, FiatDeposit, FiatWithdrawal, TreasuryAccount). Características requeridas:

- **Relacional.** Domínio tem relacionamentos claros (Company → Agents → SpendRequests).
- **Transacional.** Múltiplas tabelas atualizadas atomicamente (criar SpendRequest + reservar idempotency key).
- **Migrações versionadas.** Schema evolui ao longo dos marcos.
- **Type-safe.** Reduz bugs de cast/mismatch.
- **Multi-tenant via filtro lógico** (companyId).

Opções avaliadas:

| Stack | Prós | Contras |
|-------|------|---------|
| **Prisma + PostgreSQL (Neon)** | Schema-first, types autogerados, migration tooling, ORM maduro, Neon free tier serverless | Code-gen step, Prisma client é "fat" (~2MB) |
| Drizzle + PostgreSQL | Mais leve, SQL builder, sem code-gen | Type-safety menos forte, comunidade menor |
| Knex + PostgreSQL | Battle-tested | Sem type-safety nativa, mais boilerplate |
| Kysely | Type-safe query builder | Curva, comunidade menor |
| TypeORM | Maduro | Active record antiquado, decorators pesados |
| Raw pg | Total controle | Boilerplate massivo, sem migrations |

## Decisão

**Adotamos Prisma como ORM e PostgreSQL hospedado no Neon.**

Razões:
1. **Velocidade de iteração:** Prisma é o stack mais produtivo para este shape de projeto (modelos claros, queries usuais).
2. **Type-safety:** schema declarativo (`schema.prisma`) gera types TS — eliminação de mismatches no boundary.
3. **Migrations:** `prisma migrate dev` cria migrations versionadas, `prisma migrate deploy` aplica em produção.
4. **Neon:** PostgreSQL serverless com free tier generoso, branching por preview environment, escalável sob demanda. Sem custo no MVP.
5. **Multi-tenancy:** middleware Prisma aplica filtro `where: { companyId }` automaticamente em todas as queries (ver D9 / RNF6 no PRD).
6. **Comunidade e docs:** Prisma tem documentação superior; onboarding de novo dev rápido.

## Consequências

### Positivas
- Schema único, versionado em git: `prisma/schema.prisma`.
- Migrations geradas automaticamente do diff do schema.
- Types compartilhados entre `apps/api`, `apps/web` (server components), e (com cuidado) `@aegis/shared`.
- Neon serverless escala automaticamente para zero quando sem uso (custo mínimo).
- Preview environments em CI usam branches de DB (cada PR tem seu DB).

### Negativas
- **Prisma client é grande** (~2MB bundle), impacta cold start de funções serverless. Mitigado: API roda em container Railway (sem cold start frio).
- **Code-gen step** (`prisma generate`) precisa rodar antes de TS compile — adicionar ao prebuild.
- **Vendor lock-in ao schema Prisma.** Migrar para Drizzle/Knex no futuro = re-escrever schema. Aceitável pelo ganho de produtividade.
- **Neon free tier limits** (storage, compute hours). Suficiente para MVP; revisar em Marco 3.

### Mitigações
- Documentar migrations em CHANGELOG ou commit-message conforme adicionar.
- Backup automatizado: Neon point-in-time recovery (built-in) + dump diário para S3 em Marco 2.
- Monitoria de conexões: connection pool com pgbouncer (Neon oferece nativo).

## Padrões de uso adotados

### Schema
- IDs sempre UUID (`@default(uuid()) @db.Uuid`).
- Timestamps `@default(now()) @updatedAt`.
- Soft delete via `deletedAt` (não cascading delete em entities críticas).
- Indexes em FKs e em campos de filtro frequentes (`companyId`, `status`, `createdAt`).

### Multi-tenancy middleware
```ts
prisma.$use(async (params, next) => {
  if (TENANT_MODELS.includes(params.model)) {
    if (params.action === 'findMany' || params.action === 'findFirst') {
      params.args.where = { ...params.args.where, companyId: ctx.companyId };
    }
    // ... (também para create, update, delete)
  }
  return next(params);
});
```

### Migrations no CI/CD
- Dev: `pnpm prisma migrate dev`.
- Preview/staging: `pnpm prisma migrate deploy` automático no deploy.
- Produção: `prisma migrate deploy` em job separado, com aprovação humana.

## Alternativas consideradas

- **Drizzle:** segunda opção forte. Mais leve, SQL-first. Pode ser reavaliado se Prisma se tornar limitante.
- **Self-hosted PostgreSQL:** rejeitado — overhead operacional desnecessário no MVP.
- **Supabase:** considerado (PostgreSQL + auth + storage). Rejeitado porque já temos NextAuth e não precisamos do realtime/storage de Supabase. Neon é mais minimalista.

## Revisão

Reavaliar quando:
- Free tier do Neon esgotar (Marco 3 provavelmente).
- Performance de query crítica (improvável com Prisma + bom indexing).
- Time crescer e Drizzle/Kysely fizer mais sentido para skills do time.
