import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiErrorResponse } from './common/api-error-response';
export function createOpenApi(app: INestApplication) {
  const spec = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('NexusERP API')
      .setDescription(
        'NexusERP API. Cookie sessions; unsafe requests require the exact Origin and X-CSRF-Token. Business data is filtered by organization, branch and ownership.',
      )
      .setVersion('0.0.0')
      .addCookieAuth('nexus_access')
      .addSecurity('refreshCookie', { type: 'apiKey', in: 'cookie', name: 'nexus_refresh' })
      .build(),
    { extraModels: [ApiErrorResponse] },
  );
  for (const path of Object.values(spec.paths))
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = path?.[method];
      if (!operation) continue;
      if (method !== 'get') {
        operation.parameters ??= [];
        if (
          !operation.parameters.some(
            (p) => 'name' in p && p.in === 'header' && p.name.toLowerCase() === 'x-csrf-token',
          )
        )
          operation.parameters.push({
            in: 'header',
            name: 'X-CSRF-Token',
            required: true,
            schema: { type: 'string' },
          });
      }
      for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 503])
        operation.responses[String(status)] ??= {
          description: 'API error; inspect error.code and error.requestId',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponse' } },
          },
        };
    }
  return spec;
}
