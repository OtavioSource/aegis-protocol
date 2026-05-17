/**
 * @file users.ts
 * @package apps/api
 *
 * ═══════════════════════════════════════════════════════════════
 *  USERS — ADMIN USER MANAGEMENT
 * ═══════════════════════════════════════════════════════════════
 *
 * Users are the human admins who manage Aegis Protocol via the dashboard.
 * They are completely separate from Agents (AI processes).
 *
 * Authentication flow:
 *   - Users are created via POST /companies/:companyId/users (by an existing admin)
 *   - Login is handled by NextAuth in the web app via POST /auth/login
 *   - The API validates credentials here and returns user info
 *
 * Password security:
 *   - Passwords are hashed with bcrypt (cost factor 12) before storage
 *   - The raw password is NEVER stored or logged
 *   - bcrypt is appropriate here (unlike API keys) because passwords are
 *     low-entropy user-chosen secrets
 *
 * Notification preferences:
 *   - notifyEmail: user receives email when a spend request needs approval
 *   - notifySms: reserved for Twilio SMS integration (future)
 *
 * Routes:
 *   POST /companies/:companyId/users     — create admin user
 *   GET  /companies/:companyId/users     — list company admins
 *   PATCH /users/:userId                 — update profile/preferences
 *   POST /auth/login                     — validate credentials (for NextAuth)
 */

import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { CreateUserSchema, UpdateUserSchema, LoginSchema } from '@aegis/shared';

export async function usersRoutes(app: FastifyInstance) {
  // ─── POST /companies/:companyId/users ─────────────────────────────────────
  // Create a new admin user for a company.
  // The first user should be created via seed (admin@acme.com / aegis).
  // Subsequent users are created by existing admins.
  app.post<{ Params: { companyId: string } }>(
    '/companies/:companyId/users',
    async (request, reply) => {
      const { companyId } = request.params;
      const body = CreateUserSchema.parse(request.body);

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      const existing = await app.prisma.user.findUnique({ where: { email: body.email } });
      if (existing) return reply.conflict(`Email '${body.email}' already in use`);

      // Hash with bcrypt cost factor 12 — enough for security, not too slow for UX
      const passwordHash = await bcrypt.hash(body.password, 12);

      const user = await app.prisma.user.create({
        data: {
          companyId,
          email: body.email,
          name: body.name ?? null,
          passwordHash,
          role: body.role,
          phone: body.phone ?? null,
          notifyEmail: body.notifyEmail,
          notifySms: body.notifySms,
        },
      });

      // Never return passwordHash in response
      const { passwordHash: _, ...safeUser } = user;
      return reply.status(201).send(safeUser);
    },
  );

  // ─── GET /companies/:companyId/users ──────────────────────────────────────
  app.get<{ Params: { companyId: string } }>(
    '/companies/:companyId/users',
    async (request, reply) => {
      const { companyId } = request.params;

      const company = await app.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) return reply.notFound('Company not found');

      const users = await app.prisma.user.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, companyId: true, email: true, name: true,
          role: true, phone: true, notifyEmail: true, notifySms: true,
          createdAt: true, updatedAt: true,
          // passwordHash is deliberately excluded
        },
      });
      return users;
    },
  );

  // ─── PATCH /users/:userId ─────────────────────────────────────────────────
  // Update user profile and notification preferences.
  // Password changes are a separate endpoint (not implemented in MVP).
  app.patch<{ Params: { userId: string } }>(
    '/users/:userId',
    async (request, reply) => {
      const { userId } = request.params;
      const body = UpdateUserSchema.parse(request.body);

      const user = await app.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.notFound('User not found');

      const updated = await app.prisma.user.update({
        where: { id: userId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.notifyEmail !== undefined ? { notifyEmail: body.notifyEmail } : {}),
          ...(body.notifySms !== undefined ? { notifySms: body.notifySms } : {}),
        },
        select: {
          id: true, companyId: true, email: true, name: true,
          role: true, phone: true, notifyEmail: true, notifySms: true,
          createdAt: true, updatedAt: true,
        },
      });
      return updated;
    },
  );

  // ─── POST /auth/login ──────────────────────────────────────────────────────
  // Validate credentials and return user info.
  // Called by NextAuth's CredentialsProvider in the web app.
  // Returns user data (no JWT here — NextAuth handles the session).
  app.post('/auth/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body);

    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.unauthorized('Invalid email or password');

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) return reply.unauthorized('Invalid email or password');

    // Return safe user info for NextAuth to build the session
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  });
}
