# ADR-0008 — Monorepo com Turborepo + pnpm workspaces

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D9

---

## Contexto

Aegis Protocol tem múltiplos deliverables que compartilham código:

- `apps/api` (Fastify backend)
- `apps/web` (Next.js dashboard)
- `packages/shared` (types, Zod schemas, enums, interfaces)
- `packages/policy-engine` (engine pura)
- `packages/sdk` (`@aegis/sdk` para agentes)
- `packages/stellar` (`@aegis/stellar` — implementação Stellar + SEP-24 + sponsoring)
- `contracts/aegis-audit` (Soroban Rust)

Há duas escolhas arquiteturais:

1. **Monorepo:** todos os deliverables em um único repositório git.
2. **Polyrepo:** cada deliverable em seu próprio repositório, publicando packages no npm para consumo cruzado.

Existe percepção (compreensível mas datada) de que "monorepo é amador / desorganizado". A realidade da indústria moderna é diferente: empresas como **Vercel, Linear, Cal.com, Resend, Supabase, Tipnt** todas usam monorepos (Turborepo, Nx, Bazel, Rush). O motivo é prático, não ideológico.

## Decisão

**Adotamos monorepo gerenciado com Turborepo + pnpm workspaces.**

Estrutura:
```
aegis-protocol/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── shared/
│   ├── policy-engine/
│   ├── sdk/
│   └── stellar/
├── contracts/
│   └── aegis-audit/        # Cargo workspace (não pnpm)
├── prisma/
├── docs/
├── package.json            # root
├── pnpm-workspace.yaml
└── turbo.json
```

Ferramentas:
- **pnpm:** gestor de packages; workspaces nativos; instala uma vez, link cruzado entre packages.
- **Turborepo:** orquestra `build`, `test`, `lint`, `dev` com cache local + remoto (Vercel) opcional.
- **TypeScript references:** packages estendem `tsconfig.json` base; project references para builds incrementais.
- **Cargo workspace:** dentro de `contracts/`, gerencia os contratos Rust independente de pnpm.

## Consequências

### Positivas
- **Compartilhamento de tipos atomic.** Mudar campo em `@aegis/shared/types.ts` afeta `apps/api`, `apps/web`, `@aegis/sdk` no mesmo PR — TypeScript reclama imediatamente onde precisa adaptar.
- **Refactoring atomic.** Renomear função ou campo em todo o codebase com 1 commit, sem coordenação de releases entre repos.
- **Velocidade de iteração.** Sem fricção de "atualizar dep cruzada → bump version → publicar npm → atualizar consumidor". Tudo já está linked.
- **Build cache.** Turborepo evita rebuilds desnecessários (mudou só `apps/web`? não rebuilda `packages/stellar`).
- **CI unificado.** Um GitHub Actions workflow constrói tudo, com matrix por package.
- **Onboarding.** Novo dev clona um repo e tem tudo. Sem caça às pastas espalhadas.

### Negativas
- **Repo cresce com o tempo.** Mitigado: pnpm não duplica `node_modules`; Turborepo cacheia builds.
- **Deploys precisam saber qual app mudou.** Vercel/Railway suportam path filters nativos para Turborepo.
- **Permissões granulares no git** (se time crescer e quiser limitar quem pode tocar em `contracts/`) — possível via CODEOWNERS.
- **Tooling cross-language** (TS + Rust) — Turborepo orquestra `pnpm`, mas para Rust usamos `cargo` direto (turbo pode chamar comandos cargo via task).

### Mitigações
- CODEOWNERS define ownership por path conforme time crescer.
- Documentação clara da estrutura no README.
- CI roda apenas o que mudou: `turbo run build --filter=...`.
- Branch protection rules + obrigatoriedade de code review nos paths sensíveis (auth, custódia, contracts).

## Quando migrar para polyrepo (não é o caso agora, mas anotando)

- Time atingir 30+ devs com squads independentes (cada squad dono de 1 deliverable).
- Algum package se tornar produto independente com ciclo de release próprio (ex: `@aegis/sdk` virar OSS standalone com governance própria).
- Tecnologia muito divergente que torne tooling unificado um problema (ex: contratos em várias linguagens incompatíveis).

Não é a realidade do Aegis Protocol nos próximos 12-24 meses.

## Alternativas consideradas

- **Polyrepo:** rejeitado porque o ganho (ownership e ciclos independentes) não compensa a fricção massiva (publicação npm, coordenação de versões, refactoring duplicado).
- **Monorepo com Nx:** alternativa válida. Nx tem mais features (gerador de código, plugin system). Turborepo é mais minimalista, alinhado com a stack moderna (Vercel/Next.js). Escolhido por simplicidade.
- **Monorepo com Bazel:** rejeitado — overkill para o tamanho do projeto, curva massiva.
- **Lerna:** descontinuado para nosso caso de uso; Turborepo é o sucessor de fato no ecossistema TS.

## Revisão

Reavaliar quando:
- Time atinge 20+ devs com ownership claramente separado.
- CI builds começam a passar de 30min consistentemente (cache não está ajudando).
- Algum package vira produto independente com seu próprio roadmap público.
