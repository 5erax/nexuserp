import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const sku = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const present = (_object: unknown, value: unknown) => value !== undefined;
const nullable = (_object: unknown, value: unknown) => value !== undefined && value !== null;
const money = /^(0|[1-9]\d{0,19})$/;
const quantity = /^(0|[1-9]\d{0,14})(\.\d{1,3})?$/;

export class CreateProductInput {
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @ValidateIf(nullable)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf(nullable)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
export class UpdateProductInput extends PartialType(CreateProductInput, {
  skipNullProperties: false,
}) {}
export class CreateVariantInput {
  @ApiProperty({ maxLength: 64 })
  @Transform(sku)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
  @ApiProperty({ type: String, pattern: money.source, example: '450000' })
  @Transform(trim)
  @Matches(money)
  sellingPrice!: string;
  @ApiPropertyOptional({ type: String, pattern: quantity.source, example: '10.125' })
  @ValidateIf(present)
  @Transform(trim)
  @Matches(quantity)
  lowStockThreshold?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
export class UpdateVariantInput extends PartialType(CreateVariantInput, {
  skipNullProperties: false,
}) {}
class CatalogQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category?: string;
}
export class ProductQuery extends CatalogQuery {
  @ApiPropertyOptional({ enum: ['createdAt', 'name'], default: 'createdAt' })
  @IsIn(['createdAt', 'name'])
  sortBy: 'createdAt' | 'name' = 'createdAt';
}
export class VariantQuery extends CatalogQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID('4') productId?: string;
  @ApiPropertyOptional({ enum: ['createdAt', 'name', 'sku', 'sellingPrice'], default: 'createdAt' })
  @IsIn(['createdAt', 'name', 'sku', 'sellingPrice'])
  sortBy: 'createdAt' | 'name' | 'sku' | 'sellingPrice' = 'createdAt';
}
export class ProductData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) category!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class VariantData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) productStatus!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, pattern: money.source }) sellingPrice!: string;
  @ApiProperty({ type: String, pattern: quantity.source }) lowStockThreshold!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
class CatalogMeta {
  @ApiProperty() requestId!: string;
}
export class ProductResponse {
  @ApiProperty({ type: ProductData }) data!: ProductData;
  @ApiProperty({ type: CatalogMeta }) meta!: CatalogMeta;
}
export class VariantResponse {
  @ApiProperty({ type: VariantData }) data!: VariantData;
  @ApiProperty({ type: CatalogMeta }) meta!: CatalogMeta;
}
export class ProductListResponse {
  @ApiProperty({ type: [ProductData] }) data!: ProductData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
export class VariantListResponse {
  @ApiProperty({ type: [VariantData] }) data!: VariantData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
