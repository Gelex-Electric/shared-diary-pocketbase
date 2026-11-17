/**
 * Tab Lộ đường dây của màn Danh mục: bảng + nội dung form.
 * Tách khỏi `CatalogEntry.tsx` ngày 17/11/2026 (plan `2026-11-17-tach-catalog-entry.md`,
 * đợt 5) — JSX NGUYÊN VĂN; state + logic ở `useCatalog.ts`, truyền vào bằng `{...cat}`.
 */
import {
  Factory,
} from 'lucide-react';
import { Select } from '../../ui/Select';
import { lines } from '../../../lib/dm/repo';
import type {
  VoltageLevel,
} from '../../../lib/dm/types';
import {
  Field, TextInput, TH_CLS,
} from '../entryUi';
import { ZoneTables } from '../ZoneTables';
import { RowActions } from './RowActions';
import type { CatalogState } from './useCatalog';

export function LineTable(props: CatalogState) {
  const {
    d, loading, lineGroupsShown, emptyText, stationsOfLine, setAssigning, editLine, del,
  } = props;
  return (
    <>
        <>
          {!d?.zones.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một KCN ở tab "Khu công nghiệp" trước khi thêm lộ.
            </div>
          )}
          <ZoneTables groups={lineGroupsShown} unit="lộ" loading={loading}
            empty={emptyText('lộ', 'Chưa có lộ đường dây nào được khai.')}
            rowKey={l => l.id}
            columns={<>
              <th className={`${TH_CLS} w-[18%] pl-10`}>Mã lộ</th>
              <th className={`${TH_CLS} w-[32%]`}>Tên lộ</th>
              <th className={`${TH_CLS} w-[10%]`}>Cấp điện áp</th>
              <th className={`${TH_CLS} w-[10%]`}>Số trạm</th>
              <th className={`${TH_CLS} w-[14%]`}>Tình trạng</th>
              <th className={`${TH_CLS} w-[16%] pr-10 text-right`}>Thao tác</th>
            </>}
            renderRow={l => (
              <tr className="transition-colors hover:bg-subtle/50">
                <td className="px-6 py-4 pl-10">
                  <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{l.code}</span>
                </td>
                <td className="truncate px-6 py-4 font-bold text-ink" title={l.name || ''}>{l.name || '—'}</td>
                <td className="px-6 py-4 text-sm text-soft">{l.voltage_level || '—'}</td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{stationsOfLine(l.id)}</td>
                <td className="px-6 py-4 text-sm">
                  {l.active === false
                    ? <span className="text-[11px] font-bold uppercase text-faint">Đã ngưng</span>
                    : <span className="text-[11px] font-bold uppercase text-[var(--success)]">Đang dùng</span>}
                </td>
                <td className="px-6 py-4 pr-10 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {/*
                      Gắn HÀNG LOẠT — mở từ đây chứ không phải form Trạm: gắn 133
                      trạm mà mỗi trạm mở form một lần thì không ai làm nổi.
                    */}
                    <button type="button" onClick={() => setAssigning(l)}
                      className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5"
                      title="Chọn nhiều trạm để gắn vào lộ này">
                      <Factory className="h-3.5 w-3.5" /> Gắn trạm
                    </button>
                    <RowActions onEdit={() => editLine(l)}
                      onDelete={() => void del(`lộ ${l.code}`, () => lines.remove(l.id),
                        stationsOfLine(l.id) > 0
                          ? `Lộ này đang có ${stationsOfLine(l.id)} trạm. Xóa lộ KHÔNG xóa trạm — các trạm đó về nhánh "Chưa gắn lộ".`
                          : undefined)} />
                  </div>
                </td>
              </tr>
            )} />
        </>
    </>
  );
}

export function LineForm(props: CatalogState) {
  const {
    lForm, setLForm, zoneOpts,
  } = props;
  return (
    <>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Khu công nghiệp" required>
              <Select value={lForm.zone} onChange={v => setLForm(f => ({ ...f, zone: v }))}
                options={zoneOpts} placeholder="Chọn KCN" searchable />
            </Field>
            <Field label="Mã lộ" required hint="Tên ngoài đời, gõ tay">
              <TextInput value={lForm.code} mono placeholder="471-E27.1"
                onChange={v => setLForm(f => ({ ...f, code: v }))} />
            </Field>
            <Field label="Cấp điện áp">
              <Select value={lForm.voltage_level}
                onChange={v => setLForm(f => ({ ...f, voltage_level: v as VoltageLevel }))}
                options={[{ value: 'MV', label: 'Trung áp (MV)' }, { value: 'LV', label: 'Hạ áp (LV)' }]} />
            </Field>
            <Field label="Tên lộ">
              <TextInput value={lForm.name} placeholder="Lộ 471 trạm 110kV Tiền Hải"
                onChange={v => setLForm(f => ({ ...f, name: v }))} />
            </Field>
            <Field label="Ghi chú">
              <TextInput value={lForm.note} placeholder="…"
                onChange={v => setLForm(f => ({ ...f, note: v }))} />
            </Field>
            {/* TẮT thay vì xoá: trạm từng gắn vào lộ vẫn phải tra lại được. */}
            <Field label="Tình trạng" hint="Lộ cắt/bỏ thì tắt, đừng xóa">
              <Select value={lForm.active ? '1' : '0'}
                onChange={v => setLForm(f => ({ ...f, active: v === '1' }))}
                options={[{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Đã ngưng' }]} />
            </Field>
          </div>
    </>
  );
}
