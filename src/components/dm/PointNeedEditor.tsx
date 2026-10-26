/**
 * Khối "NHU CẦU VẬT TƯ" trong form điểm đo — Kinh Doanh khai điểm đo mới cần
 * gì (bước B2, plan `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md`).
 *
 * Tách khỏi `CatalogEntry.tsx` (đã > 3.000 dòng): form chỉ giữ mảng dòng và
 * gọi `needFromRows` lúc lưu. Đủ/thiếu tính ở `lib/dm/supply.ts`.
 *
 * Bảng + nút dùng lại khuôn bảng vật tư ngay bên dưới trong form (`Select`
 * variant bare, `CellInput`, `vl-btn`), không vẽ kiểu mới.
 */
import { Plus, Trash2, ClipboardList, Wand2 } from 'lucide-react';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { DatePicker } from '../ui/DateTimePickers';
import { CellInput } from './entryUi';
import { formatRatio, parseRatio } from '../../lib/dm/hsn';
import { useMemo } from 'react';
import { HAS_RATIO, cleanNeed, defaultNeed, supplyOfPoint, type LineSupply } from '../../lib/dm/supply';
import {
  ASSET_LABEL, SHAPE_LABEL, type Asset, type AssetType, type Connection, type Device, type NeedLine, type TiShape,
} from '../../lib/dm/types';

/** Một dòng trên form — tỷ số và số lượng giữ dạng CHUỖI cho ô nhập. */
export interface NeedRow {
  key: string;
  type: AssetType | '';
  ratio: string;
  shape: TiShape | '';
  qty: string;
}

let seq = 0;
const newRow = (n?: Partial<NeedLine>): NeedRow => ({
  key: `n${++seq}`,
  type: n?.type ?? '',
  ratio: formatRatio(n?.ratio_primary, n?.ratio_secondary),
  shape: (n?.shape as TiShape) || '',
  qty: n?.qty != null ? String(n.qty) : '1',
});

export const rowsFromNeed = (need?: NeedLine[] | null): NeedRow[] => (need ?? []).map(newRow);

/** Đổi về dạng lưu; dòng chưa chọn loại hoặc số lượng ≤ 0 bị bỏ (`cleanNeed`). */
export function needFromRows(rows: NeedRow[]): NeedLine[] {
  return cleanNeed(rows.filter(r => r.type).map(r => {
    const { primary, secondary } = parseRatio(r.ratio);
    return {
      type: r.type as AssetType,
      ratio_primary: primary, ratio_secondary: secondary,
      shape: r.shape, qty: parseInt(r.qty, 10),
    };
  }));
}

const TYPE_OPTS = (Object.keys(ASSET_LABEL) as AssetType[]).map(t => ({ value: t, label: ASSET_LABEL[t] }));
const SHAPE_OPTS = [
  { value: '', label: 'Chưa chọn' },
  ...(Object.keys(SHAPE_LABEL) as TiShape[]).map(s => ({ value: s, label: SHAPE_LABEL[s] })),
];

export default function PointNeedEditor({
  rows, onChange, urgent, onUrgent, neededBy, onNeededBy, hsn, connection, allocated, devices,
}: {
  rows: NeedRow[];
  onChange: (rows: NeedRow[]) => void;
  urgent: boolean;
  onUrgent: (v: boolean) => void;
  neededBy: string;
  onNeededBy: (v: string) => void;
  /** HSN đang nhập — để gợi ý tỷ số TI. */
  hsn: number | null;
  connection: Connection;
  /**
   * Lần lắp ĐÃ LƯU của điểm đo (chưa tháo) — cột "Đã có" tính từ đây theo bảng
   * nhu cầu đang sửa. Không truyền (điểm đo mới) thì cột để trống.
   */
  allocated?: Asset[];
  devices: Device[];
}) {
  const set = (key: string, patch: Partial<NeedRow>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const fillDefault = () => onChange(rowsFromNeed(defaultNeed(connection, hsn)));
  /** Đủ/thiếu theo từng dòng hợp lệ, tra theo `key` — dòng chưa chọn loại hay SL ≤ 0 không có. */
  const supply = useMemo(() => {
    const m = new Map<string, LineSupply>();
    if (!allocated) return m;
    const valid = rows.map(r => ({ key: r.key, n: needFromRows([r])[0] })).filter(x => x.n);
    supplyOfPoint(valid.map(x => x.n), allocated, devices).forEach((ls, i) => m.set(valid[i].key, ls));
    return m;
  }, [rows, allocated, devices]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
          <ClipboardList className="h-4 w-4" /> Nhu cầu vật tư
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Switch checked={urgent} onChange={onUrgent} label="Cần gấp"
            title="Đưa lên đầu danh sách của Nhóm Vật Tư, cho phép mượn vật tư dự kiến của điểm đo khác" />
          {urgent && (
            <div className="w-[170px]">
              <DatePicker value={neededBy} onChange={onNeededBy} usePortal />
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-surface">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead className="border-b border-[var(--border)] bg-subtle">
            <tr>
              <th className="px-4 py-3 text-left font-bold text-soft">Loại</th>
              <th className="px-4 py-3 text-left font-bold text-soft">Tỷ số</th>
              <th className="px-2 py-3 text-left font-bold text-soft">Hình dạng</th>
              <th className="px-2 py-3 text-left font-bold text-soft">SL</th>
              <th className="px-2 py-3 text-left font-bold text-soft">Đã có</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[13px] italic text-faint">
                  Chưa khai nhu cầu — bấm "Điền theo HSN" để có sẵn bộ mặc định.
                </td>
              </tr>
            ) : rows.map(r => {
              const s = supply.get(r.key);
              return (
                <tr key={r.key}>
                  <td className="p-2">
                    <Select value={r.type} variant="bare" options={TYPE_OPTS} placeholder="Chọn loại"
                      onChange={v => set(r.key, { type: v as AssetType })} />
                  </td>
                  <td className="p-2">
                    {HAS_RATIO.includes(r.type as AssetType) ? (
                      <CellInput value={r.ratio} mono placeholder="1000/5"
                        onChange={v => set(r.key, { ratio: v })} />
                    ) : <span className="block p-2 text-faint">—</span>}
                  </td>
                  <td className="p-2">
                    {r.type === 'TI' ? (
                      <Select value={r.shape} variant="bare" options={SHAPE_OPTS}
                        onChange={v => set(r.key, { shape: v as TiShape | '' })} />
                    ) : <span className="block p-2 text-faint">—</span>}
                  </td>
                  <td className="p-2">
                    <CellInput value={r.qty} type="number" align="center"
                      onChange={v => set(r.key, { qty: v })} />
                  </td>
                  <td className="px-2 py-2 text-[12px]">
                    {!s ? <span className="text-faint">—</span>
                      : s.missing === 0 ? (
                        <span className="vl-badge-success">Đủ {s.have.length}</span>
                      ) : (
                        <span className="vl-badge-warning">Thiếu {s.missing}</span>
                      )}
                    {s && s.unsureShape > 0 && (
                      <span className="mt-1 block text-[11px] leading-snug text-faint">
                        {s.unsureShape} TI chưa rõ hình dạng
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    <button type="button" title="Bỏ dòng" className="text-faint hover:text-bad"
                      onClick={() => onChange(rows.filter(x => x.key !== r.key))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="vl-btn vl-btn-sm vl-btn-secondary flex items-center gap-1.5"
          onClick={() => onChange([...rows, newRow()])}>
          <Plus className="h-4 w-4" /> Thêm dòng
        </button>
        <button type="button" className="vl-btn vl-btn-sm vl-btn-outline-primary flex items-center gap-1.5"
          title="Gián tiếp: 3 TI (tỷ số theo HSN) + công tơ + GP-03 + SIM; trực tiếp: công tơ + GP-03 + SIM"
          onClick={fillDefault}>
          <Wand2 className="h-4 w-4" /> Điền theo HSN{rows.length ? ' (thay bảng)' : ''}
        </button>
      </div>
    </div>
  );
}
