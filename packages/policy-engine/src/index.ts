/**
 * @aegis/policy-engine — função pura `evaluate(request, policy, context) → Decision`.
 *
 * Ver `docs/adr/0006-policy-engine-puro-sem-io.md` para princípios de design e
 * `docs/09-policy-dsl.md` para o DSL declarativo das policies.
 */

export { evaluate } from './evaluate.js';
export const POLICY_ENGINE_VERSION = '0.0.1';
