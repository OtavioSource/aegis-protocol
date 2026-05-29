/**
 * Observabilidade — métricas Prometheus + request-id no header.
 *
 * - Default Node.js metrics (mem, CPU, GC, event loop).
 * - `http_requests_total{method, route, status_code}` — Counter.
 * - `http_request_duration_seconds{method, route, status_code}` — Histogram.
 * - `x-request-id` no header de toda response (correlaciona com `req.log`).
 * - Endpoint `GET /metrics` (público — convenção Prometheus).
 *
 * `req.id` é configurado em `server.ts` via `genReqId` para respeitar um
 * `x-request-id` recebido do cliente (rastreio end-to-end).
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP recebidas',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latência das requisições HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

declare module 'fastify' {
  interface FastifyRequest {
    /** Timestamp (ms) do início do request — usado para calcular duração. */
    _startTime?: number;
  }
}

const observabilityPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req) => {
    req._startTime = Date.now();
  });

  app.addHook('onResponse', async (req, reply) => {
    // `routeOptions.url` é o pattern (`/v1/spend-requests/:id`), não o path real
    // — evita cardinalidade explodindo no Prometheus.
    const route = req.routeOptions?.url ?? req.url;
    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    const durationSec = (Date.now() - (req._startTime ?? Date.now())) / 1000;
    httpRequestDuration.observe(labels, durationSec);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    return payload;
  });

  app.get('/metrics', async (_req, reply) => {
    reply.type(registry.contentType);
    return await registry.metrics();
  });
};

export default fp(observabilityPlugin, { name: 'observability' });
