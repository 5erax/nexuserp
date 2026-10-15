import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { AuditService } from '../application/audit.service';
class AuditQuery {
  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
class AuditData {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) branchId!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty({ nullable: true, type: String }) entityId!: string | null;
  @ApiProperty() requestId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'object', additionalProperties: {} },
      { type: 'array', items: {} },
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  changes!: unknown;
}
class CursorMeta {
  @ApiProperty() requestId!: string;
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
class AuditResponse {
  @ApiProperty({ type: [AuditData] }) data!: AuditData[];
  @ApiProperty({ type: CursorMeta }) meta!: CursorMeta;
}
@ApiTags('audit')
@ApiCookieAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @RequirePermission('audit.logs.read')
  @ApiOkResponse({ type: AuditResponse })
  list(@Req() request: AuthorizedRequest, @Query() query: AuditQuery) {
    return this.audit.list(request.actor, query);
  }
}
