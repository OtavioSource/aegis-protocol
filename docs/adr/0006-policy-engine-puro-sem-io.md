# ADR-0006 — Policy Engine puro (função determinística sem I/O)

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** princípio P1 (`docs/02-architecture.md`)

---

## Contexto

O coração do Aegis é o **Policy Engine** — a lógica que decide se uma spend request é APPROVED, REQUIRES_APPROVAL ou REJECTED. Essa decisão precisa ser:

- **Latência ≤ 100ms p99** (RNF1 do PRD).
- **Determinística** — mesma entrada, mesma saída sempre.
- **Auditável** — Company precisa confiar e explicar a decisão.
- **Testável** — cobertura >90% requerida.

Há duas abordagens arquiteturais possíveis:

1. **Engine acoplada ao orchestrator** — engine consulta DB, chama serviços externos, computa contadores em runtime.
2. **Engine pura** — função sem I/O; orchestrator pré-carrega contexto (DB, runtime state) e passa como argumento.

## Decisão

**A Policy Engine é uma função pura, síncrona, sem nenhum I/O.**

Assinatura canônica:
```ts
function evaluate(
  request: SpendRequestInput,
  policy: Policy,
  context: RuntimeContext,
): Decision;
```

- Sem `await`.
- Sem chamadas a DB, Stellar, anchor, ou qualquer rede.
- Sem `Date.now()`, `Math.random()`, `process.env` dentro.
- Sem mutação de input.
- Sem throw — retorna discriminated union.

O orchestrator (em `apps/api`) é responsável por:
- Carregar `Policy` do DB.
- Calcular `RuntimeContext.monthlySpentCents` via SQL agregado.
- Passar como argumentos para `evaluate()`.

## Consequências

### Positivas
- **Latência mínima.** Sem I/O, engine roda em microssegundos (μs, não ms). Margem enorme sobre o RNF de 100ms.
- **Testabilidade total.** Cada caso é uma chamada de função; sem mocks, sem fixtures complexos.
- **Determinismo absoluto.** Mesma entrada = mesma saída. Reprodutível em qualquer ambiente.
- **Auditabilidade.** A decisão é função explícita de entradas observáveis. "Por que rejeitou?" responde-se lendo as entradas + olhando o código.
- **Composição.** Engine pode ser usada em batch (avaliar 1000 requests com policy hipotética) sem efeitos colaterais.
- **Sem race conditions.** Sem estado compartilhado, sem locks.

### Negativas
- **Boilerplate na borda.** Orchestrator precisa pré-carregar todo contexto necessário antes de invocar engine.
- **Mudança de regras = mudança em duas camadas.** Adicionar nova regra (ex: `dailyBudgetCents`) requer: (a) atualizar schema da Policy + Zod, (b) atualizar engine, (c) atualizar orchestrator para pré-carregar o dado.
- **Engine não enxerga "tudo".** Não pode tomar decisões baseadas em info que requer round-trip extra (ex: "checar se vendor está em uma blacklist global externa"). Para esses casos, orchestrator precisa pré-carregar.

### Mitigações
- Builder pattern no orchestrator (`new SpendRequestContext().withMonthlyUsage().withPolicy()...`) torna pré-carga organizada.
- Schema de `RuntimeContext` é centralizado em `@aegis/shared` e cresce conforme novas regras forem adicionadas — explícito, não implícito.

## Alternativas consideradas

- **Engine acoplada:** rejeitada por dificuldade de testes (precisa mockar DB), risco de latência variável, e acoplamento implícito que dificulta refactor.
- **Engine async com cache de leitura:** considerada, mas adiciona surface de race conditions (cache stale) sem ganho real (orchestrator já pré-carrega).
- **DSL programática (executar JavaScript dentro de sandbox):** rejeitada por surface de segurança (eval de código de cliente é problema) e por sacrificar determinismo se permitir I/O.

## Revisão

Reavaliar quando:
- Algum novo tipo de regra exigir consulta externa em tempo de avaliação que não pode ser pré-carregada (improvável).
- Latência ou performance precisar otimização específica.
- Volume cross-Company exigir paralelização cuidadosa (engine sendo pura já facilita).
