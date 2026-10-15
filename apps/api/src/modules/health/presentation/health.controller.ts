import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from '../application/health.service';
import { Public } from '../../../common/security/access';
class HealthData {
  @ApiProperty({ enum: ['ok', 'ready'] }) status!: 'ok' | 'ready';
}
class Meta {
  @ApiProperty() requestId!: string;
}
class HealthResponse {
  @ApiProperty({ type: HealthData }) data!: HealthData;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
class ApiError {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true }) details!: object | null;
  @ApiProperty() requestId!: string;
}
class ErrorResponse {
  @ApiProperty({ type: ApiError }) error!: ApiError;
}
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get() @Public() @ApiOkResponse({ type: HealthResponse }) live() {
    return { status: 'ok' as const };
  }
  @Get('ready')
  @Public()
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({ type: ErrorResponse })
  ready() {
    return this.health.ready();
  }
}
