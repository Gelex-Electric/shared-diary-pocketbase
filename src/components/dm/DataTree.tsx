/**
 * Màn "Quản lý chung" — cây ĐƠN VỊ theo DỮ LIỆU THẬT trong PocketBase:
 *
 *   KCN (dm_zone)
 *    └── Trạm (dm_station)
 *         └── Điểm đo (dm_point)  — kèm khách hàng, chính/phụ, đấu nối, HSN
 *
 * Không mô tả schema — mỗi nút là một BẢN GHI thật. Bản ghi mất cha (trạm không
 * còn KCN, điểm đo không còn trạm) gom vào nhánh "Chưa gắn" ở cuối để không bị
 * khuất — quan hệ đặt `cascadeDelete=false` nên tình huống này có thể xảy ra.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Factory, Gauge, ChevronRight, RefreshCw, Search,
  FoldVertical, UnfoldVertical, AlertTriangle, CornerDownRight,
} from 'lucide-react';
import { loadCatalog, pbErrorMessage } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { CONNECTION_LABEL, ROLE_LABEL, STATUS_LABEL } from '../../lib/dm/types';
import type { Point, Station, Zone } from '../../lib/dm/types';
import { kcnColorOf } from '../../lib/kcnColors';
import { PointBadgeIcon } from './pointIcons';

/**
 * Xếp điểm đo trong một trạm theo phân cấp: mỗi điểm chính kéo theo các điểm
 * phụ của nó (thụt lề). Điểm phụ chưa gán cha xếp cuối để không bị mất.
 */
function orderPoints(list: Point[]): { point: Point; isChild: boolean }[] {
  const rows: { point: Point; isChild: boolean }[] = [];
  const placed = new Set<string>();
  for (const p of list.filter(x => x.role === 'chinh')) {
    rows.push({ point: p, isChild: false });
    placed.add(p.id);
    for (const child of list.filter(x => x.parent_point === p.id)) {
      rows.push({ point: child, isChild: true });
      placed.add(child.id);
    }
  }
  for (const p of list) if (!placed.has(p.id)) rows.push({ point: p, isChild: false });
  return rows;
}

/** Nút bấm mở/đóng — mũi tên xoay, vùng bấm rộng cả hàng. */
function Caret({ open, hidden }: { open: boolean; hidden?: boolean }) {
  if (hidden) return <span className="w-4 shrink-0" />;
  return (
    <ChevronRight
      className={`h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
    />
  );
}

function Count({ n, label, hex }: { n: number; label: string; hex: string }) {
  return (
    <span
      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold"
      style={{ backgroundColor: `${hex}1f`, color: hex }}
    >
      {n} {label}
    </span>
  );
}

export default function DataTree() {
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await loadCatalog();
      setData(d);
      // Mở sẵn cấp KCN để nhìn thấy ngay có gì.
      setOpenIds(new Set(d.zones.map(z => z.id)));
    } catch (e) {
      setError(pbErrorMessage(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const toggle = (id: string) =>
    setOpenIds(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const customerOf = (p: Point) => data?.customers.find(c => c.id === p.customer);

  /* --------- lọc theo ô tìm kiếm, giữ nguyên cấu trúc cha-con --------- */
  const q = query.trim().toLowerCase();
  const matchPoint = (p: Point) => {
    if (!q) return true;
    const c = customerOf(p);
    return [p.line_id, p.line_name, c?.mkh, c?.name].some(x => x?.toLowerCase().includes(q));
  };
  const matchStation = (s: Station) => !q || s.code.toLowerCase().includes(q);
  const matchZone = (z: Zone) =>
    !q || z.code.toLowerCase().includes(q) || z.name.toLowerCase().includes(q);

  const tree = useMemo(() => {
    if (!data) return [];
    return data.zones.map(z => {
      const sts = data.stations
        .filter(s => s.zone === z.id)
        .map(s => ({
          station: s,
          points: data.points.filter(p => p.station === s.id),
        }));
      return { zone: z, stations: sts };
    });
  }, [data]);

  /** Nhánh giữ lại khi lọc: khớp chính nó, hoặc có con khớp. */
  const visibleTree = useMemo(() => tree
    .map(({ zone, stations }) => {
      const zoneHit = matchZone(zone);
      const sts = stations
        .map(({ station, points }) => {
          const stationHit = matchStation(station);
          const pts = points.filter(p => zoneHit || stationHit || matchPoint(p));
          return { station, points: pts, keep: zoneHit || stationHit || pts.length > 0 };
        })
        .filter(s => s.keep);
      return { zone, stations: sts, keep: zoneHit || sts.length > 0 };
    })
    .filter(z => z.keep),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tree, q, data]);

  /* ------------------------ bản ghi mất cha ------------------------ */
  const orphanStations = useMemo(
    () => (data?.stations ?? []).filter(s => !data?.zones.some(z => z.id === s.zone)), [data]);
  const orphanPoints = useMemo(
    () => (data?.points ?? []).filter(p => !data?.stations.some(s => s.id === p.station)), [data]);

  const totalPoints = data?.points.length ?? 0;
  const isEmpty = !loading && !error && (data?.zones.length ?? 0) === 0
    && orphanStations.length === 0 && orphanPoints.length === 0;

  /* -------------------------- hàng điểm đo -------------------------- */
  const PointRow = ({ p, isChild }: { p: Point; isChild?: boolean }) => {
    const c = customerOf(p);
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-lg py-2 pr-3 transition-colors hover:bg-subtle ${
        isChild ? 'pl-9' : 'pl-3'
      }`}>
        {isChild && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-faint" />}
        <PointBadgeIcon point={p} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${isChild ? 'text-dim' : 'font-semibold text-ink'}`}>
          {p.code || p.line_name || p.line_id}
        </span>

        <span className={p.role === 'chinh' ? 'vl-badge-primary' : 'vl-badge-info'}>
          {ROLE_LABEL[p.role]}
        </span>
        <span className={p.connection === 'gian_tiep' ? 'vl-badge-warning' : 'vl-badge-success'}>
          {CONNECTION_LABEL[p.connection]}
        </span>
        <span className="rounded-md bg-subtle px-2 py-0.5 text-[11px] font-bold text-soft">
          HSN {p.hsn ?? '—'}
        </span>
        {p.status && (
          <span className="text-[11px] font-semibold text-faint">
            {STATUS_LABEL[p.status as keyof typeof STATUS_LABEL]}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-soft">
          {c ? <><span className="font-mono font-bold">{c.mkh}</span> · {c.name}</> : <i className="text-faint">chưa gắn KH</i>}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm KCN, trạm, điểm đo, khách hàng…"
            className="w-full rounded-lg border border-[var(--border)] bg-surface py-2.5 pl-10 pr-3 text-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent placeholder:text-faint"
          />
        </div>
        <button onClick={() => setOpenIds(new Set([
          ...(data?.zones ?? []).map(z => z.id),
          ...(data?.stations ?? []).map(s => s.id),
        ]))} className="vl-btn vl-btn-secondary vl-btn-sm">
          <UnfoldVertical className="h-3.5 w-3.5" /> <span>Mở hết</span>
        </button>
        <button onClick={() => setOpenIds(new Set())} className="vl-btn vl-btn-secondary vl-btn-sm">
          <FoldVertical className="h-3.5 w-3.5" /> <span>Thu hết</span>
        </button>
        <button onClick={() => void load()} className="vl-btn vl-btn-secondary vl-btn-sm" disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Nạp lại</span>
        </button>
      </div>

      {error && <div className="vl-alert vl-alert-light-danger">Không đọc được dữ liệu: {error}</div>}

      {/* Tổng quan */}
      {data && !isEmpty && (
        <div className="flex flex-wrap gap-2 text-[12px] text-soft">
          <span><b className="text-ink">{data.zones.length}</b> KCN</span>·
          <span><b className="text-ink">{data.stations.length}</b> trạm</span>·
          <span><b className="text-ink">{totalPoints}</b> điểm đo</span>·
          <span><b className="text-ink">{data.customers.length}</b> khách hàng</span>
        </div>
      )}

      {isEmpty ? (
        <div className="vl-card py-16 text-center">
          <Building2 className="mx-auto h-10 w-10 text-faint" />
          <p className="mt-3 text-[15px] font-bold text-dim">Chưa có dữ liệu để vẽ cây</p>
          <p className="mt-1 text-[13px] text-faint">
            Vào mục <b>Danh mục</b> khai khu công nghiệp, trạm và khách hàng trước.
          </p>
        </div>
      ) : (
        <div className="vl-card space-y-1">
          {visibleTree.length === 0 && !!q && (
            <p className="py-10 text-center text-[13px] italic text-faint">
              Không có kết quả cho “{query}”.
            </p>
          )}

          {visibleTree.map(({ zone, stations }) => {
            const color = kcnColorOf(zone.name);
            const zOpen = openIds.has(zone.id);
            const zPoints = stations.reduce((n, s) => n + s.points.length, 0);

            return (
              <div key={zone.id}>
                {/* --- Cấp 1: KCN --- */}
                <button onClick={() => toggle(zone.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-subtle">
                  <Caret open={zOpen} />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color.hex }} />
                  <Building2 className="h-4 w-4 shrink-0" style={{ color: color.hex }} />
                  <span className="font-mono text-[11px] font-bold text-faint">{zone.code}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{zone.name}</span>
                  <Count n={stations.length} label="trạm" hex={color.hex} />
                  <Count n={zPoints} label="điểm đo" hex={color.hex} />
                </button>

                {zOpen && (
                  <div className="ml-[13px] border-l border-[var(--border)] pl-4">
                    {stations.length === 0 ? (
                      <p className="px-3 py-2 text-[12px] italic text-faint">Chưa có trạm nào trong KCN này.</p>
                    ) : stations.map(({ station, points }) => {
                      const sOpen = openIds.has(station.id);
                      return (
                        <div key={station.id}>
                          {/* --- Cấp 2: Trạm --- */}
                          <button onClick={() => toggle(station.id)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-subtle">
                            <Caret open={sOpen} hidden={points.length === 0} />
                            <Factory className="h-4 w-4 shrink-0 text-faint" />
                            <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-dim">
                              {station.code}
                            </span>
                            {station.sdm_kva != null && (
                              <span className="shrink-0 text-[11px] font-semibold text-faint">
                                {station.sdm_kva} kVA
                              </span>
                            )}
                            <Count n={points.length} label="điểm đo" hex={color.hex} />
                          </button>

                          {/* --- Cấp 3: Điểm đo --- */}
                          {sOpen && points.length > 0 && (
                            <div className="ml-[9px] border-l border-[var(--border)] pl-4">
                              {orderPoints(points).map(({ point, isChild }) => (
                                <PointRow key={point.id} p={point} isChild={isChild} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* --- Bản ghi mất cha --- */}
          {(orphanStations.length > 0 || orphanPoints.length > 0) && (
            <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-3">
              <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-warn">
                <AlertTriangle className="h-4 w-4" /> Chưa gắn cha
              </p>
              <p className="mt-1 text-[11px] text-faint">
                Xóa KCN/trạm không xóa con của nó, nên các bản ghi này còn treo lại.
              </p>
              {orphanStations.map(s => (
                <div key={s.id} className="mt-2 flex items-center gap-2 px-1 text-[13px]">
                  <Factory className="h-4 w-4 shrink-0 text-faint" />
                  <span className="font-mono font-bold text-dim">{s.code}</span>
                  <span className="text-[11px] text-faint">không thuộc KCN nào</span>
                </div>
              ))}
              {orphanPoints.map(p => (
                <div key={p.id} className="mt-2 flex items-center gap-2 px-1 text-[13px]">
                  <Gauge className="h-4 w-4 shrink-0 text-faint" />
                  <span className="font-semibold text-dim">{p.line_name}</span>
                  <span className="text-[11px] text-faint">không thuộc trạm nào</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
