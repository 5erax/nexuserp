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
import { PageQuery } from '../../../common/pagination';
import { CustomersService } from '../application/customers.service';
import {
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerQuery,
  CustomerResponse,
  CustomerListResponse,
  CustomerOrderListResponse,
} from './customers.dto';

@ApiTags('crm')
@ApiCookieAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get()
  @RequirePermission('crm.customers.read')
  @ApiOkResponse({ type: CustomerListResponse })
  list(@Req() req: AuthorizedRequest, @Query() query: CustomerQuery) {
    return this.customers.list(req.actor, query);
  }
  @Get(':id')
  @RequirePermission('crm.customers.read')
  @ApiOkResponse({ type: CustomerResponse })
  detail(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.customers.detail(req.actor, id);
  }
  @Get(':id/orders')
  @RequirePermission('crm.customers.read')
  @ApiOkResponse({ type: CustomerOrderListResponse })
  orders(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PageQuery,
  ) {
    return this.customers.orders(req.actor, id, query);
  }
  @Post()
  @RequirePermission('crm.customers.create')
  @Idempotent()
  @ApiCreatedResponse({ type: CustomerResponse })
  create(@Req() req: AuthorizedRequest, @Body() input: CreateCustomerInput) {
    return this.customers.create(req.actor, input, requestAudit(req));
  }
  @Patch(':id')
  @RequirePermission('crm.customers.update')
  @ApiOkResponse({ type: CustomerResponse })
  update(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateCustomerInput,
  ) {
    return this.customers.update(req.actor, id, input, requestAudit(req));
  }
}
