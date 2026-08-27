import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  LoginDto,
  RegisterDto,
  SERVICE_IDS,
  ServiceId,
} from '@batione/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';

/** Trial quota granted per service when an organization signs up. */
const TRIAL_QUOTA: Record<ServiceId, number> = {
  takeoff: 30,
  model3d: 30,
  rebar: 20,
  price_study: 50,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cette adresse e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const organization = await this.createOrganizationWithTrial(dto.organizationName);

    const user = await this.prisma.user.create({
      data: {
        organizationId: organization.id,
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role,
        passwordHash,
      },
    });

    await this.audit.record({
      organizationId: organization.id,
      actorId: user.id,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
    });

    return this.issue(user, organization);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { organization: true },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    return this.issue(user, user.organization);
  }

  /**
   * Local stand-in for the Google/Microsoft SSO buttons. In production this is
   * replaced by a real OAuth code exchange; the account-provisioning half of the
   * flow below is what actually ships either way.
   */
  async oauth(provider: string, payload: {
    email: string;
    fullName?: string;
    organizationName?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: payload.email },
      include: { organization: true },
    });
    if (existing) {
      return this.issue(existing, existing.organization);
    }

    const organization = await this.createOrganizationWithTrial(
      payload.organizationName || `${payload.email.split('@')[0]} SARL`,
    );
    const user = await this.prisma.user.create({
      data: {
        organizationId: organization.id,
        email: payload.email,
        fullName: payload.fullName || payload.email.split('@')[0],
        provider,
        role: 'engineer',
      },
    });
    return this.issue(user, organization);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable.');
    return {
      user: this.publicUser(user),
      organization: { id: user.organization.id, name: user.organization.name },
    };
  }

  private async createOrganizationWithTrial(name: string) {
    const slug = await this.uniqueSlug(name);
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    return this.prisma.organization.create({
      data: {
        name,
        slug,
        subscription: {
          create: {
            planName: 'trial',
            periodEnd,
            entitlements: {
              create: SERVICE_IDS.map((service) => ({
                service,
                quotaTotal: TRIAL_QUOTA[service],
                quotaUsed: 0,
                status: 'active',
              })),
            },
          },
        },
      },
    });
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'organisation';
    let candidate = base;
    let suffix = 1;
    while (await this.prisma.organization.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${++suffix}`;
    }
    return candidate;
  }

  private async issue(
    user: { id: string; email: string; fullName: string; role: string; organizationId: string },
    organization: { id: string; name: string },
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    });
    return {
      accessToken,
      user: this.publicUser(user),
      organization: { id: organization.id, name: organization.name },
    };
  }

  private publicUser(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    organizationId: string;
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}
