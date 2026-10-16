import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';

export class ReconciliationQuery extends PickType(PageQuery, ['page', 'pageSize'] as const) {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('4') warehouseId?: string;
}
class DifferenceData {
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) branchId!: string;
  @ApiProperty({ format: 'uuid' }) variantId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty({ type: String, example: '10.125' }) onHand!: string;
  @ApiProperty({ type: String, example: '10.125' }) expectedOnHand!: string;
  @ApiProperty({ type: String, example: '2.125' }) reserved!: string;
  @ApiProperty({ type: String, example: '2.125' }) expectedReserved!: string;
  @ApiProperty() missingBalance!: boolean;
}
export class ReconciliationResponse {
  @ApiProperty({ type: [DifferenceData] }) data!: DifferenceData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
