# ADR-0003 — Contrato Soroban global único com `companyId` como topic indexado

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D7

---

## Contexto

Aegis registra cada decisão (APPROVED, REQUIRES_APPROVAL, REJECTED, etc.) como evento on-chain via contrato Soroban `aegis_audit`. Isso dá ao cliente uma trilha cripto-verificável (e externa ao DB da Aegis) do que aconteceu.

Há duas arquiteturas possíveis:

1. **Um contrato por Company** — cada Company tem seu próprio contrato deployado. `Company.auditContractId` aponta para o endereço. Isolamento total.
2. **Um contrato global** — único contrato `aegis_audit` deployado para toda a infra. `companyId` entra como topic indexado nos eventos. Tenancy lógica via filtro de topic.

A descrição inicial do produto sugeria opção (1) ("um contrato deployado por Company"). Após análise de trade-offs, evoluímos para opção (2).

## Decisão

**Adotamos o contrato Soroban global único** com `companyId` como topic indexado.

Estrutura do evento:
- **Topics:** `["aegis", "decision", <companyId BytesN<16>>]`
- **Data:** struct `DecisionRecord` (definido em `docs/08-soroban-audit.md §3.2`)

Consulta por Company via Soroban RPC `getEvents` filtrando por topic — filtro nativo do protocolo, sem risco de mistura.

## Consequências

### Positivas
- **Custo de deploy: zero por Company.** Onboarding não precisa orchestrar deploy de contrato (que custa ~0.5 XLM e tempo de ledger).
- **Operação simples.** Upgrade do contrato (se necessário no futuro) afeta um único deploy.
- **Filtro de eventos é nativo e seguro** — Soroban RPC `getEvents` recebe topics como filtro indexado.
- **Auditoria externa** (auditor terceiro, ou Company validando) só precisa conhecer um único contractId.
- **Throughput agregado** mais previsível (todo evento Aegis passa pelo mesmo contrato).

### Negativas
- **Tenancy é lógica, não cripto.** Em teoria, bug na nossa app code poderia emitir evento com `companyId` errado. Mitigado por testes.
- Todos eventos são públicos por design — Company A "vê" que Company B existe (mas não os detalhes de outras companies, pois RPC filtra por topic).
- Eventos contêm `amountCents` e UUIDs de vendors/agents. Aceitamos esse trade-off (UUIDs não mapeiam para entidades reais sem o DB da Aegis).

### Mitigações
- Testes: garantir que `record_decision` sempre é chamado com `companyId` correto derivado do request context.
- Documentar claramente no termo de uso que eventos Aegis são públicos (eventos blockchain por natureza são).
- Para Marco 3+ enterprise: se cliente exigir isolamento on-chain, criar opção "dedicated contract" (deploy adicional sob demanda).

## Alternativas consideradas

- **Um contrato por Company (opção 1 original):** rejeitado por custo operacional (deploy automation, custódia de contractId por Company, complexidade de upgrades).
- **Sem contrato Soroban — só Memo na tx Stellar:** rejeitado por perder diferencial competitivo (audit cripto-verificável é parte da proposta de valor) e por não funcionar para decisões REJECTED (que não viram Payment, logo não têm tx Stellar).
- **Sem contrato, mas com índice off-chain assinado:** rejeitado — assinatura off-chain Aegis-controlada não dá garantia externa (cliente teria que confiar em nós, que é exatamente o que queremos evitar).

## Revisão

Reavaliar quando: (1) volume de eventos cross-Company causar throughput issue (improvável na escala MVP/Marco 2/3), (2) cliente enterprise pedir isolamento on-chain (oferecer como upgrade), (3) Soroban introduzir primitivos que mudem o trade-off.
