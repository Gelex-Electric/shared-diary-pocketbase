/**
 * Khối "NHU CẦU VẬT TƯ" (quy cách cần) của điểm đo — KINH DOANH khai ở form điểm
 * đo (user chốt lại 27/10/2026). Nhóm Vật Tư chỉ gắn số No dự kiến ở màn riêng.
 * `readOnly` để chỗ khác hiện bảng mà không sửa. Bỏ "Cần gấp" 27/10/2026.
 *
 * Tách khỏi `CatalogEntry.tsx` (đã > 3.000 dòng): form chỉ giữ mảng dòng và
 * gọi `needFromRows` lúc lưu. Đủ/thiếu tính ở `lib/dm/supply.ts`.
 *
 * Bảng + nút dùng lại khuôn bảng vật tư ngay bên dưới trong form (`Select`
 * variant bare, `CellInput`, `vl-btn`), không vẽ kiểu mới.
 */
import { Plus, Trash2, ClipboardList, Wand2 } from 'lucide-react';
import { Select } from '../ui/Select';
import { CellInput } from './entryUi';
import VariantCell from './VariantCell';
import { formatRatio, parseRatio } from '../../lib/dm/hsn';
import { useMemo } from 'react';
import { HAS_RATIO, cleanNeed, defaultNeed, needOverCap, supplyOfPoint, type LineSupply } from '../../lib/dm/supply';
import { ASSET_CAP } from '../../lib/dm/pointStatus';
import {
  ASSET_LABEL, CONNECTION_LABEL, DEFAULT_TI_SHAPE, SHAPE_LABEL, type Asset, type AssetType, type Connection, type Device, type NeedLine, type TiShape,
} from '../../lib/dm/types';

/** Một dòng trên form — tỷ số và số lượng giữ dạng CHUỖI cho ô nhập. */
export interface NeedRow {
  key: string;
  type: AssetType | '';
  ratio: string;
  shape: TiShape | '';
  meter_kind: Connection | '';
  qty: string;
}

let seq = 0;
const newRow = (n?: Partial<NeedLine>): NeedRow => ({
  key: `n${++seq}`,
  type: n?.type ?? '',
  ratio: formatRatio(n?.ratio_primary, n?.ratio_secondary),
  // Dòng MỚI điền sẵn hình dạng mặc định (tròn); dòng đã lưu giữ nguyên, kể cả "chưa chọn".
  shape: n ? ((n.shape as TiShape) || '') : DEFAULT_TI_SHAPE,
  meter_kind: (n?.meter_kind as Connection) || '',
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
      shape: r.shape, meter_kind: r.meter_kind, qty: parseInt(r.qty, 10),
    };
  }));
}

const TYPE_OPTS = (Object.keys(ASSET_LABEL) as AssetType[]).map(t => ({ value: t, label: ASSET_LABEL[t] }));

/** Chữ "kiểu" để xem: hình dạng TI / loại công tơ. */
const variantText = (r: NeedRow): string =>
  r.type === 'TI' ? (r.shape ? SHAPE_LABEL[r.shape] : '—')
    : r.type === 'CONGTO' ? (r.meter_kind ? CONNECTION_LABEL[r.meter_kind] : '—') : '—';

export default function PointNeedEditor({
  rows, onChange, hsn, connection, allocated, devices, readOnly = false,
}: {
  rows: NeedRow[];
  onChange: (rows: NeedRow[]) => void;
  /** HSN đang nhập — để gợi ý tỷ số TI. */
  hsn: number | null;
  connection: Connection;
  /**
   * Lần lắp ĐÃ LƯU của điểm đo (chưa tháo) — cột "Đã có" tính từ đây theo bảng
   * nhu cầu đang sửa. Không truyền (điểm đo mới) thì cột để trống.
   */
  allocated?: Asset[];
  devices: Device[];
  /** Chỉ xem — form điểm đo của Kinh Doanh (nhu cầu do Vật Tư khai). */
  readOnly?: boolean;
}) {
  const set = (key: string, patch: Partial<NeedRow>) =>
    onChange(rows.map(r => {
      if (r.key !== key) return r;
      const next = { ...r, ...patch };
      // Chọn "Công tơ" lần đầu ⇒ điền sẵn loại theo kiểu đấu nối của điểm đo.
      if (patch.type === 'CONGTO' && !next.meter_kind) next.meter_kind = connection;
      return next;
    }));
  const fillDefault = () => onChange(rowsFromNeed(defaultNeed(connection, hsn)));
  /** Đủ/thiếu theo từng dòng hợp lệ, tra theo `key` — dòng chưa chọn loại hay SL ≤ 0 không có. */
  const supply = useMemo(() => {
    const m = new Map<string, LineSupply>();
    if (!allocated) return m;
    const valid = rows.map(r => ({ key: r.key, n: needFromRows([r])[0] })).filter(x => x.n);
    supplyOfPoint(valid.map(x => x.n), allocated, devices).forEach((ls, i) => m.set(valid[i].key, ls));
    return m;
  }, [rows, allocated, devices]);
  /** Loại khai vượt trần vật tư hoạt động (12/11/2026) — chỉ cảnh báo, vẫn lưu được. */
  const over = useMemo(() => needOverCap(needFromRows(rows)), [rows]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
          <ClipboardList className="h-4 w-4" /> Nhu cầu vật tư
        </p>
        {readOnly && <span className="text-[11px] text-faint">Kinh Doanh khai ở form điểm đo</span>}
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
              <th className="px-2 py-3 text-left font-bold text-soft" title="TI: tròn / vuông · Công tơ: trực tiếp / gián tiếp">Kiểu</th>
              <th className="px-2 py-3 text-left font-bold text-soft">SL</th>
              <th className="px-2 py-3 text-left font-bold text-soft">Đã có</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[13px] italic text-faint">
                  {readOnly ? 'Kinh Doanh chưa khai nhu cầu cho điểm đo này.'
                    : 'Chưa khai nhu cầu — bấm "Điền theo HSN" để có sẵn bộ mặc định.'}
                </td>
              </tr>
            ) : rows.map(r => {
              const s = supply.get(r.key);
              return (
                <tr key={r.key}>
                  {readOnly ? (<>
                    <td className="px-4 py-2">{r.type ? ASSET_LABEL[r.type as AssetType] : '—'}</td>
                    <td className="px-4 py-2 font-mono">{HAS_RATIO.includes(r.type as AssetType) ? (r.ratio || '—') : '—'}</td>
                    <td className="px-2 py-2">{variantText(r)}</td>
                    <td className="px-2 py-2 text-center">{r.qty}</td>
                  </>) : (<>
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
                    <VariantCell type={r.type} shape={r.shape} meterKind={r.meter_kind}
                      onShape={shape => set(r.key, { shape })} onMeterKind={meter_kind => set(r.key, { meter_kind })} />
                  </td>
                  <td className="p-2">
                    <CellInput value={r.qty} type="number" align="center"
                      onChange={v => set(r.key, { qty: v })} />
                  </td>
                  </>)}
                  <td className="px-2 py-2 text-[12px]">
                    {!s ? <span className="text-faint">—</span>
                      : s.missing === 0 ? (
                        <span className="vl-badge-success">Đủ {s.have.length}</span>
                      ) : (
                        <span className="vl-badge-warning">Thiếu {s.missing}</span>
                      )}
                    {s && s.unsureShape > 0 && (
                      <span className="mt-1 block text-[11px] leading-snug text-faint">
                        {s.unsureShape} chưa rõ kiểu (hình dạng / loại)
                      </span>
                    )}
                    {r.type && over.has(r.type) && (
                      <span className="mt-1 block text-[11px] leading-snug text-warn">
                        Vượt trần {ASSET_CAP[r.type]}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {!readOnly && (
                      <button type="button" title="Bỏ dòng" className="text-faint hover:text-bad"
                        onClick={() => onChange(rows.filter(x => x.key !== r.key))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {over.size > 0 && (
        <p className="mt-2 text-[12px] text-warn">
          <b>Nhắc:</b> mỗi điểm đo chỉ hoạt động tối đa 1 đo xa GP-03, 1 công tơ, 3 TI — đang khai{' '}
          {[...over].map(([t, q]) => `${q} ${ASSET_LABEL[t]}`).join(', ')}. Vẫn lưu được, nhưng phần vượt trần
          không được đề xuất treo.
        </p>
      )}

      {!readOnly && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="vl-btn vl-btn-sm vl-btn-secondary flex items-center gap-1.5"
          onClick={() => onChange([...rows, newRow()])}>
          <Plus className="h-4 w-4" /> Thêm dòng
        </button>
        <button type="button" className="vl-btn vl-btn-sm vl-btn-outline-primary flex items-center gap-1.5"
          title="Gián tiếp: 3 TI (tỷ số theo HSN) + công tơ + GP-03 + SIM; trực tiếp: công tơ + GP-03 + SIM"
          onClick={fillDefault}>
          <Wand2 className="h-4 w-4" /> Điền theo HSN{rows.length ? ' (thay bảng)' : ''}
        </button>
      </div>}
    </div>
  );
}
