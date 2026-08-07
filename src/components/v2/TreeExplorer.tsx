/**
 * Màn hình chính Hồ sơ Kho: cây KCN → Trạm → Điểm đo bên trái, thẻ chi tiết
 * của phần tử đang chọn bên phải (user chốt bố cục 07/08).
 *
 * Cấp "Lộ đường dây" tạm chưa có vì dữ liệu `wh_point.line_name` còn trống —
 * cây đang 3 cấp, thêm cấp Lộ sau chỉ là chèn thêm một tầng gom nhóm.
 *
 * Cây mặc định THU GỌN: vài trăm điểm đo mà bung hết thì dài hơn màn hình và
 * khó dùng hơn bảng. Gõ vào ô tìm kiếm thì tự bung đúng nhánh có kết quả.
 */
import { useState, useMemo } from 'react';
import { ChevronRight, Search, MapPin, Building2, Gauge, RefreshCw } from 'lucide-react';
import { useWhData, ErrorBar, Badge, pbEmail } from './shared';
import NodeDetail, { type Selection } from './NodeDetail';
import { toAsset, pointStatusOf, NO_STATION, NO_ZONE, type WhPoint, type WhData } from '../../lib/v2/wh';
import { pointViolations } from '../../lib/v2/rules';
import { V2_PB_URL } from '../../lib/v2/pb';

export interface PointRow {
  point: WhPoint;
  assets: ReturnType<typeof toAsset>[];
  locked: boolean;
  incomplete: boolean;
}

export interface StationNode { code: string; points: PointRow[] }
export interface ZoneNode { code: string; stations: StationNode[]; pointCount: number }

/** Gom điểm đo thành cây và chạy luật một lần cho mọi màn hình con dùng lại. */
export function buildTree(data: WhData): { zones: ZoneNode[]; rows: Map<string, PointRow> } {
  const typeCode = new Map(data.deviceTypes.map(t => [t.id, t.code]));
  const byPoint = new Map<string, ReturnType<typeof toAsset>[]>();
  for (const d of data.devices) {
    if (!d.current_point || d.status !== 'dang_treo') continue;
    if (!byPoint.has(d.current_point)) byPoint.set(d.current_point, []);
    byPoint.get(d.current_point)!.push(toAsset(d, typeCode));
  }

  const rows = new Map<string, PointRow>();
  const zoneMap = new Map<string, Map<string, PointRow[]>>();

  for (const point of data.points) {
    const assets = byPoint.get(point.id) ?? [];
    const vs = pointViolations(pointStatusOf(point), assets);
    const row: PointRow = {
      point, assets,
      locked: vs.some(v => v.level === 'sai'),
      incomplete: vs.some(v => v.level === 'thieu'),
    };
    rows.set(point.id, row);

    const z = point.zone?.trim() || NO_ZONE;
    const s = point.station_code?.trim() || NO_STATION;
    if (!zoneMap.has(z)) zoneMap.set(z, new Map());
    const st = zoneMap.get(z)!;
    if (!st.has(s)) st.set(s, []);
    st.get(s)!.push(row);
  }

  const zones: ZoneNode[] = [...zoneMap.entries()]
    .map(([code, st]) => ({
      code,
      stations: [...st.entries()]
        .map(([sc, points]) => ({ code: sc, points }))
        .sort((a, b) => a.code.localeCompare(b.code, 'vi')),
      pointCount: [...st.values()].reduce((n, p) => n + p.length, 0),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'vi'));

  return { zones, rows };
}

export default function TreeExplorer() {
  const { data, loading, error, reload } = useWhData();
  const [term, setTerm] = useState('');
  const [openZones, setOpenZones] = useState<Set<string>>(new Set());
  const [openStations, setOpenStations] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Selection | null>(null);

  const { zones } = useMemo(() => buildTree(data), [data]);

  /** Lọc theo ô tìm kiếm; có từ khoá thì bung hết nhánh còn lại. */
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return zones;
    return zones
      .map(z => ({
        ...z,
        stations: z.stations
          .map(s => ({
            ...s,
            points: s.points.filter(r =>
              r.point.point_code.toLowerCase().includes(t)
              || (r.point.mba ?? '').toLowerCase().includes(t)
              || r.assets.some(a => a.serial.toLowerCase().includes(t))),
          }))
          .filter(s => s.points.length || s.code.toLowerCase().includes(t)),
      }))
      .filter(z => z.stations.length || z.code.toLowerCase().includes(t));
  }, [zones, term]);

  const searching = term.trim().length > 0;
  const zoneOpen = (c: string) => searching || openZones.has(c);
  const stationOpen = (k: string) => searching || openStations.has(k);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  const totalPoints = zones.reduce((n, z) => n + z.pointCount, 0);

  return (
    <div className="space-y-3">
      <div className="vl-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-[15px] font-semibold">Hồ sơ kho — sơ đồ đơn vị</h2>
          <p className="text-[12px] text-faint">
            {V2_PB_URL} · {pbEmail()} · {data.points.length} điểm đo · {data.devices.length} thiết bị
          </p>
        </div>
        <button onClick={reload} disabled={loading}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
        </button>
      </div>

      <ErrorBar message={error} />

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* ---------------- Cây ---------------- */}
        <div className="vl-card p-2 lg:sticky lg:top-4">
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={term} onChange={e => setTerm(e.target.value)}
              placeholder="Tìm điểm đo, MBA, số hiệu..."
              className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-inset border border-hair text-[12.5px]"
            />
          </div>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {shown.map(z => (
              <div key={z.code}>
                <button
                  onClick={() => { setSel({ kind: 'zone', key: z.code }); toggle(openZones, z.code, setOpenZones); }}
                  className={`w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-[13px] text-left hover:bg-subtle ${
                    sel?.kind === 'zone' && sel.key === z.code ? 'bg-subtle text-accent' : ''
                  }`}
                >
                  <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-faint transition-transform ${zoneOpen(z.code) ? 'rotate-90' : ''}`} />
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-faint" />
                  <span className="flex-1 truncate font-medium">{z.code}</span>
                  <span className="text-[11px] text-faint tnum">{z.pointCount}</span>
                </button>

                {zoneOpen(z.code) && z.stations.map(s => {
                  const key = `${z.code}/${s.code}`;
                  const bad = s.points.filter(p => p.locked).length;
                  return (
                    <div key={key}>
                      <button
                        onClick={() => { setSel({ kind: 'station', key, zone: z.code }); toggle(openStations, key, setOpenStations); }}
                        className={`w-full flex items-center gap-1.5 pl-5 pr-1.5 py-1.5 rounded-md text-[12.5px] text-left hover:bg-subtle ${
                          sel?.kind === 'station' && sel.key === key ? 'bg-subtle text-accent' : ''
                        }`}
                      >
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-faint transition-transform ${stationOpen(key) ? 'rotate-90' : ''}`} />
                        <Building2 className="w-3.5 h-3.5 shrink-0 text-faint" />
                        <span className="flex-1 truncate">{s.code}</span>
                        {bad > 0 && <span className="text-[11px] text-bad tnum">{bad}</span>}
                        <span className="text-[11px] text-faint tnum">{s.points.length}</span>
                      </button>

                      {stationOpen(key) && s.points.map(r => (
                        <button
                          key={r.point.id}
                          onClick={() => setSel({ kind: 'point', key: r.point.id, zone: z.code })}
                          className={`w-full flex items-center gap-1.5 pl-11 pr-1.5 py-1.5 rounded-md text-[12.5px] text-left hover:bg-subtle ${
                            sel?.kind === 'point' && sel.key === r.point.id ? 'bg-subtle text-accent' : ''
                          }`}
                        >
                          <Gauge className="w-3.5 h-3.5 shrink-0 text-faint" />
                          <span className="flex-1 truncate">{r.point.point_code}</span>
                          {r.locked ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)] shrink-0" />
                            : r.incomplete ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] shrink-0" />
                            : null}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}

            {!shown.length && (
              <p className="py-8 text-center text-[13px] text-faint">
                {loading ? 'Đang tải...' : totalPoints ? 'Không có kết quả khớp' : 'Chưa có điểm đo nào trong dữ liệu'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 px-2 pt-2 mt-1 border-t border-hair text-[11px] text-faint">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" /> lắp sai</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" /> lắp dở</span>
          </div>
        </div>

        {/* ---------------- Chi tiết ---------------- */}
        <NodeDetail data={data} zones={zones} sel={sel} loading={loading} />
      </div>
    </div>
  );
}

export { Badge };
