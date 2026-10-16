import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { Idempotent } from '../../../common/idempotency/idempotent';
import { requestAudit } from '../../../common/http';
import { WarehousesService } from '../application/warehouses.service';
import { InventoryReadsService } from '../application/inventory-reads.service';
import {
  BalanceListResponse,
  BalanceQuery,
  CreateWarehouseInput,
  MovementListResponse,
  MovementQuery,
  UpdateWarehouseInput,
  WarehouseListResponse,
  WarehouseQuery,
  WarehouseResponse,
} from './inventory.dto';

@ApiTags('inventory')
@ApiCookieAuth()
@Controller()
export class InventoryController {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly inventory: InventoryReadsService,
  ) {}
  @Get('warehouses')
  @RequirePermission('inventory.warehouses.read')
  @ApiOkResponse({ type: WarehouseListResponse })
  list(@Req() req: AuthorizedRequest, @Query() query: WarehouseQuery) {
    return this.warehouses.list(req.actor, query);
  }
  @Get('warehouses/:id')
  @RequirePermission('inventory.warehouses.read')
  @ApiOkResponse({ type: WarehouseResponse })
  detail(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.warehouses.detail(req.actor, id);
  }
  @Post('warehouses')
  @RequirePermission('inventory.warehouses.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: WarehouseResponse })
  create(@Req() req: AuthorizedRequest, @Body() input: CreateWarehouseInput) {
    return this.warehouses.create(req.actor, input, requestAudit(req));
  }
  @Patch('warehouses/:id')
  @RequirePermission('inventory.warehouses.manage')
  @ApiOkResponse({ type: WarehouseResponse })
  update(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateWarehouseInput,
  ) {
    return this.warehouses.update(req.actor, id, input, requestAudit(req));
  }
  @Get('inventory/balances')
  @RequirePermission('inventory.balances.read')
  @ApiOkResponse({ type: BalanceListResponse })
  balances(@Req() req: AuthorizedRequest, @Query() query: BalanceQuery) {
    return this.inventory.balances(req.actor, query);
  }
  @Get('inventory/movements')
  @RequirePermission('inventory.movements.read')
  @ApiOkResponse({ type: MovementListResponse })
  movements(@Req() req: AuthorizedRequest, @Query() query: MovementQuery) {
    return this.inventory.movements(req.actor, query);
  }
}
