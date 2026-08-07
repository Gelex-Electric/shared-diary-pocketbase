/**
 * Màn hình ĐIỂM ĐO (v2).
 *
 * Ý đồ trình bày: mỗi dòng phải trả lời được ngay "điểm đo này lắp đủ chưa,
 * hệ số nhân bao nhiêu, có gì sai không" — vì đó chính là ba câu hỏi mà luật
 * R1–R7 đang canh. Bấm vào dòng để xem chi tiết thiết bị và diễn giải HSN.
 */
import { useState, useMemo } from 'react';
import { Search, Lock, AlertTriangle, CircleCheck, Gauge, X } from 'lucide-react';
import { useV2Data, DemoBanner, Badge, StatCard, POINT_STATUS_LABEL, viDate } from './shared';
import { buildPointViews, type PointView } from '../../lib/v2/data';
import { V2_ASSET_TYPE_LABEL, isMeter } from '../../lib/v2/schema';

export default function PointsScreen() {
  const { data, loading, reload } = useV2Data();
  const [term, setTerm] = useState('');
  const [zone, setZone] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const views = useMemo(() => buildPointViews(data), [data]);
  const zones = useMemo(
    () => [...new Set(data.points.map(p => p.zone_code).filter(Boolean))].sort(),
    [data.points],
  );

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return views.filter(v => {
      if (zone && v.point.zone_code !== zone) return false;
      if (onlyProblem && !v.locked && !v.incomplete) return false;
      if (!t) return true;
      return `${v.point.code} ${v.point.name} ${v.point.station_code}`.toLowerCase().includes(t)
        || v.assets.some(a => a.serial.toLowerCase().includes(t));
    });
  }, [views, term, zone, onlyProblem]);

  const stat = useMemo(() => ({
    total: views.length,
    running: views.filter(v => v.point.point_status === 'active').length,
    locked: views.filter(v => v.locked).length,
    incomplete: views.filter(v => v.incomplete && !v.locked).length,
  }), [views]);

  const detail = picked ? views.find(v => v.point.id === picked) ?? null : null;

  return (
    <div className="space-y-4">
      <DemoBanner data={data} onReload={reload} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Điểm đo" value={stat.total} />
        <StatCard label="Đang vận hành" value={stat.running} tone="ok" />
        <StatCard label="Khoá ghi (lắp sai)" value={stat.locked} tone="bad" />
        <StatCard label="Còn lắp dở" value={stat.incomplete} tone="warn" />
      </div>

      <div className="vl-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={term} onChange={e => setTerm(e.target.value)}
            placeholder="Tìm mã điểm đo, tên, trạm, số hiệu vật tư..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
          />
        </div>
        <select
          value={zone} onChange={e => setZone(e.target.value)}
          className="px-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
        >
          <option value="">Tất cả KCN</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <button
          onClick={() => setOnlyProblem(v => !v)}
          className={`px-3 py-2 rounded-lg border text-[13px] flex items-center gap-1.5 ${
            onlyProblem ? 'border-[var(--danger)] text-bad' : 'border-hair text-dim'
          }`}
        >
          <AlertTriangle className="w-4 h-4" /> Chỉ hiện điểm đo có vấn đề
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="vl-card overflow-x-auto">
          <table className="vl-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Điểm đo</th>
                <th className="text-left">Trạng thái</th>
                <th className="text-left">Công tơ</th>
                <th className="text-left">GP-03</th>
                <th className="text-left">TI / TU</th>
                <th className="text-right">Hệ số nhân</th>
                <th className="text-left">Tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(v => {
                const meter = v.assets.find(a => isMeter(a.type));
                const gp = v.assets.find(a => a.type === 'GP03');
                const ratioParts = v.assets.filter(a => a.type === 'TI' || a.type === 'TU');
                return (
                  <tr
                    key={v.point.id}
                    onClick={() => setPicked(v.point.id)}
                    className={`cursor-pointer ${picked === v.point.id ? 'bg-subtle' : ''}`}
                  >
                    <td>
                      <p className="font-medium">{v.point.code}</p>
                      <p className="text-[12px] text-faint">{v.point.name}</p>
                    </td>
                    <td className="text-dim">{POINT_STATUS_LABEL[v.point.point_status]}</td>
                    <td>
                      {meter
                        ? <span>{V2_ASSET_TYPE_LABEL[meter.type]} <span className="text-faint">{meter.serial}</span></span>
                        : <span className="text-faint">—</span>}
                    </td>
                    <td>{gp ? <span className="text-faint">{gp.serial}</span> : <span className="text-faint">—</span>}</td>
                    <td className="text-dim">
                      {ratioParts.length
                        ? `${ratioParts.length} cái · ${ratioParts[0].ratio_primary ?? '?'}/${ratioParts[0].ratio_secondary ?? '?'}`
                        : <span className="text-faint">không</span>}
                    </td>
                    <td className="text-right tnum">
                      {v.hsn.value ?? <span className="text-faint">—</span>}
                    </td>
                    <td>
                      {v.locked ? <Badge tone="bad">Khoá ghi</Badge>
                        : v.incomplete ? <Badge tone="warn">Lắp dở</Badge>
                        : <Badge tone="ok">Hợp lệ</Badge>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={7} className="py-10 text-center text-faint">
                  {loading ? 'Đang tải...' : 'Không có điểm đo nào khớp bộ lọc'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <PointDetail view={detail} onClose={() => setPicked(null)} />
      </div>
    </div>
  );
}

function PointDetail({ view, onClose }: { view: PointView | null; onClose: () => void }) {
  if (!view) {
    return (
      <div className="vl-card p-6 text-center text-faint text-[13px] hidden lg:block">
        <Gauge className="w-6 h-6 mx-auto mb-2 opacity-50" />
        Chọn một điểm đo để xem thiết bị đang treo và cách tính hệ số nhân.
      </div>
    );
  }
  const { point, assets, hsn, violations, locked } = view;
  return (
    <div className="vl-card p-4 space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="font-semibold">{point.code}</p>
          <p className="text-[12px] text-faint">{point.name} · {point.station_code} · {point.zone_code}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-subtle text-faint" aria-label="Đóng">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div>
        <p className="text-[12px] text-faint mb-1">Hệ số nhân (suy ra, không sửa tay)</p>
        <p className="text-[24px] font-semibold tnum">{hsn.value ?? '—'}</p>
        <p className="text-[12px] text-dim mt-1">{hsn.explain}</p>
      </div>

      <div>
        <p className="text-[12px] text-faint mb-1.5">Thiết bị đang treo ({assets.length})</p>
        {assets.length ? (
          <ul className="space-y-1.5">
            {assets.map(a => (
              <li key={a.id} className="flex items-center gap-2 text-[13px]">
                <Badge tone={isMeter(a.type) ? 'info' : 'muted'}>{V2_ASSET_TYPE_LABEL[a.type]}</Badge>
                <span className="flex-1">{a.serial}</span>
                {a.ratio_primary ? <span className="text-faint tnum">{a.ratio_primary}/{a.ratio_secondary}</span> : null}
                <span className="text-faint text-[12px]">{viDate(a.next_calibration)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-faint">Chưa treo thiết bị nào.</p>}
      </div>

      <div>
        <p className="text-[12px] text-faint mb-1.5">Soát luật</p>
        {violations.length ? (
          <ul className="space-y-1.5">
            {violations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                {v.level === 'sai'
                  ? <Lock className="w-4 h-4 text-bad shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />}
                <span><span className="text-faint">{v.rule}</span> {v.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ok flex items-center gap-1.5">
            <CircleCheck className="w-4 h-4" /> Không có vi phạm nào.
          </p>
        )}
        {locked && (
          <p className="mt-2 text-[12px] text-bad">
            Điểm đo bị khoá ghi: phải sửa các lỗi trên trước khi treo/tháo thêm.
          </p>
        )}
      </div>
    </div>
  );
}
