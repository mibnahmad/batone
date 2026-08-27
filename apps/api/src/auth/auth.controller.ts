import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { loginSchema, registerSchema, type LoginDto, type RegisterDto } from '@batione/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './auth.decorators';

const oauthSchema = z.object({
  email: z.string().email(),
  fullName: z.string().optional(),
  organizationName: z.string().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('oauth/:provider')
  oauth(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(oauthSchema)) body: z.infer<typeof oauthSchema>,
  ) {
    return this.auth.oauth(provider, body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
