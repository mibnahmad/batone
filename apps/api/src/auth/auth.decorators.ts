import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  organizationId: string;
}

/** Marks a route as reachable without a bearer token. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
