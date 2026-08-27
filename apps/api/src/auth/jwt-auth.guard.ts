import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC_KEY } from './auth.decorators';

/**
 * Accepts the bearer token from the Authorization header, or from a `token`
 * query parameter. The latter exists because EventSource (used for job progress
 * streaming) and browser-initiated downloads cannot set custom headers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Jeton d'authentification manquant.");
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        fullName: string;
        role: string;
        organizationId: string;
      }>(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        fullName: payload.fullName,
        role: payload.role,
        organizationId: payload.organizationId,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Session expirée ou jeton invalide.');
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice(7);
    }
    const queryToken = (request.query as Record<string, unknown>)?.token;
    return typeof queryToken === 'string' && queryToken.length > 0 ? queryToken : null;
  }
}
