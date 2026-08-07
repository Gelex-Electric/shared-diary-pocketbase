/**
 * Màn hình VẬT TƯ của Hồ sơ Kho — đọc thẳng `wh_device` trên production.
 *
 * Sắp theo câu hỏi của người giữ kho: còn bao nhiêu cái mỗi loại, cái nào sắp
 * hết hạn kiểm định, cái nào đang treo ở đâu. Hạn kiểm định tô màu theo mốc 60
 * ngày vì đó là thứ quyết định được phép treo hay không (luật R7).
 */
import { useState, useMemo } from 'react';
import { Search, Package, RefreshCw } from 'lucide-react';
import {
  useWhData, ErrorBar, Badge, StatCard, ASSET_STATUS_LABEL, viDate,
} from './shared';
import { toAsset } from '../../lib/v2/wh';
import { isOverdue } from '../../lib/v2/rules';
import { V2_ASSET_TYPES, V2_ASSET_TYPE_LABEL, isMeter, type V2AssetType } from '../../lib/v2/schema';

/** Còn ≤ 60 ngày là sắp hết hạn — đủ thời gian gửi kiểm định trước khi phải tháo. */
function calibrationTone(next?: string): 'bad' | 'warn' | 'muted' {
  const d = (next || '').slice(0, 10);
  if (!d) return 'muted';
  const days = (new Date(d).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'bad';
  return days <= 60 ? 'warn' : 'muted';
}

export default function AssetsScreen() {
  const { data, loading, error, reload } = useWhData();
  const [term, setTerm] = useState('');
  const [type, setType] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const assets = useMemo(() => {
    const typeCode = new Map(data.deviceTypes.map(t => [t.id, t.code]));
    return data.devices.map(d => ({ asset: toAsset(d, typeCode), device: d }));
  }, [data]);

  const pointCode = useMemo(
    () => new Map(data.points.map(p => [p.id, p.point_code])),
    [data.points],
  );
  const whName = useMemo(
    () => new Map(data.warehouses.map(w => [w.id, w.name])),
    [data.warehouses],
  );

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return assets.filter(({ asset }) => {
      if (type && asset.type !== type) return false;
      if (status && asset.current_status !== status) return false;
      if (t && !asset.serial.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [assets, term, type, status]);

  const stat = useMemo(() => ({
    total: assets.length,
    inStock: assets.filter(x => x.asset.current_status === 'kho').length,
    hanging: assets.filter(x => x.asset.current_status === 'dang_treo').length,
    overdue: assets.filter(x => isOverdue(x.asset)).length,
  }), [assets]);

  const countByType = useMemo(() => {
    const c = new Map<V2AssetType, number>();
    for (const { asset } of assets) {
      if (asset.current_status !== 'kho') continue;
      c.set(asset.type, (c.get(asset.type) ?? 0) + 1);
    }
    return c;
  }, [assets]);

  return (
    <div className="space-y-4">
      <div className="vl-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[15px] font-semibold">Vật tư trong kho</h2>
          <p className="text-[12px] text-faint">Đọc thẳng wh_device trên PocketBase production</p>
        </div>
        <button onClick={reload} disabled={loading}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
        </button>
      </div>

      <ErrorBar message={error} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Tổng thiết bị" value={stat.total} />
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
            placeholder="Tìm số hiệu thiết bị..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
          />
        </div>
        <select
          value={status} onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
        >
          <option value="">Mọi trạng thái</option>
          {(['kho', 'dang_treo', 'thanh_ly'] as const).map(s =>
            <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>)}
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
              <th className="text-left">Đang ở</th>
              <th className="text-left">Hạn kiểm định</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ asset, device }) => (
              <tr key={asset.id}>
                <td className="font-medium">{asset.serial}</td>
                <td><Badge tone={isMeter(asset.type) ? 'info' : 'muted'}>{V2_ASSET_TYPE_LABEL[asset.type]}</Badge></td>
                <td className="tnum text-dim">
                  {asset.ratio_primary ? `${asset.ratio_primary}/${asset.ratio_secondary}` : <span className="text-faint">—</span>}
                </td>
                <td className="text-dim">{ASSET_STATUS_LABEL[asset.current_status]}</td>
                <td className="text-dim">
                  {device.current_point ? pointCode.get(device.current_point) ?? '—'
                    : device.current_warehouse ? whName.get(device.current_warehouse) ?? '—'
                    : <span className="text-faint">—</span>}
                </td>
                <td>
                  {asset.next_calibration
                    ? <Badge tone={calibrationTone(asset.next_calibration)}>{viDate(asset.next_calibration)}</Badge>
                    : <span className="text-faint">—</span>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="py-10 text-center text-faint">
                {loading ? 'Đang tải...' : 'Không có thiết bị nào khớp bộ lọc'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
