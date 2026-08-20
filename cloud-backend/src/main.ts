import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // HTTP CORS for browser clients (the lanlock-admin dashboard). Native
  // mobile/desktop apps send no Origin and are unaffected. Dev-permissive:
  // tighten to an allowlist before any public deployment.
  app.enableCors({ origin: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not in the DTO
      forbidNonWhitelisted: true, // 400 on unexpected properties
      transform: true, // instantiate DTO classes
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
