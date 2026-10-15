import { ApiProperty } from '@nestjs/swagger';
class ApiError {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'object', additionalProperties: {} },
      {
        type: 'array',
        items: {
          type: 'object',
          required: ['field', 'messages'],
          properties: {
            field: { type: 'string' },
            messages: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    ],
  })
  details!: Record<string, unknown> | { field: string; messages: string[] }[] | null;
  @ApiProperty() requestId!: string;
}
export class ApiErrorResponse {
  @ApiProperty({ type: ApiError }) error!: ApiError;
}
