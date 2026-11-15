import { HttpStatus } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ApiException } from './common/api-exception.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Validation failed',
          issues.map((issue) => ({
            path: issue.path
              ?.map((segment) =>
                typeof segment === 'object' && segment !== null && 'key' in segment
                  ? String(segment.key)
                  : String(segment),
              )
              .join('.'),
            message: issue.message,
          })),
        ),
    }),
  );

  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 8080);
}
await bootstrap();
