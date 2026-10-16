import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const nullable = (_: unknown, value: unknown) => value !== undefined && value !== null;
const present = (_: unknown, value: unknown) => value !== undefined;
export class CreateCustomerInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') branchId!: string;
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'email', maxLength: 254 })
  @ValidateIf(nullable)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 32 })
  @ValidateIf(nullable)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @ValidateIf(nullable)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  address?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf(nullable)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
export class UpdateCustomerInput extends PartialType(
  OmitType(CreateCustomerInput, ['branchId'] as const),
  { skipNullProperties: false },
) {}
export class CustomerQuery extends PageQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID('4') branchId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
  @ApiPropertyOptional({ enum: ['name', 'createdAt'], default: 'createdAt' })
  @IsIn(['name', 'createdAt'])
  sortBy: 'name' | 'createdAt' = 'createdAt';
}
class CustomerData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
class ResponseMeta {
  @ApiProperty() requestId!: string;
}
export class CustomerResponse {
  @ApiProperty({ type: CustomerData }) data!: CustomerData;
  @ApiProperty({ type: ResponseMeta }) meta!: ResponseMeta;
}
export class CustomerListResponse {
  @ApiProperty({ type: [CustomerData] }) data!: CustomerData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
class CustomerOrderData {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'FULFILLED'] }) status!: string;
  @ApiProperty({ enum: ['VND'] }) currency!: string;
  @ApiProperty({ type: String }) grandTotal!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class CustomerOrderListResponse {
  @ApiProperty({ type: [CustomerOrderData] }) data!: CustomerOrderData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
