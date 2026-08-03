import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw, ChevronRight, Search, MapPin, Building2, Gauge,
  AlertTriangle, Network, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Select } from '../ui/Select';
import { toast as notify } from '../../lib/toast';
import {
  fetchCatalog, type CatalogData, type Point, currentCustomerOf, assetsAtPoint,
  ASSET_TYPE_LABEL,
} from '../../lib/catalog';
import {
  canDrop, canEdit, describeDrop, applyDrop,
  type DragItem, type DropAction, type DropTarget, type DropPayload,
} from '../../lib/dnd';
import PointDetail from './PointDetail';
import WarehousePanel from './WarehousePanel';
import DropConfirmDialog, { type DropRequest } from './DropConfirmDialog';
import BulkImportAssets from './BulkImportAssets';
import { Draggable, Droppable, parseItem, parseTarget } from './dndParts';

const EMPTY: CatalogData = {
  zones: [], stations: [], customers: [], points: [], periods: [],
  warehouses: [], assets: [], installs: [],
};

interface Pending {
  action: DropAction;
  item: DragItem;
  target: DropTarget;
  request: DropRequest;
}

/** Cây danh mục KCN → Trạm → (Chính/Phụ) → Điểm đo, có kéo thả (task 5 + 5b). */
export default function CatalogTree() {
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [zoneFilter, setZoneFilter] = useState('');
  const [term, setTerm] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Point | null>(null);
  const [active, setActive] = useState<DragItem | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const editable = canEdit();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  const matches = useCallback((p: Point) => {
    const t = term.trim().toLowerCase();
    if (!t) return true;
    const cur = currentCustomerOf(data.periods, data.customers, p.id);
    const hay = `${p.line_id} ${p.line_name} ${cur?.period.mkh ?? ''} ${cur?.customer?.name ?? ''}`;
    return hay.toLowerCase().includes(t);
  }, [term, data]);

  const tree = useMemo(() => {
    const zones = data.zones.filter(z => !zoneFilter || z.code === zoneFilter);
    return zones.map(z => {
      const stations = data.stations
        .filter(s => s.zone === z.id)
        .map(s => {
          const pts = data.points.filter(p => p.station === s.id && matches(p));
          return {
            station: s,
            chinh: pts.filter(p => p.role !== 'phu'),
            phu: pts.filter(p => p.role === 'phu'),
            total: pts.length,
          };
        })
        .filter(x => x.total > 0 || !term.trim());
      const orphans = data.points.filter(p => p.zone === z.id && !p.station && matches(p));
      return { zone: z, stations, orphans };
    });
  }, [data, zoneFilter, term, matches]);

  const totalOrphans = useMemo(() => data.points.filter(p => !p.station).length, [data.points]);

  /* ---------------- Kéo thả ---------------- */

  const onDragStart = (e: DragStartEvent) => setActive(parseItem(String(e.active.id)));

  const onDragEnd = (e: DragEndEvent) => {
    const item = parseItem(String(e.active.id));
    setActive(null);
    if (!e.over) return;
    const target = parseTarget(String(e.over.id));
    const check = canDrop(item, target, data);
    if (!check.ok || !check.action) {
      if (check.reason) notify.show('warning', 'Không thả được', check.reason);
      return;
    }
    // KHÔNG ghi ngay — mở hộp thoại xác nhận (plan §6.1)
    setPending({
      action: check.action, item, target,
      request: describeDrop(check.action, item, target, data),
    });
  };

  const confirmDrop = async (payload: DropPayload) => {
    if (!pending) return;
    try {
      await applyDrop(pending.action, pending.item, pending.target, data, payload);
      notify.show('success', 'Đã ghi', pending.request.title);
      setPending(null);
      await load();
    } catch (err: any) {
      notify.show('error', 'Ghi thất bại', err?.message || String(err));
      setPending(null);
    }
  };

  /* ---------------- Render ---------------- */

  const PointRow = ({ p }: { p: Point }) => {
    const cur = currentCustomerOf(data.periods, data.customers, p.id);
    const isSel = selected?.id === p.id;
    const at = assetsAtPoint(data, p.id);
    return (
      <Droppable target={{ kind: 'point', id: p.id }} active={active} data={data}>
        <Draggable item={{ kind: 'point', id: p.id }} disabled={!editable}>
          <button
            onClick={() => setSelected(p)}
            className={`w-full text-left flex items-center gap-2 pl-2 pr-3 py-2 text-sm transition-colors ${
              isSel ? 'bg-accent-soft text-accent font-semibold' : 'text-dim hover:bg-subtle'
            }`}
          >
            <Gauge className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="font-mono text-xs shrink-0">{p.line_id}</span>
            <span className="truncate flex-1">{p.line_name || '—'}</span>
            {at.length > 0 && (
              <span className="text-[0.65rem] text-soft shrink-0" title={at.map(x => x.asset?.serial).join(', ')}>
                {at.length} vật tư
              </span>
            )}
            {cur
              ? <span className="font-mono text-[0.7rem] text-soft shrink-0">{cur.period.mkh}</span>
              : <span className="text-[0.7rem] text-faint shrink-0">chưa có khách</span>}
          </button>
        </Draggable>
      </Droppable>
    );
  };

  const RoleGroup = ({ stationId, role, points }: {
    stationId: string; role: 'chinh' | 'phu'; points: Point[];
  }) => (
    <Droppable
      target={{ kind: 'role-group', id: stationId, role }}
      active={active} data={data} className="ml-8 mb-1"
    >
      <p className="text-[0.65rem] font-bold uppercase tracking-wide text-faint px-2 py-1">
        {role === 'chinh' ? 'Chính' : 'Phụ'} ({points.length})
      </p>
      {points.length === 0
        ? <p className="text-[0.7rem] text-faint px-2 pb-1">— kéo điểm đo vào đây —</p>
        : points.map(p => <PointRow key={p.id} p={p} />)}
    </Droppable>
  );

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="space-y-6">

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-ink">Danh mục điểm đo</h2>
            <p className="text-soft text-sm mt-1">
              Khu vực → Trạm → Điểm đo → Vật tư. Kéo điểm đo vào trạm, kéo vật tư từ kho lên điểm đo.
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

        {!isLoading && (
          <div className="flex flex-wrap gap-2 text-xs items-center">
            <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.stations.length} trạm</span>
            <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.points.length} điểm đo</span>
            <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.customers.length} khách hàng</span>
            <span className="vl-badge-info font-bold px-2 py-1 rounded">{data.assets.length} vật tư</span>
            {totalOrphans > 0 && (
              <span className="vl-badge-warning font-bold px-2 py-1 rounded flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />{totalOrphans} điểm đo chưa gắn trạm
              </span>
            )}
            {!editable && (
              <span className="bg-subtle text-soft font-bold px-2 py-1 rounded flex items-center gap-1">
                <Lock className="w-3 h-3" />Chỉ xem — tài khoản vận hành không sửa được danh mục
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-faint">
            <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải danh mục...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-5 items-start">

            <div className="vl-card overflow-hidden">
              {tree.map(({ zone, stations, orphans }) => (
                <div key={zone.id} className="border-b border-[var(--border)] last:border-b-0">
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
                        {stations.map(({ station, chinh, phu, total }) => (
                          <div key={station.id}>
                            <Droppable target={{ kind: 'station', id: station.id }} active={active} data={data}>
                              <button
                                onClick={() => toggle(station.id)}
                                className="w-full flex items-center gap-2 pl-8 pr-4 py-2 hover:bg-subtle transition-colors"
                              >
                                <ChevronRight className={`w-3.5 h-3.5 text-faint transition-transform ${openIds.has(station.id) ? 'rotate-90' : ''}`} />
                                <Building2 className="w-3.5 h-3.5 text-soft shrink-0" />
                                <span className="text-sm font-semibold text-dim flex-1 text-left truncate">{station.code}</span>
                                <span className="text-xs text-faint shrink-0">{total} điểm đo</span>
                                {!station.sdm_kva && (
                                  <span className="text-[0.65rem] text-warn shrink-0" title="Chưa có thông số nhãn MBA (Sdm/P0/Pk) — không tính được tổn thất">
                                    thiếu thông số MBA
                                  </span>
                                )}
                              </button>
                            </Droppable>

                            <AnimatePresence initial={false}>
                              {openIds.has(station.id) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
                                  className="overflow-hidden"
                                >
                                  <RoleGroup stationId={station.id} role="chinh" points={chinh} />
                                  <RoleGroup stationId={station.id} role="phu" points={phu} />
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}

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
                                  className="overflow-hidden ml-8"
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

            <div className="space-y-5 xl:sticky xl:top-4">
              <WarehousePanel data={data} active={active} canEditNow={editable} onBulkImport={() => setBulkOpen(true)} />
              <PointDetail point={selected} data={data} />
            </div>
          </div>
        )}
      </div>

      <DragOverlay>
        {active && (
          <div className="px-3 py-1.5 rounded bg-accent text-[var(--on-accent)] text-sm font-bold shadow-lg">
            {active.kind === 'point'
              ? `Điểm đo ${data.points.find(p => p.id === active.id)?.line_id ?? ''}`
              : `${ASSET_TYPE_LABEL[data.assets.find(a => a.id === active.id)?.type ?? ''] ?? ''} ${data.assets.find(a => a.id === active.id)?.serial ?? ''}`}
          </div>
        )}
      </DragOverlay>

      {bulkOpen && (
        <BulkImportAssets data={data} onClose={() => setBulkOpen(false)} onDone={load} />
      )}

      <DropConfirmDialog
        request={pending?.request ?? null}
        onCancel={() => setPending(null)}
        onConfirm={confirmDrop}
      />
    </DndContext>
  );
}
