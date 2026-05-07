# Hipótese de Validação v1 — Aegis Protocol

> **Documento vivo.** Atualizar a cada bloco de 5 entrevistas. A V1 é a hipótese inicial; ao longo das entrevistas, se a V1 não se sustentar, criar V2 com pivot.

**Data de criação:** 2026-05-06
**Última atualização:** 2026-05-06
**Status:** hipótese inicial (em validação)

---

## A hipótese (template Stellar37)

> "Estamos construindo **[produto]** para **[persona]** que sofre com **[dor específica]**. Hoje ela resolve isso com **[alternativa atual]**, mas enfrenta **[fricção]**. Usamos Stellar para **[capacidade específica]**, começando com **[MVP mínimo]**."

### V1 atual (Hipótese 1 — LLM Inference)

**Produto:** Aegis Protocol — camada de governança financeira para gastos de IA por agente/projeto.

**Persona:** **CTO ou founder técnico de startup em fase seed/Series A (10-100 funcionários) que opera 5+ agentes/serviços de IA em produção e gasta entre $5k-$50k/mês em APIs de OpenAI, Anthropic, Replicate ou similar.**

**Dor específica:** Falta de controle granular de gastos por agente/projeto/cliente, com risco de estouros surpresa de fatura e ausência de auditoria por agente.

**Alternativa atual:** Dashboard nativo da OpenAI/Anthropic + planilha manual + revisão mensal pós-fatura. Em alguns casos, ferramentas como Helicone ou LangSmith para rastreamento (mas sem governança financeira).

**Fricção dessa alternativa:**
- Descoberta tardia de gastos descontrolados (depois da fatura chegar)
- Impossível atribuir gasto a cliente / projeto / centro de custo específico
- Sem aprovação humana antes de gastos altos
- Sem trilha de auditoria padronizada para compliance/contabilidade
- Tempo do time perdido em planilhas e investigação pós-fato

**Capacidade Stellar (a refinar):** Liquidação cross-border de invoices em múltiplas moedas (USDC/EURC/BRL) com governança automatizada e auditoria on-chain.

**Nota:** A capacidade Stellar mais óbvia (path payments cross-currency) pode não ser o gancho principal nessa vertical. A hipótese pode evoluir para "usamos Stellar como camada de execução auditável de pagamentos governados". A validação vai dizer.

**MVP mínimo:** Dashboard que conecta a 1 vendor (OpenAI), permite definir 3 agentes, limite por agente, aprovação acima de threshold, e log de gastos por agente em tempo real. Sem precisar de blockchain visível para o usuário no MVP.

### Em uma frase (versão final, depois de validada)

> [preencher quando hipótese estiver validada com 20+ entrevistas]

---

## A suposição mais arriscada

> A crença que, se for falsa, mata o produto.

**V1:** **CTOs de startups com $10k+/mês em IA estão dispostos a pagar (em $) por uma camada de governança financeira por agente — e não estão satisfeitos com Helicone, LangSmith ou dashboards nativos.**

**Por que isso é arriscado:**
- Talvez a dor exista mas não seja prioridade (sempre tem coisa mais urgente em startup)
- Talvez Helicone/LangSmith já resolvam suficientemente bem
- Talvez o problema seja resolvido por feature da própria OpenAI nos próximos 6 meses
- Talvez a granularidade "por agente" seja over-engineering para a fase atual desses clientes

**Como vou testar:**
- Em 20 entrevistas, esperar:
  - 12+ pessoas confirmarem que NÃO conseguem rastrear gasto por agente hoje
  - 8+ pessoas terem história específica de estouro de fatura
  - 5+ pessoas dizerem que tentaram Helicone/LangSmith e não foi suficiente
  - 3+ pessoas pedirem para ser design partner

**Critério de morte:**
- Se em 20 entrevistas, <5 reconhecerem a dor como prioritária → matar a hipótese
- Se 10+ disserem "Helicone resolve isso pra mim" → matar a hipótese (mercado capturado)
- Se 0 estiverem dispostos a pagar > $0 por mês → matar (não é dor pagável)

**Se matar a hipótese:** voltar às Hipóteses 2 (Payroll cross-border) ou 3 (AI agents em produção genérico) e reiniciar validação.

---

## As 10 perguntas obrigatórias do Stellar37 (responder com evidência)

> Preencher cada resposta com **dado de entrevista**, não opinião. Cite quem disse.

### 1. Quem exatamente sente essa dor?

**V1 (suposição):** CTO ou founder técnico de startup seed/Series A (10-100 pessoas) que opera 5+ agentes/serviços de IA em produção, gastando $5k-$50k/mês em APIs de IA.

**Após entrevistas:** [atualizar com persona refinada baseada em dados — pode mudar tamanho de empresa, faixa de gasto, role específico]

### 2. Como essa pessoa resolve hoje?

**V1:** Dashboard nativo OpenAI/Anthropic + planilha manual + alguns usam Helicone/LangSmith para rastreamento.

**Após entrevistas:** [evidência das entrevistas — listar ferramentas mencionadas, frequência]

### 3. Onde dinheiro entra?

**V1:** Investimento captado (seed/Series A) ou receita da própria startup.

**Após entrevistas:** [validar quem decide o budget para IA — CTO? CFO? Founder?]

### 4. Onde dinheiro sai?

**V1:** Para OpenAI, Anthropic, Replicate, Cohere, AWS Bedrock, Google Vertex AI, etc. Pago via cartão de crédito corporativo (geralmente).

**Após entrevistas:** [confirmar — cartão corporativo? invoice mensal? prepaid?]

### 5. Onde existe demora, custo, risco ou falta de acesso?

**V1:**
- **Demora:** descoberta de estouro só pós-fatura (1 mês de delay)
- **Custo:** estouros não previstos podem ser 2-5x do esperado
- **Risco:** agente runaway pode gastar $10k+ em horas
- **Falta de acesso:** time financeiro não consegue auditar gasto por projeto

**Após entrevistas:** [priorizar qual desses é o mais sentido na prática]

### 6. O que Stellar melhora nesse fluxo?

**V1 (a validar):** Stellar como camada de execução com auditoria on-chain imutável, possibilidade futura de liquidação cross-border (se cliente tem ops global).

**Após entrevistas:** [reavaliar — talvez o cliente nem ligue para "blockchain" e o valor seja só governança/dashboard/aprovação. Stellar pode virar "infraestrutura invisível" ao invés de feature]

### 7. Qual é o menor produto possível para testar nesta semana?

**V1:**
- Dashboard web simples (Next.js já existente)
- Conecta API OpenAI via API key do cliente
- Permite criar "agentes lógicos" (tags) e atribuir custo de cada chamada
- Alerta por email quando agente estoura limite mensal
- **Não precisa de blockchain visível no MVP** — Stellar entra como infra futura

**Após entrevistas:** [refinar baseado no que usuários pediram especificamente]

### 8. Quem será o primeiro usuário entrevistado?

**V1 (lista inicial — preencher com nomes reais):**
- [ ] [Nome 1] — CTO da [empresa] — abordar via [canal]
- [ ] [Nome 2] — Founder de [startup IA] — indicação de [Amigo X]
- [ ] [Nome 3] — Head of Eng — viu post no LinkedIn sobre custo OpenAI
- [ ] [Nome 4] — [...]
- [ ] [Nome 5] — [...]

**Status:** preencher com 30 leads na primeira semana.

### 9. Qual post FLG pode ser publicado com autenticidade?

**V1:** Versão LinkedIn do [post-001.md](../flg/post-001.md) — começa com a história real "$8k em vez de $2k", honesto sobre estar conversando com primeiros 10 founders.

**Após publicado:** [adicionar link + métricas reais — DMs, comentários, calls]

### 10. Qual evidência provaria que a ideia merece continuar?

**V1 (critérios objetivos para após Semana 3):**
- 12+ entrevistas confirmando a dor com história concreta de estouro
- 5+ pessoas pedindo acesso à demo
- 1+ design partner que toparia testar MVP em produção (mesmo que de graça)
- Padrão de persona convergiu (mesmo cargo / tamanho de empresa repetiu em 60%+ das entrevistas)

**Após entrevistas:** [resultado real]

---

## Os 12 padrões dos cases vencedores — score atual

| # | Padrão | Status V1 | Status atualizado |
|---|--------|-----------|-------------------|
| 1 | Dor real e frequente | ⚠️ A validar — assumida real, validar frequência | [atualizar] |
| 2 | Usuário muito bem definido | ⚠️ Definido em V1, validar nas entrevistas | [atualizar] |
| 3 | Proposta de valor clara | ⚠️ Clara para nós, validar se cliente entende | [atualizar] |
| 4 | UX simples | ⚠️ MVP planejado simples, ainda não construído | [atualizar] |
| 5 | Blockchain invisível | ✅ Por design — cliente não vê Stellar | ✅ |
| 6 | Integração com sistemas existentes | ⚠️ Plano: integrar com OpenAI API direta | [atualizar] |
| 7 | Liquidez e rampas | ❓ Pode não ser relevante nessa hipótese | [atualizar] |
| 8 | Distribuição (FLG) | ❌ Iniciando — Post #1 esta semana | [atualizar] |
| 9 | Confiança | ❌ Sem track record, sem clientes | [atualizar] |
| 10 | Compliance | ⚠️ Audit trail vai gerar valor para compliance | [atualizar] |
| 11 | Modelo de receita claro | ⚠️ SaaS tier $49-499/mês, validar disposição | [atualizar] |
| 12 | Primeiro caso pequeno | ✅ Definido — MVP com 1 vendor (OpenAI) + 3 agentes | ✅ |

**Meta:** após 3 semanas, ter pelo menos **6 verdes**, **4 amarelos**, **2 vermelhos**.

---

## Cronograma de validação

### Semana 1 (06/05 - 12/05)
- [x] Hipótese V1 escrita (este documento)
- [ ] Lista de 30 leads (LinkedIn, X, Discord, indicações)
- [ ] DM template enviado para 30 pessoas
- [ ] Post #1 publicado em LinkedIn + X
- [ ] Pelo menos 5 entrevistas agendadas

### Semana 2 (13/05 - 19/05)
- [ ] 10 entrevistas realizadas e logadas
- [ ] Padrões iniciais identificados
- [ ] Hipótese V1 refinada → V1.1 (ou pivot para V2 se sinais vermelhos)
- [ ] Posts #2 e #3 publicados (insight de entrevista, behind-the-scenes)

### Semana 3 (20/05 - 26/05)
- [ ] 10 entrevistas adicionais (total: 20)
- [ ] Hipótese final consolidada
- [ ] Pelo menos 1 design partner identificado (alguém que topou testar MVP)
- [ ] ONE-PAGER.md atualizado com positioning validado
- [ ] Decisão estratégica: continuar / refinar / pivotar

---

## Critérios de decisão (após Semana 3)

### 🟢 Hipótese validada — seguir construindo
- 12+ entrevistas confirmaram a dor com história concreta
- 5+ pessoas pediram acesso à demo
- 1+ design partner topou testar
- Padrão de persona convergiu

**Próximo passo:** focar features do MVP nas dores específicas que apareceram. Construir o dashboard simplificado, sem mexer no Solana/Stellar ainda. Validar com design partner em uso real antes de mexer em on-chain.

### 🟡 Hipótese parcialmente validada — refinar
- 6-11 entrevistas confirmaram a dor
- 2-4 pediram acesso
- Persona ainda confusa (varia de tamanho/role)

**Próximo passo:** pivot suave — mesma vertical (IA), persona mais específica (ex: focar só em Series A, ou só em wrappers de IA, ou só em empresas com 5+ agentes documentados).

### 🔴 Hipótese não validada — pivotar para Hipótese 2 ou 3
- <6 entrevistas confirmaram a dor
- Ninguém pediu acesso
- Persona não converge / dor reconhecida mas não pagável

**Próximo passo:**
- Voltar ao plano e escolher Hipótese 2 (Payroll cross-border) ou Hipótese 3 (AI agents)
- Não desistir do Aegis — desistir dessa formulação dele
- Começar nova hypothesis-v2.md com a próxima vertical

---

## Histórico de versões

- **v1** (2026-05-06): hipótese inicial — LLM Inference (CTOs gastando muito em OpenAI/Anthropic sem governança por agente). Baseada em análise das aulas Stellar37 + framework de Carlos Alberto da NearX. Decisão estratégica de focar nessa vertical: mercado mais imediato, dor mais aguda hoje, fluxo financeiro existe, mais fácil de validar em 3 semanas.

---

## Recursos de referência

- [Roteiro de entrevista](../interviews/script.md) — adaptado para LLM Inference
- [Templates de DM](../interviews/dm-template.md) — adaptado para LLM Inference
- [Log de entrevistas](../interviews/log.md) — atualizar a cada conversa
- [Post #1 do FLG](../flg/post-001.md) — versão LinkedIn + X/Twitter
- [Log de posts FLG](../flg/log.md) — métricas de sinal
