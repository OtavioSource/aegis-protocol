# Roteiro de Entrevista — Descoberta de Cliente (Hipótese LLM Inference)

> Roteiro adaptado para a **Hipótese 1 — LLM Inference**: CTOs de startups gastando $10k+/mês em OpenAI/Anthropic/Replicate sem governança por agente.

## Princípios

- Duração total: **15-20 minutos** (respeitar o tempo do entrevistado)
- **Não vender** — você está aqui para aprender, não para pitchar
- **Escutar 80% / falar 20%** — a melhor pergunta é "me conta mais"
- **Anotar histórias concretas**, não opiniões abstratas
- **Não dizer o que você está construindo** até o final (vicia respostas)

---

## Abertura (1 min)

> "Oi [nome], obrigado pelo tempo. Sou o Otávio, fundador do Aegis Protocol. Estou pesquisando sobre como empresas hoje gerenciam **gastos de APIs de IA** (OpenAI, Anthropic, Replicate, etc.) — em especial quem tem múltiplos agentes ou serviços consumindo essas APIs. Não estou aqui para vender nada — só quero entender como você lida com isso hoje. Posso te fazer algumas perguntas?"

---

## Bloco 1 — Contexto (3 min)

1. "Pode me contar rapidamente o que você faz na [empresa] e há quanto tempo está nessa função?"
2. "Sua empresa tem quantas pessoas? Em que fase está? (pre-seed / seed / Series A...)"
3. "Quantos agentes / scripts / serviços vocês têm hoje em produção que consomem APIs de IA?"
4. "Em ordem de grandeza, quanto vocês gastam por mês com isso? (não precisa de número exato — é $1k? $10k? $50k? $100k+?)"
5. "Você é o decisor final em ferramentas de IA, ou divide com alguém? (CFO, CTO, head de eng...)"

---

## Bloco 2 — Fluxo atual (7 min) — O CORAÇÃO DA ENTREVISTA

> Aqui você quer entender **o fluxo real**, do início ao fim. Não interromper. Só pedir clarificação.

1. "Me conta como funciona o controle de gastos de IA hoje, do início ao fim? Quem tem acesso à conta da OpenAI/Anthropic? Como vocês acompanham o gasto?"
2. "Quais ferramentas você usa para rastrear isso? Dashboard nativo da OpenAI? Planilha? Tooling interno?"
3. "Vocês conseguem saber quanto **cada agente / projeto / cliente** está gastando? Ou só o total?"
4. "Quanto tempo você ou seu time dedica a isso por mês?"
5. "Onde você mais perde tempo nesse fluxo? Onde está a maior dor?"
6. "Já aconteceu de a fatura vir muito acima do esperado? **Me conta a história específica.**" *(crítica — você quer a história, não a opinião)*
7. "Qual foi o impacto desse erro? Bloqueou algo? Gerou conversa difícil com CFO/board?"
8. "Vocês têm budget mensal definido para IA? O que acontece quando estoura?"

---

## Bloco 3 — Soluções tentadas (3 min)

9. "Já tentaram alguma solução para controlar isso melhor? (Helicone, LangSmith, Datadog AI, dashboards próprios?)"
10. "Por que não funcionou ou não foi suficiente?"
11. "O que faltou na solução?"

---

## Bloco 4 — Dor real e disposição a pagar (3 min)

> Cuidado: NÃO perguntar "quanto pagaria por X". Pergunta o **custo atual** do problema.

12. "Se você pudesse mudar **uma coisa** nesse processo, o que seria?"
13. "Quanto isso custa à sua empresa por mês hoje? Pensa em:
    - Custo em **tempo do time** (horas/mês × custo/hora)
    - Custo em **estouros não previstos** (faturas surpresa)
    - Custo em **risco** (algum agente já fez algo absurdo? quase fez?)"
14. "Vocês já têm budget alocado para resolver isso, ou sairia de algum lugar específico (TI, eng, ops)?"

---

## Bloco 5 — Network expansion (2 min)

15. "Conhece outros founders/CTOs com a mesma dor que eu deveria conversar? Especialmente quem tem agentes em produção." *(MUITO IMPORTANTE — multiplica suas entrevistas)*
16. "Posso te citar quando falar com essa pessoa? (ex: 'O [Nome] me indicou')"

---

## Fechamento (1 min)

> "Muito obrigado, [nome]. Foi muito útil. Estou construindo o Aegis Protocol — uma camada de governança para gastos de IA, com aprovação por agente, kill switch e auditoria. Posso te mandar uma demo daqui umas semanas para você dar feedback? Sem compromisso, sem venda."

**Se ele topar:** anotar como **lead quente** (potencial design partner).

---

## Pós-entrevista (5 min logo após)

Anotar imediatamente em [log.md](log.md):

- Nome, cargo, empresa, tamanho da empresa
- Volume de gasto mensal em IA (grosso modo)
- Número de agentes/serviços consumindo IA
- 3 frases que ele disse (transcrição literal das mais marcantes)
- A história de erro/estouro que ele contou
- Custo atual do problema (tempo, dinheiro, risco)
- Sinal verde / amarelo / vermelho
- Próximo contato (lead quente?)
- Pessoas que ele indicou

---

## ⚠️ Erros comuns a evitar

1. **Pitchar o produto cedo** — você não está aqui para vender (só no fechamento)
2. **Perguntar "você usaria isso?"** — todo mundo diz sim por educação
3. **Perguntar "quanto pagaria?"** — eles não sabem; pergunta o custo do problema
4. **Aceitar respostas abstratas** — "é difícil controlar" não é dado; peça a história específica do estouro
5. **Falar mais que ele** — sua boca é seu inimigo
6. **Liderar a resposta** — não fale "deve ser difícil rastrear por agente, né?"; pergunte aberto

---

## Sinais por nível de qualificação

### 🟢 Verde (lead quente, potencial design partner)
- Tem 5+ agentes ou serviços de IA em produção
- Gasta $5k+/mês em APIs de IA
- Já teve estouro de fatura concreto (conta a história específica)
- Reconhece que não consegue rastrear gasto por agente
- Topou call de demo / pediu para ser avisado

### 🟡 Amarelo (refinar persona)
- Tem alguns agentes mas gasta pouco ($<5k/mês)
- Reconhece a dor mas "não é prioridade agora"
- Já resolve "ok" com Helicone / dashboard interno
- Não topou demo mas ficou interessado

### 🔴 Vermelho (não é o ICP)
- Não usa IA em escala / é só ChatGPT manual
- Tem 1-2 agentes simples, sem complexidade
- Não tem budget próprio para IA
- Não viu valor no que descrevi

---

## Referência

Esse roteiro segue o método **Mom Test** (Rob Fitzpatrick) e é compatível com o framework **descoberta de cliente** (Steve Blank). Ambos são as referências mais usadas em customer development de startups early-stage.
