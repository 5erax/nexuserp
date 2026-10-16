import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { ReconciliationService } from '../application/reconciliation.service';
import { ReconciliationQuery, ReconciliationResponse } from './reconciliation.dto';

@ApiTags('inventory')
@ApiCookieAuth()
@Controller('inventory/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}
  @Get()
  @RequirePermission('inventory.balances.read')
  @ApiOkResponse({ type: ReconciliationResponse })
  list(@Req() req: AuthorizedRequest, @Query() query: ReconciliationQuery) {
    return this.reconciliation.list(req.actor, query);
  }
}
