/**
 * Rotas de auth humana (dashboard).
 *
 * - POST /v1/auth/login — verifica email + senha contra a tabela User.
 *
 * Endpoint PÚBLICO (não chama requireAgent). Usado pelo NextAuth do dashboard
 * como Credentials provider. Não emite token: o NextAuth gere a sessão própria;
 * aqui só validamos as credenciais e devolvemos o perfil do User.
 */

import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { UnauthorizedError } from '../lib/errors.js';
import { mintSessionToken } from '../lib/session-token.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const authRoute: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/v1/auth/login', async (request) => {
    const body = LoginBody.parse(request.body);

    const user = await app.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    // Mensagem genérica: não revela se o email existe.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('Invalid email or password');
    }
    const matches = await bcrypt.compare(body.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedError('Invalid email or password');
    }

    await app.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const company = await app.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true },
    });

    // Token de sessão assinado pela API — o web reencaminha em `Authorization`
    // nas chamadas seguintes (desacopla o dashboard das API keys de agente).
    const sessionToken = mintSessionToken({
      sub: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      companyName: company?.name ?? null,
      sessionToken,
    };
  });
};

export default authRoute;
