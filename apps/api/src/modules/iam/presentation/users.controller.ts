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
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PageMeta, PageQuery } from '../../../common/pagination';
import { requestAudit } from '../../../common/http';
import { RequirePermission } from '../../../common/security/access';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { UsersService } from '../application/users.service';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const present = (_object: unknown, value: unknown) => value !== undefined;
export class CreateUserInput {
  @ApiProperty() @Transform(email) @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) displayName!: string;
  @ApiProperty({ writeOnly: true, minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  temporaryPassword!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds!: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchIds: string[] = [];
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}
export class UpdateUserInput {
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Transform(email)
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional()
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;
  @ApiPropertyOptional({ writeOnly: true, minLength: 12 })
  @ValidateIf(present)
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  temporaryPassword?: string;
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds?: string[];
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchIds?: string[];
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}
class UserQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] })
  @ValidateIf(present)
  @IsIn(['ACTIVE', 'INACTIVE', 'LOCKED'])
  status?: string;
  @ApiPropertyOptional() @ValidateIf(present) @IsUUID('4') branchId?: string;
  @ApiPropertyOptional({ enum: ['createdAt', 'email', 'displayName'] })
  @IsIn(['createdAt', 'email', 'displayName'])
  sortBy: 'createdAt' | 'email' | 'displayName' = 'createdAt';
}
class UserRoleData {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class UserData {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] }) status!: string;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [UserRoleData] }) roles!: UserRoleData[];
  @ApiProperty({ type: [String] }) branchIds!: string[];
}
class ResponseMeta {
  @ApiProperty() requestId!: string;
}
class UserResponse {
  @ApiProperty({ type: UserData }) data!: UserData;
  @ApiProperty({ type: ResponseMeta }) meta!: ResponseMeta;
}
class UserListResponse {
  @ApiProperty({ type: [UserData] }) data!: UserData[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}
@ApiTags('iam')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  @RequirePermission('iam.users.read')
  @ApiOkResponse({ type: UserListResponse })
  list(@Req() request: AuthorizedRequest, @Query() query: UserQuery) {
    return this.users.list(request.actor, query);
  }
  @Get(':id')
  @RequirePermission('iam.users.read')
  @ApiOkResponse({ type: UserResponse })
  detail(
    @Req() request: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.users.detail(request.actor, id);
  }
  @Post()
  @RequirePermission('iam.users.manage')
  @ApiCreatedResponse({ type: UserResponse })
  create(@Req() request: AuthorizedRequest, @Body() input: CreateUserInput) {
    return this.users.create(request.actor, input, requestAudit(request));
  }
  @Patch(':id')
  @RequirePermission('iam.users.manage')
  @ApiOkResponse({ type: UserResponse })
  update(
    @Req() request: AuthorizedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateUserInput,
  ) {
    return this.users.update(request.actor, id, input, requestAudit(request));
  }
}
