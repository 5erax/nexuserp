import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../../modules/iam/domain/permission-catalog';
export const ACCESS = 'nexus:access';
export type AccessPolicy =
  | 'public'
  | 'session'
  | 'login'
  | 'refresh'
  | 'logout'
  | { permission: PermissionCode };
export const Public = () => SetMetadata(ACCESS, 'public' satisfies AccessPolicy);
export const Session = () => SetMetadata(ACCESS, 'session' satisfies AccessPolicy);
export const AuthRoute = (route: 'login' | 'refresh' | 'logout') => SetMetadata(ACCESS, route);
export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(ACCESS, { permission } satisfies AccessPolicy);
