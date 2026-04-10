import type { FastifyInstance } from 'fastify';

export async function auditRoutes(app: FastifyInstance) {
  // GET /companies/:companyId/audit-logs
  app.get<{
    Params: { companyId: string };
    Querystring: { agentId?: string; eventType?: string; limit?: string; offset?: string };
  }>('/companies/:companyId/audit-logs', async (request, reply) => {
    const { companyId } = request.params;
    const { agentId, eventType, limit, offset } = request.query;

    const company = await app.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.notFound('Company not found');

    const logs = await app.prisma.auditLog.findMany({
      where: {
        companyId,
        ...(agentId ? { agentId } : {}),
        ...(eventType ? { eventType } : {}),
      },
      include: {
        agent: { select: { id: true, name: true, type: true } },
        spendRequest: { select: { id: true, vendor: true, amount: true, currency: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit ?? 100), 500),
      skip: Number(offset ?? 0),
    });

    return logs;
  });
}
