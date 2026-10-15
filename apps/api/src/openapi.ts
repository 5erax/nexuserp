import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
export function createOpenApi(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('NexusERP API')
      .setDescription('Phase 0 foundation; business endpoints are not implemented.')
      .setVersion('0.0.0')
      .build(),
  );
}
