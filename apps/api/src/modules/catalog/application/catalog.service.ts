import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Product } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { IdempotentCommand } from '../../../common/idempotency/command';
import { ListResult } from '../../../common/pagination';
import { AuditService } from '../../audit/application/audit.service';
import { AuthService, type RequestAudit } from '../../iam/application/auth.service';
import type { Actor } from '../../iam/application/access-scope';

type Status = 'ACTIVE' | 'INACTIVE';
type ProductInput = {
  name: string;
  category?: string | null;
  description?: string | null;
  status?: Status;
};
type VariantInput = {
  sku: string;
  name: string;
  sellingPrice: string;
  lowStockThreshold?: string;
  status?: Status;
};
type Query = {
  page: number;
  pageSize: number;
  q?: string;
  category?: string;
  status?: Status;
  sortOrder: 'asc' | 'desc';
};
type Variant = Prisma.ProductVariantGetPayload<{
  include: { product: { select: { name: true; status: true } } };
}>;
const productData = (p: Product) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  description: p.description,
  status: p.status,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});
const variantData = (v: Variant) => ({
  id: v.id,
  productId: v.productId,
  productName: v.product.name,
  productStatus: v.product.status,
  sku: v.sku,
  name: v.name,
  sellingPrice: v.sellingPrice.toFixed(0),
  lowStockThreshold: v.lowStockThreshold.toFixed(3),
  status: v.status,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});
const includeProduct = { product: { select: { name: true, status: true } } } as const;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}
  private read(actor: Actor) {
    if (!actor.grants['catalog.products.read']?.includes('ORG')) throw new ForbiddenException();
  }
  private async manage(tx: Prisma.TransactionClient, actor: Actor) {
    const current = await this.auth.actorForFamily(tx, {
      sub: actor.id,
      organizationId: actor.organizationId,
      familyId: actor.familyId,
    });
    if (current.mustChangePassword || !current.grants['catalog.products.manage']?.includes('ORG'))
      throw new ForbiddenException();
  }
  private async findProduct(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const product = await tx.product.findFirst({ where: { organizationId, id } });
    if (!product) throw new NotFoundException();
    return product;
  }
  private duplicate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({
        code: 'DUPLICATE_SKU',
        message: 'SKU đã tồn tại trong tổ chức',
      });
    throw error;
  }
  async list(actor: Actor, query: Query & { sortBy: 'name' | 'createdAt' }) {
    this.read(actor);
    const q = query.q?.trim();
    const where: Prisma.ProductWhereInput = {
      organizationId: actor.organizationId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              {
                variants: {
                  some: {
                    OR: [
                      { sku: { contains: q, mode: 'insensitive' } },
                      { name: { contains: q, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.product.findMany({
          where,
          orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.product.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(rows.map(productData), {
      page: query.page,
      pageSize: query.pageSize,
      total,
    });
  }
  async detail(actor: Actor, id: string) {
    this.read(actor);
    return productData(await this.findProduct(this.prisma, actor.organizationId, id));
  }
  async variants(
    actor: Actor,
    query: Query & { productId?: string; sortBy: 'name' | 'sku' | 'sellingPrice' | 'createdAt' },
  ) {
    this.read(actor);
    const q = query.q?.trim();
    const where: Prisma.ProductVariantWhereInput = {
      organizationId: actor.organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.status ? { status: query.status } : {}),
      product: {
        ...(query.category ? { category: query.category } : {}),
        ...(query.status === 'ACTIVE' ? { status: 'ACTIVE' } : {}),
      },
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { product: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.productVariant.findMany({
          where,
          include: includeProduct,
          orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.productVariant.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(rows.map(variantData), {
      page: query.page,
      pageSize: query.pageSize,
      total,
    });
  }
  create(actor: Actor, input: ProductInput, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      (tx) => this.manage(tx, actor),
      async (tx) => {
        const data = productData(
          await tx.product.create({ data: { ...input, organizationId: actor.organizationId } }),
        );
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: 'catalog.product_created',
          entityType: 'product',
          entityId: data.id,
          ...context,
          changes: { after: data },
        });
        return data;
      },
    );
  }
  createVariant(actor: Actor, productId: string, input: VariantInput, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      async (tx) => {
        await this.manage(tx, actor);
        await this.findProduct(tx, actor.organizationId, productId);
      },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE organization_id=${actor.organizationId}::uuid AND id=${productId}::uuid FOR NO KEY UPDATE`;
        if ((await this.findProduct(tx, actor.organizationId, productId)).status !== 'ACTIVE')
          throw new ConflictException({
            code: 'PRODUCT_INACTIVE',
            message: 'Sản phẩm đã ngừng hoạt động',
          });
        try {
          const data = variantData(
            await tx.productVariant.create({
              data: { ...input, organizationId: actor.organizationId, productId },
              include: includeProduct,
            }),
          );
          await this.audit.record(tx, {
            organizationId: actor.organizationId,
            actorId: actor.id,
            action: 'catalog.variant_created',
            entityType: 'product_variant',
            entityId: data.id,
            ...context,
            changes: { after: data },
          });
          return data;
        } catch (error) {
          this.duplicate(error);
        }
      },
    );
  }
  async update(actor: Actor, id: string, input: Partial<ProductInput>, context: RequestAudit) {
    if (Object.values(input).every((value) => value === undefined)) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      await this.manage(tx, actor);
      await tx.$queryRaw`SELECT id FROM products WHERE organization_id=${actor.organizationId}::uuid AND id=${id}::uuid FOR NO KEY UPDATE`;
      const before = productData(await this.findProduct(tx, actor.organizationId, id));
      const data = productData(await tx.product.update({ where: { id }, data: input }));
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action:
          before.status !== data.status && data.status === 'INACTIVE'
            ? 'catalog.product_archived'
            : 'catalog.product_updated',
        entityType: 'product',
        entityId: id,
        ...context,
        changes: { before, after: data },
      });
      return data;
    });
  }
  async updateVariant(
    actor: Actor,
    id: string,
    input: Partial<VariantInput>,
    context: RequestAudit,
  ) {
    if (Object.values(input).every((value) => value === undefined)) throw new BadRequestException();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.manage(tx, actor);
        // Block concurrent movement/order-line FK inserts until the history check and SKU update commit.
        await tx.$queryRaw`SELECT id FROM product_variants WHERE organization_id=${actor.organizationId}::uuid AND id=${id}::uuid FOR UPDATE`;
        const existing = await tx.productVariant.findFirst({
          where: { organizationId: actor.organizationId, id },
          include: includeProduct,
        });
        if (!existing) throw new NotFoundException();
        if (
          input.sku !== undefined &&
          input.sku !== existing.sku &&
          ((await tx.stockMovement.findFirst({
            where: { organizationId: actor.organizationId, variantId: id },
            select: { id: true },
          })) ||
            (await tx.salesOrderItem.findFirst({
              where: { organizationId: actor.organizationId, variantId: id },
              select: { id: true },
            })))
        )
          throw new ConflictException({
            code: 'SKU_HAS_HISTORY',
            message: 'Không thể đổi SKU đã có lịch sử kho hoặc đơn bán',
          });
        const data = variantData(
          await tx.productVariant.update({ where: { id }, data: input, include: includeProduct }),
        );
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: 'catalog.variant_updated',
          entityType: 'product_variant',
          entityId: id,
          ...context,
          changes: { before: variantData(existing), after: data },
        });
        return data;
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
}
