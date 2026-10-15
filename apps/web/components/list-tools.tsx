'use client';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
export function ListTools({
  onSearch,
  sortOrder,
  onSort,
  children,
  orderLabels = ['Mới nhất', 'Cũ nhất'],
}: {
  onSearch: (q: string) => void;
  sortOrder: 'asc' | 'desc';
  onSort: (value: 'asc' | 'desc') => void;
  children?: React.ReactNode;
  orderLabels?: [string, string];
}) {
  return (
    <form
      className="list-tools"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(String(new FormData(event.currentTarget).get('q') ?? '').trim());
      }}
    >
      <label>
        Tìm kiếm
        <Input name="q" maxLength={100} type="search" />
      </label>
      <Button type="submit">Tìm</Button>
      <label>
        Sắp xếp
        <select
          value={sortOrder}
          onChange={(e) => onSort(e.target.value === 'asc' ? 'asc' : 'desc')}
        >
          <option value="desc">{orderLabels[0]}</option>
          <option value="asc">{orderLabels[1]}</option>
        </select>
      </label>
      {children}
    </form>
  );
}
