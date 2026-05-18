/**
 * Error handler global — formata respostas no padrão RFC 7807 Problem Details.
 *
 * Hierarquia de mapping:
 * 1. `ApiError` (nossas classes) → usa `toProblem()`.
 * 2. `ZodError` (validação Fastify-Zod) → 400 com `issues` no extras.
 * 3. Fastify default errors (ex: rate-limit) → mantém statusCode mas formata.
 * 4. Qualquer outra coisa → 500 "Internal server error" sem vazar stack.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { ApiError, InternalError, ValidationError } from '../lib/errors.js';

const errorHandlerPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.setErrorHandler((err, req, reply) => {
    const instance = req.url;

    // 1. ApiError — nossa hierarquia
    if (err instanceof ApiError) {
      req.log.warn({ err: { name: err.name, message: err.message } }, 'api error');
      return reply
        .code(err.statusCode)
        .header('content-type', 'application/problem+json')
        .send(err.toProblem(instance));
    }

    // 2. ZodError direto (alguns paths podem emitir antes de subir pra ApiError)
    if (err instanceof ZodError) {
      const wrapped = new ValidationError('Request validation failed', {
        issues: err.errors,
      });
      return reply
        .code(wrapped.statusCode)
        .header('content-type', 'application/problem+json')
        .send(wrapped.toProblem(instance));
    }

    // 3. Fastify built-in errors com statusCode definido (ex: rate-limit, 4xx genérico)
    const errAny = err as { statusCode?: number; name?: string; message?: string };
    const statusCode = errAny.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      req.log.warn({ err }, 'fastify 4xx');
      return reply
        .code(statusCode)
        .header('content-type', 'application/problem+json')
        .send({
          type: 'about:blank',
          title: errAny.name ?? 'Client error',
          status: statusCode,
          detail: errAny.message ?? 'Bad request',
          instance,
        });
    }

    // 4. Bug / 5xx desconhecido — log completo, response genérica
    req.log.error({ err }, 'unhandled exception');
    const internal = new InternalError('An unexpected error occurred. Please try again.');
    return reply
      .code(internal.statusCode)
      .header('content-type', 'application/problem+json')
      .send(internal.toProblem(instance));
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
