import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createOpenApi } from '../src/openapi';
async function main() {
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/openapi_export_only';
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    configureApp(app);
    const spec = createOpenApi(app);
    mkdirSync(resolve('../../docs/api'), { recursive: true });
    writeFileSync(resolve('../../docs/api/openapi.yaml'), stringify(spec));
  } finally {
    await app.close();
  }
}
void main();
