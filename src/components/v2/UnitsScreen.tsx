/**
 * Màn hình ĐƠN VỊ — ba dải trượt dần KCN → Trạm → Điểm đo (user chốt 07/08).
 *
 * Mỗi dải là một danh sách thật, dòng cuối là nút thêm mới ngay tại chỗ. Chọn
 * một phần tử ở dải trái thì dải kế bên hiện con của nó.
 *
 * Vì sao phải đổi cấu trúc dữ liệu trước khi làm màn hình này: KCN vốn chỉ là 6
 * giá trị cố định trong ô `select`, còn trạm chỉ là chữ trên từng điểm đo — cả
 * hai đều không thêm mới được từ giao diện. Đã tạo `wh_zone`, `wh_station` và
 * thêm trường `role`/`station` cho `wh_point` (xem `scripts/wh_zone_station.mjs`).
 *
 * Dải 3 có thêm ô "gắn điểm đo có sẵn": 160 điểm đo nhập từ Excel đều chưa
 * thuộc trạm nào, không có chỗ này thì phải sửa tay từng cái.
 *
 * Khách hàng nằm cùng màn hình nhưng ở tab ngang thứ hai (user chốt 07/08).
 * KHO không còn là danh mục riêng: mỗi KCN đúng một kho nên chính đơn vị là kho,
 * đơn vị GETC là kho trung chuyển.
 */
import { useState, useMemo } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, Lock, MapPin, Building2, Gauge, Link2, Users } from 'lucide-react';
import { useWhData, ErrorBar, Badge } from './shared';
import CatalogForm from './CatalogForm';
import CustomersPanel from './CustomersPanel';
import { Tabs, type TabItem } from '../ui/Tabs';
import { pbv2 } from '../../lib/v2/pb';
import { WH, isTransitZone, type WhZone, type WhStation, type WhPoint } from '../../lib/v2/wh';
import {
  canWrite, whyCannotWrite, deleteBlockers, deleteRecord, readableError,
  ENTITY_LABEL, type EntityKind,
} from '../../lib/v2/whWrite';
import { toast as notify } from '../../lib/toast';

type Pane = 'donvi' | 'khachhang';

const PANES: TabItem<Pane>[] = [
  { id: 'donvi', label: 'Đơn vị & điểm đo', icon: MapPin },
  { id: 'khachhang', label: 'Khách hàng', icon: Users },
];

export default function UnitsScreen() {
  const [pane, setPane] = useState<Pane>('donvi');
  const { data, loading, error, reload } = useWhData();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: EntityKind; record: any | null } | null>(null);
  const [confirming, setConfirming] = useState<{ kind: EntityKind; record: any; blockers: string[] } | null>(null);
  const writable = canWrite();

  const zone = data.zones.find(z => z.id === zoneId) ?? null;
  const stations = useMemo(
    () => data.stations.filter(s => s.zone === zoneId),
    [data.stations, zoneId],
  );
  const station = stations.find(s => s.id === stationId) ?? null;
  const points = useMemo(
    () => data.points.filter(p => p.station === stationId),
    [data.points, stationId],
  );

  /** Điểm đo cùng KCN nhưng chưa thuộc trạm nào — nguồn cho ô gắn nhanh. */
  const orphanPoints = useMemo(
    () => (zone ? data.points.filter(p => !p.station && p.zone === zone.code) : []),
    [data.points, zone],
  );

  const ask = async (kind: EntityKind, record: any) => {
    try {
      setConfirming({ kind, record, blockers: await deleteBlockers(kind, record.id, record) });
    } catch (e) { notify.error(readableError(e)); }
  };

  const doDelete = async () => {
    if (!confirming) return;
    try {
      await deleteRecord(confirming.kind, confirming.record.id);
      notify.success('Đã xoá');
      if (confirming.kind === 'zone' && confirming.record.id === zoneId) setZoneId(null);
      if (confirming.kind === 'station' && confirming.record.id === stationId) setStationId(null);
      setConfirming(null);
      reload();
    } catch (e) { notify.error(readableError(e)); }
  };

  const setRole = async (p: WhPoint, role: 'chinh' | 'phu') => {
    try {
      await pbv2.collection(WH.point).update(p.id, { role: p.role === role ? '' : role });
      reload();
    } catch (e) { notify.error(readableError(e)); }
  };

  const attachPoint = async (pointId: string) => {
    if (!station) return;
    try {
      await pbv2.collection(WH.point).update(pointId, {
        station: station.id, station_code: station.code,
      });
      notify.success('Đã gắn điểm đo vào trạm');
      reload();
    } catch (e) { notify.error(readableError(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="vl-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[15px] font-semibold">Danh mục</h2>
          <p className="text-[12px] text-faint">
            {data.zones.length} đơn vị · {data.stations.length} trạm · {data.points.length} điểm đo · {data.customers.length} khách hàng
          </p>
        </div>
        <button onClick={reload} disabled={loading}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
        </button>
      </div>

      <ErrorBar message={error} />

      <Tabs tabs={PANES} value={pane} onChange={p => setPane(p)} />

      {!writable && (
        <div className="vl-alert vl-alert-light-warning flex items-center gap-2 text-[13px]">
          <Lock className="w-4 h-4 shrink-0" /> {whyCannotWrite()}
        </div>
      )}

      {pane === 'khachhang'
        ? <CustomersPanel data={data} loading={loading} reload={reload} />
        : (
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* ---------- Dải 1: KCN ---------- */}
        <Column
          icon={<MapPin className="w-4 h-4" />} title="Khu công nghiệp" count={data.zones.length}
          addLabel="Thêm khu công nghiệp" writable={writable}
          onAdd={() => setEditing({ kind: 'zone', record: null })}
          empty={loading ? 'Đang tải...' : 'Chưa có KCN nào'}
        >
          {data.zones.map((z: WhZone) => (
            <Row
              key={z.id} active={z.id === zoneId}
              onClick={() => { setZoneId(z.id); setStationId(null); }}
              title={z.short_code || z.code} sub={isTransitZone(z.code) ? 'Kho trung chuyển — khoá' : z.name}
              right={<span className="text-[11px] text-faint tnum">
                {data.stations.filter(s => s.zone === z.id).length}
              </span>}
              writable={writable && !isTransitZone(z.code)}
              onEdit={() => setEditing({ kind: 'zone', record: z })}
              onDelete={() => ask('zone', z)}
            />
          ))}
        </Column>

        {/* ---------- Dải 2: Trạm ---------- */}
        <Column
          icon={<Building2 className="w-4 h-4" />} title="Trạm"
          count={zone ? stations.length : undefined}
          addLabel="Thêm trạm" writable={writable && Boolean(zone)}
          onAdd={() => setEditing({ kind: 'station', record: { zone: zoneId } })}
          empty={!zone ? 'Chọn một khu công nghiệp bên trái' : 'KCN này chưa có trạm nào'}
        >
          {zone && stations.map((s: WhStation) => (
            <Row
              key={s.id} active={s.id === stationId}
              onClick={() => setStationId(s.id)}
              title={s.code} sub={[s.name, s.mba].filter(Boolean).join(' · ')}
              right={<span className="text-[11px] text-faint tnum">
                {data.points.filter(p => p.station === s.id).length}
              </span>}
              writable={writable}
              onEdit={() => setEditing({ kind: 'station', record: s })}
              onDelete={() => ask('station', s)}
            />
          ))}
        </Column>

        {/* ---------- Dải 3: Điểm đo ---------- */}
        <Column
          icon={<Gauge className="w-4 h-4" />} title="Điểm đo"
          count={station ? points.length : undefined}
          addLabel="Thêm điểm đo" writable={writable && Boolean(station)}
          onAdd={() => setEditing({
            kind: 'point',
            record: { station: stationId, station_code: station?.code, zone: zone?.code },
          })}
          empty={!station ? 'Chọn một trạm ở dải giữa' : 'Trạm này chưa có điểm đo nào'}
          footer={station && writable && orphanPoints.length > 0 ? (
            <div className="px-2 py-2 border-t border-hair">
              <p className="text-[11.5px] text-faint mb-1 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Gắn điểm đo có sẵn ({orphanPoints.length} chưa có trạm)
              </p>
              <select
                value="" onChange={e => e.target.value && attachPoint(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-inset border border-hair text-[12.5px]"
              >
                <option value="">— chọn điểm đo —</option>
                {orphanPoints.map(p => <option key={p.id} value={p.id}>{p.point_code}</option>)}
              </select>
            </div>
          ) : null}
        >
          {station && points.map(p => (
            <div key={p.id} className="px-2 py-1.5 rounded-md hover:bg-subtle">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium truncate">{p.point_code}</span>
                  <span className="block text-[11px] text-faint truncate">
                    {p.trang_thai || '—'}{p.cong_suat_kva ? ` · ${p.cong_suat_kva} kVA` : ''}
                  </span>
                </span>
                <button onClick={() => setEditing({ kind: 'point', record: p })} disabled={!writable}
                  className="p-1 rounded-md hover:bg-surface text-dim disabled:opacity-40" aria-label="Sửa">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => ask('point', p)} disabled={!writable}
                  className="p-1 rounded-md hover:bg-surface text-bad disabled:opacity-40" aria-label="Xoá">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {(['chinh', 'phu'] as const).map(r => (
                  <button
                    key={r} onClick={() => setRole(p, r)} disabled={!writable}
                    className={`px-2 py-0.5 rounded-md text-[11px] border disabled:opacity-40 ${
                      p.role === r ? 'border-[var(--accent)] text-accent' : 'border-hair text-faint'
                    }`}
                  >
                    {r === 'chinh' ? 'Chính' : 'Phụ'}
                  </button>
                ))}
                {!p.role && <Badge tone="warn">chưa đặt vai trò</Badge>}
              </div>
            </div>
          ))}
        </Column>
      </div>
      )}

      {editing && (
        <CatalogForm
          kind={editing.kind} record={editing.record} data={data}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); notify.success(msg); reload(); }}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="vl-card vl-drawer w-full max-w-[440px] p-5 space-y-3">
            <h3 className="text-[16px] font-semibold">
              Xoá {ENTITY_LABEL[confirming.kind].toLowerCase()}?
            </h3>
            <p className="text-[13px] text-dim">
              {confirming.record.code ?? confirming.record.point_code}
            </p>
            {confirming.blockers.length > 0 && (
              <div className="vl-alert vl-alert-light-danger text-[13px]">
                <p className="font-medium mb-1">Không xoá được:</p>
                {confirming.blockers.map((b, i) => <p key={i}>• {b}</p>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="px-4 py-2 rounded-lg border border-hair text-[13px]">Huỷ</button>
              <button onClick={doDelete} disabled={confirming.blockers.length > 0}
                className="px-4 py-2 rounded-lg bg-[var(--danger)] text-white text-[13px] font-semibold disabled:opacity-40">
                Xoá
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Column({
  icon, title, count, addLabel, writable, onAdd, empty, children, footer,
}: {
  icon: React.ReactNode; title: string; count?: number;
  addLabel: string; writable: boolean; onAdd: () => void;
  empty: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.filter(Boolean).length > 0 : Boolean(children);
  return (
    <div className="vl-card p-2">
      <div className="flex items-center gap-2 px-1.5 py-1.5 border-b border-hair mb-1">
        <span className="text-faint">{icon}</span>
        <span className="text-[13px] font-semibold flex-1">{title}</span>
        {count !== undefined && <span className="text-[11px] text-faint tnum">{count}</span>}
      </div>

      <div className="max-h-[56vh] overflow-y-auto pr-1">
        {hasChildren ? children : <p className="py-8 text-center text-[12.5px] text-faint">{empty}</p>}
      </div>

      {footer}

      <button
        onClick={onAdd} disabled={!writable}
        className="w-full mt-1 px-2 py-2 rounded-md border border-dashed border-hair text-[12.5px] text-dim flex items-center justify-center gap-1.5 hover:bg-subtle disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
    </div>
  );
}

function Row({
  active, onClick, title, sub, right, writable, onEdit, onDelete,
}: {
  active: boolean; onClick: () => void; title: string; sub?: string;
  right?: React.ReactNode; writable: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className={`flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-subtle ${active ? 'bg-subtle' : ''}`}>
      <button onClick={onClick} className="flex-1 min-w-0 text-left">
        <span className={`block text-[12.5px] font-medium truncate ${active ? 'text-accent' : ''}`}>{title}</span>
        {sub && <span className="block text-[11px] text-faint truncate">{sub}</span>}
      </button>
      {right}
      <button onClick={onEdit} disabled={!writable}
        className="p-1 rounded-md hover:bg-surface text-dim disabled:opacity-40" aria-label="Sửa">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete} disabled={!writable}
        className="p-1 rounded-md hover:bg-surface text-bad disabled:opacity-40" aria-label="Xoá">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
