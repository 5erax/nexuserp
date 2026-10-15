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
import { Idempotent } from '../../../common/idempotency/idempotent';
import { requestAudit } from '../../../common/http';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { CatalogService } from '../application/catalog.service';
import {
  CreateProductInput,
  CreateVariantInput,
  ProductListResponse,
  ProductQuery,
  ProductResponse,
  UpdateProductInput,
  UpdateVariantInput,
  VariantListResponse,
  VariantQuery,
  VariantResponse,
} from './catalog.dto';

@ApiTags('catalog')
@ApiCookieAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('products')
  @RequirePermission('catalog.products.read')
  @ApiOkResponse({ type: ProductListResponse })
  list(@Req() req: AuthorizedRequest, @Query() query: ProductQuery) {
    return this.catalog.list(req.actor, query);
  }
  @Get('products/:id')
  @RequirePermission('catalog.products.read')
  @ApiOkResponse({ type: ProductResponse })
  detail(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.catalog.detail(req.actor, id);
  }
  @Post('products')
  @RequirePermission('catalog.products.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: ProductResponse })
  create(@Req() req: AuthorizedRequest, @Body() input: CreateProductInput) {
    return this.catalog.create(req.actor, input, requestAudit(req));
  }
  @Patch('products/:id')
  @RequirePermission('catalog.products.manage')
  @ApiOkResponse({ type: ProductResponse })
  update(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateProductInput,
  ) {
    return this.catalog.update(req.actor, id, input, requestAudit(req));
  }
  @Get('product-variants')
  @RequirePermission('catalog.products.read')
  @ApiOkResponse({ type: VariantListResponse })
  variants(@Req() req: AuthorizedRequest, @Query() query: VariantQuery) {
    return this.catalog.variants(req.actor, query);
  }
  @Post('products/:id/variants')
  @RequirePermission('catalog.products.manage')
  @Idempotent()
  @ApiCreatedResponse({ type: VariantResponse })
  createVariant(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: CreateVariantInput,
  ) {
    return this.catalog.createVariant(req.actor, id, input, requestAudit(req));
  }
  @Patch('product-variants/:id')
  @RequirePermission('catalog.products.manage')
  @ApiOkResponse({ type: VariantResponse })
  updateVariant(
    @Req() req: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateVariantInput,
  ) {
    return this.catalog.updateVariant(req.actor, id, input, requestAudit(req));
  }
}
