/**
 * Tab Khu công nghiệp của màn Danh mục: bảng + nội dung form.
 * Tách khỏi `CatalogEntry.tsx` ngày 17/11/2026 (plan `2026-11-17-tach-catalog-entry.md`,
 * đợt 5) — JSX NGUYÊN VĂN; state + logic ở `useCatalog.ts`, truyền vào bằng `{...cat}`.
 */
import { zones } from '../../../lib/dm/repo';
import {
  Field, TableCard, TextInput, TH_CLS,
} from '../entryUi';
import { RowActions } from './RowActions';
import type { CatalogState } from './useCatalog';

export function ZoneTable(props: CatalogState) {
  const {
    loading, zoneRowsShown, terms, search, stationsOfZone, editZone, del,
  } = props;
  return (
    <>
        <TableCard fixed loading={loading} isEmpty={zoneRowsShown.length === 0}
          empty={terms.length
            ? `Không có khu công nghiệp nào khớp "${search.trim()}".`
            : 'Chưa có khu công nghiệp nào được khai.'}
          columns={<>
            <th className={`${TH_CLS} w-[14%] pl-10`}>Mã KCN</th>
            <th className={`${TH_CLS} w-[26%]`}>Tên khu công nghiệp</th>
            <th className={`${TH_CLS} w-[42%]`}>Địa chỉ</th>
            <th className={`${TH_CLS} w-[10%]`}>Số trạm</th>
            <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
          </>}>
          {zoneRowsShown.map(z => (
            <tr key={z.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-10">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{z.code}</span>
              </td>
              <td className="truncate px-6 py-4 font-bold text-ink" title={z.name}>{z.name}</td>
              <td className="truncate px-6 py-4 text-sm text-soft" title={z.address || ''}>{z.address || '—'}</td>
              <td className="px-6 py-4 text-sm font-semibold text-dim">{stationsOfZone(z.id)}</td>
              <td className="px-6 py-4 pr-10 text-right">
                <RowActions onEdit={() => editZone(z)}
                  onDelete={() => void del(`KCN ${z.code}`, () => zones.remove(z.id),
                    stationsOfZone(z.id) > 0
                      ? `KCN này đang có ${stationsOfZone(z.id)} trạm. Xóa KCN KHÔNG xóa trạm — các trạm đó sẽ mất KCN cha.`
                      : undefined)} />
              </td>
            </tr>
          ))}
        </TableCard>
    </>
  );
}

export function ZoneForm(props: CatalogState) {
  const {
    zForm, setZForm,
  } = props;
  return (
    <>
          <>
            {/* Modal đã rộng: màn lớn xếp cả 3 ô một hàng cho đỡ cuộn. */}
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Mã KCN" required>
                <TextInput value={zForm.code} mono placeholder="KCNTH"
                  onChange={v => setZForm(f => ({ ...f, code: v }))} />
              </Field>
              <Field label="Tên KCN" required>
                <TextInput value={zForm.name} placeholder="KCN Tiền Hải"
                  onChange={v => setZForm(f => ({ ...f, name: v }))} />
              </Field>
              <Field label="Địa chỉ">
                <TextInput value={zForm.address} placeholder="Xã…, tỉnh…"
                  onChange={v => setZForm(f => ({ ...f, address: v }))} />
              </Field>
            </div>
          </>
    </>
  );
}
