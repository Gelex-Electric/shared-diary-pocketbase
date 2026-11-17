/**
 * Tab Khách hàng của màn Danh mục: bảng + nội dung form.
 * Tách khỏi `CatalogEntry.tsx` ngày 17/11/2026 (plan `2026-11-17-tach-catalog-entry.md`,
 * đợt 5) — JSX NGUYÊN VĂN; state + logic ở `useCatalog.ts`, truyền vào bằng `{...cat}`.
 */
import {
  RefreshCw,
} from 'lucide-react';
import { Select } from '../../ui/Select';
import { customers } from '../../../lib/dm/repo';
import {
  Field, TextInput, TH_CLS,
} from '../entryUi';
import { ISSUE_LABEL, toLowName } from '../../../lib/dm/lowName';
import { ZoneTables } from '../ZoneTables';
import {
  SHORT_NAME_HINT,
  normalizeShortName,
} from '../../../lib/dm/naming';
import { RowActions } from './RowActions';
import type { CatalogState } from './useCatalog';

export function CustomerTable(props: CatalogState) {
  const {
    customerGroupsShown, loading, emptyText, zoneName, pointsOfCustomer, editCustomer, del,
  } = props;
  return (
    <>
        <ZoneTables groups={customerGroupsShown} unit="khách hàng" loading={loading}
          empty={emptyText('khách hàng', 'Chưa có khách hàng nào được khai.')}
          rowKey={c => c.id}
          columns={<>
            <th className={`${TH_CLS} w-[12%] pl-10`}>Mã KH</th>
            <th className={`${TH_CLS} w-[27%]`}>Tên khách hàng</th>
            <th className={`${TH_CLS} w-[11%]`}>Tên tắt</th>
            <th className={`${TH_CLS} w-[14%]`}>Khu công nghiệp</th>
            <th className={`${TH_CLS} w-[20%]`}>Địa chỉ</th>
            <th className={`${TH_CLS} w-[8%]`}>Điểm đo</th>
            <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
          </>}
          renderRow={c => (
            <tr className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-10">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{c.mkh}</span>
              </td>
              <td className="truncate px-6 py-4 font-bold text-ink" title={c.name}>{c.name}</td>
              <td className="px-6 py-4">
                {c.short_name
                  ? <span className="font-mono text-xs font-bold text-dim">{c.short_name}</span>
                  : <span className="text-[11px] italic text-warn">chưa khai</span>}
              </td>
              <td className="px-6 py-4 text-sm text-soft">{c.zone ? zoneName(c.zone) : '—'}</td>
              <td className="truncate px-6 py-4 text-sm text-soft" title={c.address || ''}>{c.address || '—'}</td>
              <td className="px-6 py-4 text-sm font-semibold text-dim">{pointsOfCustomer(c.id)}</td>
              <td className="px-6 py-4 pr-10 text-right">
                <RowActions onEdit={() => editCustomer(c)}
                  onDelete={() => void del(`khách hàng ${c.mkh}`, () => customers.remove(c.id),
                    pointsOfCustomer(c.id) > 0
                      ? `Khách hàng này đang gắn ${pointsOfCustomer(c.id)} điểm đo. Xóa KH KHÔNG xóa điểm đo — chúng sẽ không còn chủ.`
                      : undefined)} />
              </td>
            </tr>
          )} />
    </>
  );
}

export function CustomerForm(props: CatalogState) {
  const {
    cForm, setCForm, zoneOpts, lowNameCheck,
  } = props;
  return (
    <>
          <>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Mã khách hàng" required>
                <TextInput value={cForm.mkh} mono placeholder="KCNTH-001"
                  onChange={v => setCForm(f => ({ ...f, mkh: v }))} />
              </Field>
              <Field label="Khu công nghiệp" hint="Không bắt buộc">
                <Select value={cForm.zone} onChange={v => setCForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chưa gắn" searchable />
              </Field>
              <Field label="Tên tắt khách hàng" hint={`${SHORT_NAME_HINT} Dùng để sinh mã trạm.`}>
                {/* Chuẩn hoá ngay khi gõ: bỏ dấu, viết hoa, loại ký tự lạ. */}
                <TextInput value={cForm.short_name} mono placeholder="RICO"
                  onChange={v => setCForm(f => ({ ...f, short_name: normalizeShortName(v) }))} />
              </Field>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Tên khách hàng" required>
                {/* Chỉ mồi ô viết thường khi nó đang TRỐNG. Đã có nội dung thì
                    không đụng: đó là bản người dùng soạn, hạ hoa là phá. */}
                <TextInput value={cForm.name} placeholder="CÔNG TY TNHH…"
                  onChange={v => setCForm(f => ({
                    ...f, name: v,
                    low_name: f.low_name.trim() ? f.low_name : toLowName(v),
                  }))} />
              </Field>
              <Field label="Địa chỉ">
                <TextInput value={cForm.address} onChange={v => setCForm(f => ({ ...f, address: v }))} />
              </Field>
            </div>
            <Field label="Tên viết thường"
              hint={lowNameCheck.issue === 'ok'
                ? 'Cùng chữ với tên khách hàng. Viết hoa thế nào là tùy bạn — không xét hoa/thường.'
                : `${ISSUE_LABEL[lowNameCheck.issue]} — ${lowNameCheck.detail}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput value={cForm.low_name} placeholder="công ty tnhh…"
                    onChange={v => setCForm(f => ({ ...f, low_name: v }))} />
                </div>
                {/* Ghi đè bản đã soạn, nên chỉ mở khi đang sai CHỮ hoặc còn trống. */}
                <button type="button" title="Thay bằng tên gốc hạ chữ hoa"
                  disabled={lowNameCheck.issue === 'ok' || lowNameCheck.issue === 'space'}
                  onClick={() => setCForm(f => ({ ...f, low_name: toLowName(f.name) }))}
                  className="vl-btn vl-btn-secondary flex shrink-0 items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Lấy từ tên
                </button>
              </div>
            </Field>
          </>
    </>
  );
}
