import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService } from '../application/health.service';
import { Public } from '../../../common/security/access';
import { ApiErrorResponse } from '../../../common/api-error-response';
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
  @ApiServiceUnavailableResponse({ type: ApiErrorResponse })
  ready() {
    return this.health.ready();
  }
}
