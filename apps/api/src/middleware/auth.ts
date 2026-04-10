import { createHash } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export async function verifyAgentApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.unauthorized('Missing or invalid Authorization header');
  }

  const apiKey = authHeader.slice(7);
  const keyHash = hashApiKey(apiKey);

  const agent = await request.server.prisma.agent.findUnique({
    where: { apiKeyHash: keyHash },
    include: { company: true },
  });

  if (!agent) {
    return reply.unauthorized('Invalid API key');
  }

  // Attach agent context to request
  (request as FastifyRequest & { agentContext: typeof agent }).agentContext = agent;
}
