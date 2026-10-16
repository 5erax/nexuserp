import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InventoryPage from '../app/(protected)/inventory/page';
const state = vi.hoisted(() => ({ grants: {} as Record<string, string[]> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../components/session-gate', () => ({
  SessionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../lib/auth/session', () => ({ useSession: () => ({ data: { grants: state.grants } }) }));
vi.mock('../components/warehouse-picker', () => ({
  WarehousePicker: () => <div data-testid="warehouse-filter" />,
}));
vi.mock('../lib/auth/api', async (actual) => ({
  ...(await actual<typeof import('../lib/auth/api')>()),
  api: {
    GET: async () => ({
      response: new Response(null, { status: 200 }),
      data: { data: [], meta: { total: 0, nextCursor: null } },
    }),
  },
}));
it.each([
  [{}, false, false],
  [{ 'inventory.warehouses.read': ['BRANCH'] }, false, true],
  [{ 'inventory.warehouses.read': ['BRANCH'], 'catalog.products.read': ['BRANCH'] }, false, true],
  [{ 'inventory.warehouses.read': ['BRANCH'], 'catalog.products.read': ['ORG'] }, true, true],
])(
  'requires independent warehouse and catalog lookup grants for adjustment creation (%j)',
  (lookups, create, filter) => {
    state.grants = {
      'inventory.movements.read': ['BRANCH'],
      'inventory.adjustments.create': ['BRANCH'],
      ...lookups,
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InventoryPage />
      </QueryClientProvider>,
    );
    expect(!!screen.queryByRole('button', { name: 'Tạo phiếu tồn kho' })).toBe(create);
    expect(!!screen.queryByTestId('warehouse-filter')).toBe(filter);
  },
);
