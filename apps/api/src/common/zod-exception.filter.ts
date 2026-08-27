import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Controllers parse their payloads with the shared zod contracts directly, so a
 * ZodError is a client error, not a 500.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const error = new BadRequestException({
      message: 'Validation échouée.',
      issues: exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    response.status(error.getStatus()).json(error.getResponse());
  }
}
