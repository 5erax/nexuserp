import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const nullable = (_object: unknown, value: unknown) => value !== undefined && value !== null;
const quantity = /^-?(0|[1-9]\d{0,14})(\.\d{1,3})?$/;
const cost = /^(0|[1-9]\d{0,13})(\.\d{1,6})?$/;
const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED', 'REJECTED'];

class AdjustmentLineInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') variantId!: string;
  @ApiProperty({ type: String, pattern: quantity.source })
  @Matches(quantity)
  quantityDelta!: string;
  @ApiPropertyOptional({ type: String, nullable: true, pattern: cost.source })
  @ValidateIf(nullable)
  @Matches(cost)
  unitCost?: string | null;
}
export class CreateAdjustmentInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') warehouseId!: string;
  @ApiProperty({ enum: ['OPENING', 'ADJUSTMENT'] }) @IsIn(['OPENING', 'ADJUSTMENT']) kind!:
    | 'OPENING'
    | 'ADJUSTMENT';
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
  @ApiProperty({ type: [AdjustmentLineInput], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineInput)
  items!: AdjustmentLineInput[];
}
export class RejectAdjustmentInput {
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
export function emptyCommand(input: unknown) {
  if (
    input !== undefined &&
    (input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length)
  )
    throw new BadRequestException('Lệnh này không nhận trường dữ liệu');
}
export class AdjustmentQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') warehouseId?: string;
  @ApiPropertyOptional({ enum: ['OPENING', 'ADJUSTMENT'] })
  @IsOptional()
  @IsIn(['OPENING', 'ADJUSTMENT'])
  kind?: string;
  @ApiPropertyOptional({ enum: statuses }) @IsOptional() @IsIn(statuses) status?: string;
}
class AdjustmentSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ enum: ['OPENING', 'ADJUSTMENT'] }) kind!: string;
  @ApiProperty({ enum: statuses }) status!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, nullable: true }) decisionReason!: string | null;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ type: String }) approvalThreshold!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) approvedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) approvedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
class AdjustmentLineData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty({ type: String }) quantityDelta!: string;
  @ApiProperty({ type: String, nullable: true }) unitCost!: string | null;
}
class AdjustmentData extends AdjustmentSummary {
  @ApiProperty({ type: String }) totalAbsoluteQuantity!: string;
  @ApiProperty() requiresApproval!: boolean;
  @ApiProperty({ type: [AdjustmentLineData] }) items!: AdjustmentLineData[];
}
class RequestMeta {
  @ApiProperty() requestId!: string;
}
export class AdjustmentResponse {
  @ApiProperty({ type: AdjustmentData }) data!: AdjustmentData;
  @ApiProperty({ type: RequestMeta }) meta!: RequestMeta;
}
export class AdjustmentListResponse {
  @ApiProperty({ type: [AdjustmentSummary] }) data!: AdjustmentSummary[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
