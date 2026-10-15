import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { ENVIRONMENT, type Environment } from '../../../config/environment';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/application/audit.service';
import { PasswordService } from './password.service';
import type { Actor } from '../domain/access-scope';
import type { Scope } from '../domain/permission-catalog';
const claimsSchema = z.object({
  sub: z.string().uuid(),
  organizationId: z.string().uuid(),
  familyId: z.string().uuid(),
  exp: z.number(),
  iat: z.number(),
});
export type RequestAudit = { requestId: string; ip?: string; userAgent?: string };
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const invalid = () =>
  new UnauthorizedException({
    code: 'SESSION_INVALID',
    message: 'Phiên đăng nhập không còn hiệu lực',
  });
export type RefreshResult =
  | {
      kind: 'ok';
      refreshToken: string;
      familyId: string;
      userId: string;
      organizationId: string;
      expiresAt: Date;
    }
  | { kind: 'invalid' | 'reused' | 'conflict' };
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENVIRONMENT) private readonly config: Environment,
  ) {}
  async now(tx: Prisma.TransactionClient) {
    return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  }
  async login(
    input: { organizationCode: string; email: string; password: string },
    context: RequestAudit,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { code: input.organizationCode.trim() },
    });
    const user = organization
      ? await this.prisma.user.findUnique({
          where: {
            organizationId_email: {
              organizationId: organization.id,
              email: input.email.trim().toLowerCase(),
            },
          },
        })
      : null;
    const valid = await this.passwords.verify(input.password, user?.passwordHash);
    if (!organization || !user || !valid || user.status !== 'ACTIVE') {
      if (organization)
        await this.prisma.$transaction((tx) =>
          this.audit.record(tx, {
            organizationId: organization.id,
            actorId: user?.id,
            action: 'auth.login_failed',
            entityType: 'user',
            ...context,
          }),
        );
      else
        new Logger('Security').warn({ event: 'auth.login_failed', requestId: context.requestId });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Thông tin đăng nhập không hợp lệ',
      });
    }
    const upgraded = this.passwords.needsRehash(user.passwordHash)
      ? await this.passwords.hash(input.password)
      : undefined;
    const refreshToken = randomBytes(32).toString('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organization.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash)
        throw invalid();
      const now = await this.now(tx);
      const expiresAt = new Date(now.getTime() + 7 * 86400000);
      if (upgraded)
        await tx.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
      const family = await tx.refreshFamily.create({
        data: { organizationId: organization.id, userId: user.id, expiresAt, createdAt: now },
      });
      await tx.refreshSession.create({
        data: {
          familyId: family.id,
          tokenHash: tokenHash(refreshToken),
          expiresAt,
          createdAt: now,
          ip: context.ip,
          userAgent: context.userAgent,
        },
      });
      await this.audit.record(tx, {
        organizationId: organization.id,
        actorId: user.id,
        action: 'auth.login',
        entityType: 'session',
        entityId: family.id,
        ...context,
      });
      return { familyId: family.id, expiresAt, userId: user.id, organizationId: organization.id };
    });
    return { ...result, refreshToken, accessToken: await this.accessToken(result) };
  }
  accessToken(session: { userId: string; organizationId: string; familyId: string }) {
    return this.jwt.signAsync(
      { sub: session.userId, organizationId: session.organizationId, familyId: session.familyId },
      {
        secret: this.config.JWT_SECRET,
        algorithm: 'HS256',
        issuer: 'nexuserp',
        audience: 'nexuserp-web',
        expiresIn: 900,
      },
    );
  }
  async actor(access: string | undefined): Promise<Actor> {
    if (!access) throw invalid();
    let claims: z.infer<typeof claimsSchema>;
    try {
      claims = claimsSchema.parse(
        await this.jwt.verifyAsync(access, {
          secret: this.config.JWT_SECRET,
          algorithms: ['HS256'],
          issuer: 'nexuserp',
          audience: 'nexuserp-web',
        }),
      );
    } catch {
      throw invalid();
    }
    const family = await this.prisma.refreshFamily.findFirst({
      where: {
        id: claims.familyId,
        organizationId: claims.organizationId,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            roles: {
              include: { role: { include: { permissions: { include: { permission: true } } } } },
            },
            branches: { include: { branch: true } },
          },
        },
      },
    });
    if (!family || family.user.status !== 'ACTIVE') throw invalid();
    const grants: Record<string, Scope[]> = {};
    for (const assignment of family.user.roles)
      for (const permission of assignment.role.permissions) {
        (grants[permission.permission.code] ??= []).push(permission.scope as Scope);
      }
    return {
      id: family.user.id,
      organizationId: claims.organizationId,
      familyId: family.id,
      email: family.user.email,
      displayName: family.user.displayName,
      mustChangePassword: family.user.mustChangePassword,
      roles: family.user.roles.map(({ role }) => ({
        id: role.id,
        code: role.code,
        name: role.name,
      })),
      grants,
      branchIds: family.user.branches
        .filter((access) => access.branch.status === 'ACTIVE')
        .map((access) => access.branchId),
    };
  }
  async refreshBinding(token: string | undefined) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    return this.prisma.refreshSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { family: { include: { user: true } } },
    });
  }
  async refresh(token: string | undefined, context: RequestAudit): Promise<RefreshResult> {
    const hint = await this.refreshBinding(token);
    if (!hint) return { kind: 'invalid' };
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refresh_families WHERE id=${hint.familyId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM refresh_sessions WHERE id=${hint.id}::uuid FOR UPDATE`;
      const session = await tx.refreshSession.findUniqueOrThrow({
        where: { id: hint.id },
        include: { family: { include: { user: true } }, successor: true },
      });
      const now = await this.now(tx);
      const family = session.family;
      if (
        family.revokedAt ||
        family.expiresAt <= now ||
        session.revokedAt ||
        session.expiresAt <= now ||
        family.user.status !== 'ACTIVE'
      )
        return { kind: 'invalid' };
      if (session.rotatedAt) {
        const elapsed = now.getTime() - session.rotatedAt.getTime();
        if (
          elapsed >= 0 &&
          elapsed < 5000 &&
          session.successor &&
          !session.successor.rotatedAt &&
          !session.successor.revokedAt
        )
          return { kind: 'conflict' };
        await tx.refreshFamily.update({ where: { id: family.id }, data: { revokedAt: now } });
        await this.audit.record(tx, {
          organizationId: family.organizationId,
          actorId: family.userId,
          action: 'auth.refresh_reuse',
          entityType: 'session',
          entityId: family.id,
          ...context,
        });
        return { kind: 'reused' };
      }
      const refreshToken = randomBytes(32).toString('hex');
      const successor = await tx.refreshSession.create({
        data: {
          familyId: family.id,
          tokenHash: tokenHash(refreshToken),
          expiresAt: family.expiresAt,
          createdAt: now,
          ip: context.ip,
          userAgent: context.userAgent,
        },
      });
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { rotatedAt: now, replacedBy: successor.id },
      });
      await this.audit.record(tx, {
        organizationId: family.organizationId,
        actorId: family.userId,
        action: 'auth.refresh',
        entityType: 'session',
        entityId: family.id,
        ...context,
      });
      return {
        kind: 'ok',
        refreshToken,
        familyId: family.id,
        userId: family.userId,
        organizationId: family.organizationId,
        expiresAt: family.expiresAt,
      };
    });
  }
  async logout(token: string | undefined, context: RequestAudit) {
    const hint = await this.refreshBinding(token);
    if (!hint) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refresh_families WHERE id=${hint.familyId}::uuid FOR UPDATE`;
      const family = await tx.refreshFamily.findUniqueOrThrow({ where: { id: hint.familyId } });
      if (family.revokedAt) return;
      await tx.refreshFamily.update({
        where: { id: family.id },
        data: { revokedAt: await this.now(tx) },
      });
      await this.audit.record(tx, {
        organizationId: family.organizationId,
        actorId: family.userId,
        action: 'auth.logout',
        entityType: 'session',
        entityId: family.id,
        ...context,
      });
    });
  }
  async changePassword(
    actor: Actor,
    input: { currentPassword: string; newPassword: string },
    context: RequestAudit,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await this.passwords.verify(input.currentPassword, user.passwordHash)))
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Thông tin đăng nhập không hợp lệ',
      });
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${actor.organizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (current.status !== 'ACTIVE' || current.passwordHash !== user.passwordHash)
        throw invalid();
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, mustChangePassword: false },
      });
      const families = await tx.refreshFamily.findMany({
        where: { userId: actor.id, revokedAt: null },
        orderBy: { id: 'asc' },
      });
      for (const family of families) {
        await tx.$queryRaw`SELECT id FROM refresh_families WHERE id=${family.id}::uuid FOR UPDATE`;
        await tx.refreshFamily.update({
          where: { id: family.id },
          data: { revokedAt: await this.now(tx) },
        });
      }
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: actor.id,
        ...context,
      });
    });
  }
}
