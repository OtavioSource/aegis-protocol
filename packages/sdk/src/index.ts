/**
 * @aegis/sdk — cliente TypeScript para agentes consumirem a Aegis API.
 *
 * API planejada (ver docs/07-api-contract.md §5):
 *   const aegis = new AegisClient({ apiKey: 'cr_...', baseUrl: '...' });
 *   const result = await aegis.pay({ vendorId, amountCents, asset, ... });
 *   const invoice = aegis.parseHttp402(response);
 *   await aegis.payInvoice(invoice, { idempotencyKey });
 *
 * Implementação completa na iteração 7 do roadmap.
 */

export const SDK_VERSION = '0.0.1';
