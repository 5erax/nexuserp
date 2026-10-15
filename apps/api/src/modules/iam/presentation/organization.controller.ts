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
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';
import { requestAudit } from '../../../common/http';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { OrganizationService } from '../application/organization.service';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const code = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const present = (_object: unknown, value: unknown) => value !== undefined;
class CreateBranchInput {
  @ApiProperty() @Transform(code) @Matches(/^[A-Z0-9_-]{1,32}$/) code!: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
class UpdateBranchInput {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Transform(code)
  @Matches(/^[A-Z0-9_-]{1,32}$/)
  code?: string;
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
class BranchQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}
class UpdateOrganizationInput {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
  @ApiPropertyOptional({ enum: ['VND'] }) @ValidateIf(present) @IsIn(['VND']) currency?: string;
  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone?: string;
}
class BranchData {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
}
class OrganizationData {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() timezone!: string;
}
class Meta {
  @ApiProperty() requestId!: string;
}
class BranchResponse {
  @ApiProperty({ type: BranchData }) data!: BranchData;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
class BranchListResponse {
  @ApiProperty({ type: [BranchData] }) data!: BranchData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
class OrganizationResponse {
  @ApiProperty({ type: OrganizationData }) data!: OrganizationData;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
@ApiTags('iam')
@ApiCookieAuth()
@Controller()
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}
  @Get('branches')
  @RequirePermission('iam.branches.read')
  @ApiOkResponse({ type: BranchListResponse })
  branches(@Req() request: AuthorizedRequest, @Query() query: BranchQuery) {
    return this.organization.branches(request.actor, query);
  }
  @Get('branches/:id')
  @RequirePermission('iam.branches.read')
  @ApiOkResponse({ type: BranchResponse })
  branch(
    @Req() request: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.organization.branch(request.actor, id);
  }
  @Post('branches')
  @RequirePermission('iam.branches.manage')
  @ApiCreatedResponse({ type: BranchResponse })
  create(@Req() request: AuthorizedRequest, @Body() input: CreateBranchInput) {
    return this.organization.createBranch(request.actor, input, requestAudit(request));
  }
  @Patch('branches/:id')
  @RequirePermission('iam.branches.manage')
  @ApiOkResponse({ type: BranchResponse })
  update(
    @Req() request: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateBranchInput,
  ) {
    return this.organization.updateBranch(request.actor, id, input, requestAudit(request));
  }
  @Get('organization')
  @RequirePermission('iam.organization.read')
  @ApiOkResponse({ type: OrganizationResponse })
  profile(@Req() request: AuthorizedRequest) {
    return this.organization.profile(request.actor);
  }
  @Patch('organization')
  @RequirePermission('iam.organization.update')
  @ApiOkResponse({ type: OrganizationResponse })
  updateProfile(@Req() request: AuthorizedRequest, @Body() input: UpdateOrganizationInput) {
    return this.organization.updateProfile(request.actor, input, requestAudit(request));
  }
}
