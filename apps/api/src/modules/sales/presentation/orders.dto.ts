import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';

const present = (_: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const quantity = /^(0|[1-9]\d{0,14})(\.\d{1,3})?$/;
export const orderStatuses = ['DRAFT', 'CONFIRMED', 'CANCELLED', 'FULFILLED'] as const;
class OrderLineInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') variantId!: string;
  @ApiProperty({ type: String, pattern: quantity.source }) @Matches(quantity) quantity!: string;
}
class DiscountInput {
  @ApiProperty({ enum: ['NONE', 'AMOUNT', 'PERCENT'] }) @IsIn(['NONE', 'AMOUNT', 'PERCENT']) type!:
    | 'NONE'
    | 'AMOUNT'
    | 'PERCENT';
  @ApiProperty({ type: String, pattern: '^(0|[1-9]\\d{0,16})(\\.\\d{1,2})?$' })
  @Matches(/^(0|[1-9]\d{0,16})(\.\d{1,2})?$/)
  value!: string;
}
class DraftInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') customerId!: string;
  @ApiProperty({ type: [OrderLineInput], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  items!: OrderLineInput[];
  @ApiPropertyOptional({ type: DiscountInput })
  @ValidateIf(present)
  @IsDefined()
  @ValidateNested()
  @Type(() => DiscountInput)
  discount?: DiscountInput;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
export class CreateOrderInput extends DraftInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') branchId!: string;
}
export class UpdateOrderInput extends PartialType(DraftInput, { skipNullProperties: false }) {
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2147483646 })
  @IsInt()
  @Min(0)
  @Max(2147483646)
  version!: number;
}
export class OrderQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID('4') branchId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID('4') customerId?: string;
  @ApiPropertyOptional({ enum: orderStatuses })
  @ValidateIf(present)
  @IsIn(orderStatuses)
  status?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf(present)
  @IsDateString({ strict: true })
  createdFrom?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf(present)
  @IsDateString({ strict: true })
  createdTo?: string;
}
export class OrderSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: orderStatuses }) status!: string;
  @ApiProperty({ enum: ['VND'] }) currency!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ type: String }) subtotal!: string;
  @ApiProperty({ enum: ['NONE', 'AMOUNT', 'PERCENT'] }) discountType!: string;
  @ApiProperty({ type: String }) discountValue!: string;
  @ApiProperty({ type: String }) discountTotal!: string;
  @ApiProperty({ type: String }) taxTotal!: string;
  @ApiProperty({ type: String }) grandTotal!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: 'integer' }) version!: number;
  @ApiProperty({ type: 'integer' }) itemCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
class OrderLineData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unitPrice!: string;
  @ApiProperty({ type: String }) lineTotal!: string;
  @ApiProperty({ type: String }) deliveredQuantity!: string;
}
export class OrderData extends OrderSummary {
  @ApiProperty({ type: [OrderLineData] }) items!: OrderLineData[];
}
class ResponseMeta {
  @ApiProperty() requestId!: string;
}
export class OrderResponse {
  @ApiProperty({ type: OrderData }) data!: OrderData;
  @ApiProperty({ type: ResponseMeta }) meta!: ResponseMeta;
}
export class OrderListResponse {
  @ApiProperty({ type: [OrderSummary] }) data!: OrderSummary[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
