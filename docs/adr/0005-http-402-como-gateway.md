# ADR-0005 — Aegis como gateway de pagamento HTTP 402 (client-side)

**Status:** Accepted  
**Data:** 2026-05-17  
**Decisão correspondente:** D5

---

## Contexto

HTTP 402 ("Payment Required") é o status code originalmente reservado para pagamento. Está renascendo via propostas como **x402** (Coinbase), Cloudflare Workers Pay, e várias APIs B2B que cobram por unidade de uso (LLMs pay-per-token, scrapers pay-per-request, etc.).

O fluxo padrão HTTP 402 tem dois lados:
- **Servidor (vendor):** retorna 402 com cabeçalho/body indicando como pagar (endereço wallet, asset, amount, identifier).
- **Cliente:** paga conforme indicado e reapresenta a request com prova de pagamento (header `X-Payment-Proof`, JWT, signed receipt, etc.).

Aegis Protocol pode posicionar-se de várias formas:
1. **Cliente apenas** — Aegis paga em nome do agente quando este recebe 402 de vendor.
2. **Servidor apenas** — Aegis expõe endpoints que retornam 402 (ex: quando agente excede budget e precisa de approval).
3. **Ambos.**

## Decisão

**No MVP, Aegis é APENAS gateway client-side (pagador).**

Fluxo:
1. Agente faz request à API do vendor (ex: `GET https://api.scraperX.com/page?url=...`).
2. Vendor retorna **HTTP 402** com payload tipo:
   ```json
   { "amount": "0.05", "asset": "USDC", "to": "G_VENDOR_ADDR", "memo": "invoice-abc", "expires_at": "..." }
   ```
3. Agente (via SDK Aegis) chama `aegis.pay({ vendorId, amountCents, ... })`.
4. Aegis avalia política, executa Payment USDC.
5. Aegis devolve ao agente um receipt (`txHash`, `ledger`, etc.).
6. Agente reapresenta a request ao vendor com header `X-Payment-Proof: <txHash>` ou similar.
7. Vendor valida (consulta Horizon pelo hash) e libera o recurso.

**Aegis NÃO retorna 402 nos seus próprios endpoints.** Quando agente faz spend request que excede policy, Aegis retorna:
- `200` com `status: EXECUTED` (caso aprovado e executado).
- `202` com `status: REQUIRES_APPROVAL` (caso escalado).
- `422` com erro tipado (caso rejeitado).

Não usar 402 nessas respostas porque:
- 402 implica "pague e re-tente"; o que Aegis devolve é uma decisão de gateway, não um pedido de pagamento.
- Mistura conceitual: Aegis é quem PAGA, não quem cobra.

## Consequências

### Positivas
- **Posicionamento claro:** Aegis = "Stripe Issuing para agentes" (pagador), não "Stripe Connect" (recebedor).
- **Alinhado com tendência:** x402, Cloudflare e outros frameworks 402 estão construindo do lado do **vendor**; cabe a alguém ser o gateway client-side, e essa é a oportunidade Aegis.
- **SDK simples:** `aegis.pay()` e `aegis.parseHttp402(response)` são as duas únicas APIs principais.
- **Mantém flexibilidade:** se no futuro vendor adotar 402 com fluxo custom, SDK pode adicionar helper `payInvoice(invoice)`.

### Negativas
- **Não cobrimos casos de Aegis-como-vendor:** se alguém quisesse usar Aegis para receber pagamentos de outros (caso futuro), precisaria nova capability.
- **Dependemos de vendors padronizarem 402:** se ecossistema diverge (cada vendor com seu formato), SDK precisa parsers diferentes. Mitigamos com `aegis.payCustom({...})` para casos não-padrão.

### Helper SDK (proposta)
```ts
// Quando vendor retorna 402
const resp = await fetch(vendorUrl);
if (resp.status === 402) {
  const invoice = aegis.parseHttp402(resp); // tenta múltiplos formatos
  const proof = await aegis.payInvoice(invoice, { idempotencyKey: ... });
  const resp2 = await fetch(vendorUrl, {
    headers: { 'X-Payment-Proof': proof.txHash }
  });
}
```

## Alternativas consideradas

- **Aegis também como server (responde 402):** rejeitado para MVP. Adiciona escopo (UI para "pagar para usar Aegis"), confunde mensagem do produto, e não há demanda clara.
- **Não aderir a 402 — só endpoint REST genérico:** rejeitado. Aegis tem capability nativa de pagar invoices estruturadas; expor isso como helper SDK é diferencial. Não suportar 402 explicitamente seria perder a onda x402 emergindo.
- **Implementar x402 spec específica:** considerado, mas spec ainda está estabilizando. Implementar formato base (URI/JSON com amount+to+memo) e adicionar adapters por vendor conforme necessário.

## Revisão

Reavaliar quando:
- x402 ou outra spec se torna dominante — alinhar SDK ao spec.
- Demanda de design partners pelo lado server (Aegis cobra) emerge.
- Vendors importantes (Apify, Anthropic, etc.) adotam fluxos custom — atualizar parsers.
