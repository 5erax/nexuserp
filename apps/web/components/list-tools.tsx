'use client';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
export function ListTools({
  onSearch,
  sortOrder,
  onSort,
  children,
}: {
  onSearch: (q: string) => void;
  sortOrder: 'asc' | 'desc';
  onSort: (value: 'asc' | 'desc') => void;
  children?: React.ReactNode;
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
          <option value="desc">Mới nhất</option>
          <option value="asc">Cũ nhất</option>
        </select>
      </label>
      {children}
    </form>
  );
}
