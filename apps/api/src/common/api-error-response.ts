import { ApiProperty } from '@nestjs/swagger';
class ApiError {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true }) details!:
    | object
    | null;
  @ApiProperty() requestId!: string;
}
export class ApiErrorResponse {
  @ApiProperty({ type: ApiError }) error!: ApiError;
}
