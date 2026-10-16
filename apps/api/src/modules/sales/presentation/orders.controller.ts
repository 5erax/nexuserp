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
import { OrdersService } from '../application/orders.service';
import {
  CreateOrderInput,
  UpdateOrderInput,
  OrderQuery,
  OrderResponse,
  OrderListResponse,
} from './orders.dto';

@ApiTags('sales')
@ApiCookieAuth()
@Controller('sales/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get()
  @RequirePermission('sales.orders.read')
  @ApiOkResponse({ type: OrderListResponse })
  list(@Req() req: AuthorizedRequest, @Query() query: OrderQuery) {
    return this.orders.list(req.actor, query);
  }
  @Get(':id')
  @RequirePermission('sales.orders.read')
  @ApiOkResponse({ type: OrderResponse })
  detail(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.orders.detail(req.actor, id);
  }
  @Post()
  @RequirePermission('sales.orders.create')
  @Idempotent()
  @ApiCreatedResponse({ type: OrderResponse })
  create(@Req() req: AuthorizedRequest, @Body() input: CreateOrderInput) {
    return this.orders.create(req.actor, input, requestAudit(req));
  }
  @Patch(':id')
  @RequirePermission('sales.orders.update')
  @ApiOkResponse({ type: OrderResponse })
  update(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateOrderInput,
  ) {
    return this.orders.update(req.actor, id, input, requestAudit(req));
  }
}
