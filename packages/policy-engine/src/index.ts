/**
 * @aegis/policy-engine — função pura `evaluate(request, policy, context) → Decision`.
 *
 * Características críticas (ver docs/adr/0006-policy-engine-puro-sem-io.md):
 * - Sem I/O (sem await, sem rede, sem DB)
 * - Determinística (mesma entrada, mesma saída)
 * - Síncrona
 * - Sem mutação de input
 *
 * Implementação completa na iteração 2 do roadmap (docs/11-roadmap.md).
 */

export const POLICY_ENGINE_VERSION = '0.0.1';
