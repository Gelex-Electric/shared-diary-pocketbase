import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw, ChevronRight, Search, MapPin, Building2, Gauge,
  AlertTriangle, Network,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from '../ui/Select';
import { toast as notify } from '../../lib/toast';
import {
  fetchCatalog, type CatalogData, type Point, currentCustomerOf,
} from '../../lib/catalog';
import PointDetail from './PointDetail';

const EMPTY: CatalogData = { zones: [], stations: [], customers: [], points: [], periods: [] };

/**
 * Cây danh mục KCN → Trạm → Điểm đo (CHỈ ĐỌC — task 5).
 * Kéo thả sẽ thêm ở task 5b, xem plan §6.
 */
export default function CatalogTree() {
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [zoneFilter, setZoneFilter] = useState('');
  const [term, setTerm] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Point | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await fetchCatalog());
    } catch (err: any) {
      notify.show('error', 'Lỗi', 'Không tải được danh mục: ' + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) =>
    setOpenIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  /** Điểm đo khớp ô tìm kiếm (tìm cả theo mã KH / tên khách đang dùng). */
  const matches = useCallback((p: Point) => {
    const t = term.trim().toLowerCase();
    if (!t) return true;
    const cur = currentCustomerOf(data.periods, data.customers, p.id);
    const hay = `${p.line_id} ${p.line_name} ${cur?.period.mkh ?? ''} ${cur?.customer?.name ?? ''}`;
    return hay.toLowerCase().includes(t);
  }, [term, data]);

  /** Gom theo KCN → trạm → điểm đo; điểm đo chưa gắn trạm tách riêng. */
  const tree = useMemo(() => {
    const zones = data.zones.filter(z => !zoneFilter || z.code === zoneFilter);
    return zones.map(z => {
      const stations = data.stations
        .filter(s => s.zone === z.id)
        .map(s => ({ station: s, points: data.points.filter(p => p.station === s.id && matches(p)) }))
        .filter(x => x.points.length > 0 || !term.trim());
      const orphans = data.points.filter(p => p.zone === z.id && !p.station && matches(p));
      return { zone: z, stations, orphans };
    });
  }, [data, zoneFilter, term, matches]);

  const totalOrphans = useMemo(
    () => data.points.filter(p => !p.station).length,
    [data.points],
  );

  const PointRow = ({ p }: { p: Point }) => {
    const cur = currentCustomerOf(data.periods, data.customers, p.id);
    const isSel = selected?.id === p.id;
    return (
      <button
        onClick={() => setSelected(p)}
        className={`w-full text-left flex items-center gap-2 pl-12 pr-3 py-2 text-sm transition-colors ${
          isSel ? 'bg-accent-soft text-accent font-semibold' : 'text-dim hover:bg-subtle'
        }`}
      >
        <Gauge className="w-3.5 h-3.5 shrink-0 opacity-60" />
        <span className="font-mono text-xs shrink-0">{p.line_id}</span>
        <span className="truncate flex-1">{p.line_name || '—'}</span>
        {cur ? (
          <span className="font-mono text-[0.7rem] text-soft shrink-0">{cur.period.mkh}</span>
        ) : (
          <span className="text-[0.7rem] text-faint shrink-0">chưa có khách</span>
        )}
        {p.role === 'phu' && (
          <span className="text-[0.65rem] font-bold px-1.5 py-0.5 rounded bg-subtle text-faint shrink-0">PHỤ</span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-6">

      {/* Header + toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Danh mục điểm đo</h2>
          <p className="text-soft text-sm mt-1">
            Khu vực → Trạm → Điểm đo → Khách hàng. Dữ liệu từ PocketBase (chỉ đọc ở bản này).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input
              type="text" placeholder="Tìm điểm đo, mã KH, tên khách..."
              value={term} onChange={e => setTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none"
            />
          </div>
          <Select
            value={zoneFilter} onChange={setZoneFilter}
            options={[{ value: '', label: 'Tất cả khu vực' }, ...data.zones.map(z => ({ value: z.code, label: z.name }))]}
            className="min-w-[160px]"
          />
          <button onClick={load} className="p-2 rounded border border-[var(--border)] text-soft hover:bg-subtle transition-colors" title="Tải lại">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tổng quan */}
      {!isLoading && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.zones.length} khu vực</span>
          <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.stations.length} trạm</span>
          <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.points.length} điểm đo</span>
          <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.customers.length} khách hàng</span>
          {totalOrphans > 0 && (
            <span className="vl-badge-warning font-bold px-2 py-1 rounded flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />{totalOrphans} điểm đo chưa gắn trạm
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-faint">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải danh mục...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5 items-start">

          {/* Cột trái: cây */}
          <div className="vl-card overflow-hidden">
            {tree.map(({ zone, stations, orphans }) => (
              <div key={zone.id} className="border-b border-[var(--border)] last:border-b-0">

                {/* KCN */}
                <button
                  onClick={() => toggle(zone.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-subtle transition-colors"
                >
                  <ChevronRight className={`w-4 h-4 text-faint transition-transform ${openIds.has(zone.id) ? 'rotate-90' : ''}`} />
                  <MapPin className="w-4 h-4 text-accent shrink-0" />
                  <span className="font-bold text-ink flex-1 text-left">{zone.name}</span>
                  <span className="text-xs text-faint">{stations.length} trạm</span>
                </button>

                <AnimatePresence initial={false}>
                  {openIds.has(zone.id) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {/* Trạm */}
                      {stations.map(({ station, points }) => (
                        <div key={station.id}>
                          <button
                            onClick={() => toggle(station.id)}
                            className="w-full flex items-center gap-2 pl-8 pr-4 py-2 hover:bg-subtle transition-colors"
                          >
                            <ChevronRight className={`w-3.5 h-3.5 text-faint transition-transform ${openIds.has(station.id) ? 'rotate-90' : ''}`} />
                            <Building2 className="w-3.5 h-3.5 text-soft shrink-0" />
                            <span className="text-sm font-semibold text-dim flex-1 text-left truncate">{station.code}</span>
                            <span className="text-xs text-faint shrink-0">{points.length} điểm đo</span>
                            {!station.sdm_kva && (
                              <span className="text-[0.65rem] text-warn shrink-0" title="Chưa có thông số MBA">thiếu MBA</span>
                            )}
                          </button>
                          <AnimatePresence initial={false}>
                            {openIds.has(station.id) && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
                                className="overflow-hidden"
                              >
                                {points.map(p => <PointRow key={p.id} p={p} />)}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}

                      {/* Điểm đo chưa gắn trạm */}
                      {orphans.length > 0 && (
                        <div>
                          <button
                            onClick={() => toggle(zone.id + ':orphan')}
                            className="w-full flex items-center gap-2 pl-8 pr-4 py-2 hover:bg-subtle transition-colors"
                          >
                            <ChevronRight className={`w-3.5 h-3.5 text-faint transition-transform ${openIds.has(zone.id + ':orphan') ? 'rotate-90' : ''}`} />
                            <Network className="w-3.5 h-3.5 text-warn shrink-0" />
                            <span className="text-sm font-semibold text-warn flex-1 text-left">Chưa gắn trạm</span>
                            <span className="text-xs text-faint">{orphans.length}</span>
                          </button>
                          <AnimatePresence initial={false}>
                            {openIds.has(zone.id + ':orphan') && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
                                className="overflow-hidden"
                              >
                                {orphans.map(p => <PointRow key={p.id} p={p} />)}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

          {/* Cột phải: chi tiết */}
          <div className="lg:sticky lg:top-4">
            <PointDetail point={selected} data={data} />
          </div>
        </div>
      )}
    </div>
  );
}
