import 'reflect-metadata';
import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { ENVIRONMENT, type Environment } from './config/environment';
import { createOpenApi } from './openapi';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new ConsoleLogger({ json: true }) });
  configureApp(app);
  const config = app.get<Environment>(ENVIRONMENT);
  if (config.NODE_ENV === 'development') SwaggerModule.setup('api/docs', app, createOpenApi(app));
  await app.listen(config.API_PORT, '0.0.0.0');
}
void bootstrap();
