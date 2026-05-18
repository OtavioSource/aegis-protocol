/**
 * GET /v1/companies/me — informações da Company do Agent autenticado.
 *
 * Endpoint conveniente para o SDK descobrir defaults (defaultPolicyId, etc.)
 * sem precisar de dashboard.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { NotFoundError } from '../lib/errors.js';

const companiesRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/v1/companies/me', async (request) => {
    const agent = request.requireAgent();
    const company = await app.prisma.company.findUnique({
      where: { id: agent.companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        defaultPolicyId: true,
        monthlyBudgetCents: true,
        createdAt: true,
      },
    });
    if (!company) throw new NotFoundError(`Company ${agent.companyId} not found`);
    return company;
  });
};

export default companiesRoute;
