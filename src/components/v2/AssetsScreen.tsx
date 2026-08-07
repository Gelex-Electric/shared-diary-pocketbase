/**
 * Màn hình VẬT TƯ (v2).
 *
 * Sắp theo câu hỏi của người giữ kho: còn bao nhiêu cái mỗi loại, cái nào sắp
 * hết hạn kiểm định, cái nào đang treo ở đâu. Hạn kiểm định để cột riêng và tô
 * màu theo mốc 60 ngày vì đó là thứ quyết định được phép treo hay không (R7).
 */
import { useState, useMemo } from 'react';
import { Search, Package } from 'lucide-react';
import { useV2Data, DemoBanner, Badge, StatCard, ASSET_STATUS_LABEL, viDate } from './shared';
import { pointOfAsset } from '../../lib/v2/data';
import { isOverdue } from '../../lib/v2/rules';
import {
  V2_ASSET_TYPES, V2_ASSET_TYPE_LABEL, isMeter,
  type V2AssetStatus, type V2AssetType,
} from '../../lib/v2/schema';

const STATUSES: V2AssetStatus[] = [
  'kho', 'dat', 'dang_treo', 'cho_kiem_dinh', 'dang_kiem_dinh', 'khong_dat', 'thanh_ly',
];

/** Còn ≤ 60 ngày là sắp hết hạn — đủ thời gian gửi đi kiểm định trước khi phải tháo. */
function calibrationTone(next?: string): 'bad' | 'warn' | 'muted' {
  const d = (next || '').slice(0, 10);
  if (!d) return 'muted';
  const days = (new Date(d).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'bad';
  return days <= 60 ? 'warn' : 'muted';
}

export default function AssetsScreen() {
  const { data, loading, reload } = useV2Data();
  const [term, setTerm] = useState('');
  const [type, setType] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return data.assets.filter(a => {
      if (type && a.type !== type) return false;
      if (status && a.current_status !== status) return false;
      if (t && !a.serial.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [data.assets, term, type, status]);

  const stat = useMemo(() => {
    const inStock = data.assets.filter(a => a.current_status === 'kho' || a.current_status === 'dat');
    return {
      total: data.assets.length,
      inStock: inStock.length,
      hanging: data.assets.filter(a => a.current_status === 'dang_treo').length,
      overdue: data.assets.filter(a => isOverdue(a)).length,
    };
  }, [data.assets]);

  const countByType = useMemo(() => {
    const c = new Map<V2AssetType, number>();
    for (const a of data.assets) {
      if (a.current_status !== 'kho' && a.current_status !== 'dat') continue;
      c.set(a.type, (c.get(a.type) ?? 0) + 1);
    }
    return c;
  }, [data.assets]);

  return (
    <div className="space-y-4">
      <DemoBanner data={data} onReload={reload} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Tổng vật tư" value={stat.total} />
        <StatCard label="Đang trong kho" value={stat.inStock} tone="ok" />
        <StatCard label="Đang treo" value={stat.hanging} />
        <StatCard label="Quá hạn kiểm định" value={stat.overdue} tone="bad" />
      </div>

      <div className="vl-card p-3">
        <p className="text-[12px] text-faint mb-2 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Tồn kho theo loại
        </p>
        <div className="flex flex-wrap gap-2">
          {V2_ASSET_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setType(type === t ? '' : t)}
              className={`px-3 py-1.5 rounded-lg border text-[13px] flex items-center gap-2 ${
                type === t ? 'border-[var(--accent)] text-accent' : 'border-hair text-dim'
              }`}
            >
              {V2_ASSET_TYPE_LABEL[t]}
              <span className="tnum font-semibold">{countByType.get(t) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="vl-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={term} onChange={e => setTerm(e.target.value)}
            placeholder="Tìm số hiệu vật tư..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
          />
        </div>
        <select
          value={status} onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
        >
          <option value="">Mọi trạng thái</option>
          {STATUSES.map(s => <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <div className="vl-card overflow-x-auto">
        <table className="vl-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">Số hiệu</th>
              <th className="text-left">Loại</th>
              <th className="text-left">Tỷ số</th>
              <th className="text-left">Trạng thái</th>
              <th className="text-left">Đang treo tại</th>
              <th className="text-left">Hạn kiểm định</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const p = pointOfAsset(data, a.id);
              const tone = calibrationTone(a.next_calibration);
              return (
                <tr key={a.id}>
                  <td className="font-medium">{a.serial}</td>
                  <td><Badge tone={isMeter(a.type) ? 'info' : 'muted'}>{V2_ASSET_TYPE_LABEL[a.type]}</Badge></td>
                  <td className="tnum text-dim">
                    {a.ratio_primary ? `${a.ratio_primary}/${a.ratio_secondary}` : <span className="text-faint">—</span>}
                  </td>
                  <td className="text-dim">{ASSET_STATUS_LABEL[a.current_status]}</td>
                  <td className="text-dim">{p ? p.code : <span className="text-faint">—</span>}</td>
                  <td>
                    {a.next_calibration
                      ? <Badge tone={tone}>{viDate(a.next_calibration)}</Badge>
                      : <span className="text-faint">không kiểm định</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={6} className="py-10 text-center text-faint">
                {loading ? 'Đang tải...' : 'Không có vật tư nào khớp bộ lọc'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
