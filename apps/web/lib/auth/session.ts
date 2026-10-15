'use client';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './api';
export const sessionKey = ['session'] as const;
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => unwrap(await api.GET('/api/v1/auth/me')).data,
    retry: false,
    staleTime: 15000,
    refetchOnWindowFocus: true,
  });
}
