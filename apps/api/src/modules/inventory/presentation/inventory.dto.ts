import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const code = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const present = (_object: unknown, value: unknown) => value !== undefined;

export class WarehouseQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') branchId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
export class CreateWarehouseInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') branchId!: string;
  @ApiProperty({ maxLength: 32 })
  @Transform(code)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
  @ApiPropertyOptional({ default: false }) @ValidateIf(present) @IsBoolean() isDefault?: boolean;
}
export class UpdateWarehouseInput extends PartialType(
  OmitType(CreateWarehouseInput, ['branchId'] as const),
  { skipNullProperties: false },
) {}
export class BalanceQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') warehouseId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') variantId?: string;
}
export class MovementQuery extends BalanceQuery {
  @ApiPropertyOptional({ enum: ['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SHIPMENT_OUT'] })
  @IsOptional()
  @IsIn(['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SHIPMENT_OUT'])
  referenceType?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') referenceId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() to?: string;
}
class WarehouseData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty() branchName!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
class StockIdentity {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty() productName!: string;
}
class BalanceData extends StockIdentity {
  @ApiProperty({ type: String, example: '10.125' }) onHand!: string;
  @ApiProperty({ type: String, example: '2.125' }) reserved!: string;
  @ApiProperty({ type: String, example: '8.000' }) available!: string;
  @ApiProperty({ type: String, example: '8.000' }) lowStockThreshold!: string;
  @ApiProperty() lowStock!: boolean;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
class MovementData extends StockIdentity {
  @ApiProperty({ type: String, example: '-1.125' }) quantityDelta!: string;
  @ApiProperty({ type: String, nullable: true, example: '1000.123456' }) unitCost!: string | null;
  @ApiProperty({ enum: ['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SHIPMENT_OUT'] })
  referenceType!: string;
  @ApiProperty({ format: 'uuid' }) referenceId!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
class RequestMeta {
  @ApiProperty() requestId!: string;
}
export class WarehouseResponse {
  @ApiProperty({ type: WarehouseData }) data!: WarehouseData;
  @ApiProperty({ type: RequestMeta }) meta!: RequestMeta;
}
export class WarehouseListResponse {
  @ApiProperty({ type: [WarehouseData] }) data!: WarehouseData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
export class BalanceListResponse {
  @ApiProperty({ type: [BalanceData] }) data!: BalanceData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
export class MovementListResponse {
  @ApiProperty({ type: [MovementData] }) data!: MovementData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
