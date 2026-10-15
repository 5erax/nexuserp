import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageMeta, PageQuery } from '../../../common/pagination';
import { requestAudit } from '../../../common/http';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { RolesService } from '../application/roles.service';
import type { Scope } from '../domain/permission-catalog';
class GrantInput {
  @ApiProperty() @IsString() @MaxLength(100) code!: string;
  @ApiProperty({ enum: ['ORG', 'BRANCH', 'OWN'] }) @IsIn(['ORG', 'BRANCH', 'OWN']) scope!: Scope;
}
class PermissionsInput {
  @ApiProperty({ type: [GrantInput] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GrantInput)
  permissions!: GrantInput[];
}
class CreateRoleInput extends PermissionsInput {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9_]{0,63}$/)
  code!: string;
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
class RoleData {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ type: [GrantInput] }) permissions!: GrantInput[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
class Meta {
  @ApiProperty() requestId!: string;
}
class RoleResponse {
  @ApiProperty({ type: RoleData }) data!: RoleData;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
class RoleListResponse {
  @ApiProperty({ type: [RoleData] }) data!: RoleData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
class PermissionData {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ type: [String] }) allowedScopes!: string[];
}
class PermissionListResponse {
  @ApiProperty({ type: [PermissionData] }) data!: PermissionData[];
  @ApiProperty({ type: Meta }) meta!: Meta;
}
@ApiTags('iam')
@ApiCookieAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get('roles')
  @RequirePermission('iam.roles.read')
  @ApiOkResponse({ type: RoleListResponse })
  list(@Req() request: AuthorizedRequest, @Query() query: PageQuery) {
    return this.roles.list(request.actor, query);
  }
  @Get('permissions')
  @RequirePermission('iam.roles.read')
  @ApiOkResponse({ type: PermissionListResponse })
  permissions() {
    return this.roles.permissions();
  }
  @Post('roles')
  @RequirePermission('iam.roles.manage')
  @ApiCreatedResponse({ type: RoleResponse })
  create(@Req() request: AuthorizedRequest, @Body() input: CreateRoleInput) {
    return this.roles.create(request.actor, input, requestAudit(request));
  }
  @Put('roles/:id/permissions')
  @RequirePermission('iam.roles.manage')
  @ApiOkResponse({ type: RoleResponse })
  update(
    @Req() request: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: PermissionsInput,
  ) {
    return this.roles.update(request.actor, id, input.permissions, requestAudit(request));
  }
}
