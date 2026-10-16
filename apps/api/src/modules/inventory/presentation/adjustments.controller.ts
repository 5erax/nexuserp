import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { Idempotent } from '../../../common/idempotency/idempotent';
import { requestAudit } from '../../../common/http';
import { AdjustmentsService } from '../application/adjustments.service';
import {
  AdjustmentListResponse,
  AdjustmentQuery,
  AdjustmentResponse,
  CreateAdjustmentInput,
  RejectAdjustmentInput,
  emptyCommand,
} from './adjustments.dto';

@ApiTags('inventory')
@ApiCookieAuth()
@Controller('inventory/adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}
  @Get()
  @RequirePermission('inventory.movements.read')
  @ApiOkResponse({ type: AdjustmentListResponse })
  list(@Req() req: AuthorizedRequest, @Query() query: AdjustmentQuery) {
    return this.adjustments.list(req.actor, query);
  }
  @Get(':id')
  @RequirePermission('inventory.movements.read')
  @ApiOkResponse({ type: AdjustmentResponse })
  detail(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.adjustments.detail(req.actor, id);
  }
  @Post()
  @RequirePermission('inventory.adjustments.create')
  @Idempotent()
  @ApiCreatedResponse({ type: AdjustmentResponse })
  create(@Req() req: AuthorizedRequest, @Body() input: CreateAdjustmentInput) {
    return this.adjustments.create(req.actor, input, requestAudit(req));
  }
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.post')
  @Idempotent()
  @ApiOkResponse({ type: AdjustmentResponse })
  post(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    emptyCommand(input);
    return this.adjustments.post(req.actor, id, requestAudit(req));
  }
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.approve')
  @Idempotent()
  @ApiOkResponse({ type: AdjustmentResponse })
  approve(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    emptyCommand(input);
    return this.adjustments.approve(req.actor, id, requestAudit(req));
  }
  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.approve')
  @Idempotent()
  @ApiOkResponse({ type: AdjustmentResponse })
  reject(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: RejectAdjustmentInput,
  ) {
    return this.adjustments.reject(req.actor, id, input.reason, requestAudit(req));
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.create')
  @Idempotent()
  @ApiOkResponse({ type: AdjustmentResponse })
  cancel(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: unknown,
  ) {
    emptyCommand(input);
    return this.adjustments.cancel(req.actor, id, requestAudit(req));
  }
}
