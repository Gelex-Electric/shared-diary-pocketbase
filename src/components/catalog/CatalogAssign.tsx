import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  RefreshCw, Search, AlertTriangle, Lock, ArrowUpDown, X, Package,
} from 'lucide-react';
import { toast as notify } from '../../lib/toast';
import {
  fetchCatalog, type CatalogData, type Point, type Asset,
  currentCustomerOf, assetsAtPoint, isMeter,
} from '../../lib/catalog';
import {
  canEdit, checkAssignStation, checkChangeRole, checkHang, checkRemove,
  assignStation, changeRole, hangAssets, removeAssets, warehouseOfZone,
  type EventPayload,
} from '../../lib/assign';
import PointDetail from './PointDetail';
import WarehousePanel from './WarehousePanel';
import ActionConfirmDialog, { type ActionRequest } from './ActionConfirmDialog';
import { RoleTag, PointStatusTag } from './tags';

const EMPTY: CatalogData = {
  zones: [], stations: [], customers: [], points: [], periods: [],
  warehouses: [], assets: [], installs: [],
};

type Filter = 'all' | 'no_station' | 'no_meter' | 'no_customer' | 'phu' | 'hsn_bad';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'no_station', label: 'Chưa gắn trạm' },
  { id: 'no_meter', label: 'Chưa có công tơ' },
  { id: 'no_customer', label: 'Chưa có khách' },
  { id: 'phu', label: 'Điểm đo phụ' },
  { id: 'hsn_bad', label: 'HSN bất thường' },
];

type SortKey = 'line_id' | 'line_name' | 'station' | 'role' | 'customer' | 'assets';

interface Pending {
  request: ActionRequest;
  run: (p: EventPayload) => Promise<void>;
}

/**
 * Trang SẮP XẾP — bảng phẳng có lọc/sắp xếp + tích chọn nhiều dòng.
 *
 * Thay cây và kéo thả (user chốt 03/08). Lý do: việc thật là "tìm chỗ còn
 * thiếu rồi lấp" — bảng lọc/sắp xếp làm việc đó tốt hơn cây; và gắn 28 điểm đo
 * bằng vài thao tác thay vì 28 lần kéo qua danh sách 92 trạm.
 */
export default function CatalogAssign() {
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [activeZone, setActiveZone] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'line_id', asc: true });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Point | null>(null);
  const [assetPick, setAssetPick] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  const editable = canEdit();

  const load = useCallback(async () => {
    setIsLoading(true);
    try { setData(await fetchCatalog()); }
    catch (err: any) { notify.show('error', 'Lỗi', 'Không tải được danh mục: ' + (err?.message || err)); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!activeZone && data.zones.length) setActiveZone(data.zones[0].id);
  }, [data.zones, activeZone]);

  // Đổi KCN / đổi bộ lọc ⇒ bỏ hết tích chọn, tránh thao tác lên dòng không còn thấy
  useEffect(() => { setChecked(new Set()); setAssetPick(new Set()); }, [activeZone, filter]);

  const stationCode = useCallback(
    (id: string) => data.stations.find(s => s.id === id)?.code ?? '',
    [data.stations],
  );

  const matchFilter = useCallback((p: Point, f: Filter) => {
    const cur = currentCustomerOf(data.periods, data.customers, p.id);
    const at = assetsAtPoint(data, p.id);
    switch (f) {
      case 'no_station': return !p.station;
      case 'no_meter': return !at.some(x => x.asset && isMeter(x.asset.type));
      case 'no_customer': return !cur;
      case 'phu': return p.role === 'phu';
      case 'hsn_bad': return p.hsn_invoice === 0 || (p.hsn_invoice ?? 0) > 100000;
      default: return true;
    }
  }, [data]);

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = data.points.filter(p => {
      if (p.zone !== activeZone) return false;
      if (!matchFilter(p, filter)) return false;
      if (!t) return true;
      const cur = currentCustomerOf(data.periods, data.customers, p.id);
      const hay = `${p.line_id} ${p.line_name} ${stationCode(p.station)} ${cur?.period.mkh ?? ''} ${cur?.customer?.name ?? ''}`;
      return hay.toLowerCase().includes(t);
    });

    const val = (p: Point): string => {
      const cur = currentCustomerOf(data.periods, data.customers, p.id);
      switch (sort.key) {
        case 'line_id': return p.line_id.padStart(8, '0');
        case 'line_name': return p.line_name || '';
        case 'station': return stationCode(p.station) || 'zzz';
        case 'role': return p.role || 'zzz';
        case 'customer': return cur?.period.mkh || 'zzz';
        case 'assets': return String(assetsAtPoint(data, p.id).length).padStart(3, '0');
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [data, activeZone, term, filter, sort, matchFilter, stationCode]);

  const checkedPoints = useMemo(() => data.points.filter(p => checked.has(p.id)), [data.points, checked]);
  const pickedAssets = useMemo(() => data.assets.filter(a => assetPick.has(a.id)), [data.assets, assetPick]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));

  const toggleAll = () =>
    setChecked(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))));

  /* ---------------- Thao tác hàng loạt ---------------- */

  const doAssignStation = (stationId: string) => {
    const ok: Point[] = [], skip: string[] = [];
    for (const p of checkedPoints) {
      const c = checkAssignStation(p, stationId, data);
      if (c.ok) ok.push(p); else skip.push(`${p.line_id}: ${c.reason}`);
    }
    if (!ok.length) { notify.show('warning', 'Không gắn được', skip[0] ?? 'Không có dòng hợp lệ'); return; }
    setPending({
      request: {
        title: 'Gắn điểm đo vào trạm',
        detail: `${ok.length} điểm đo → trạm ${stationCode(stationId)}`,
        needsDate: false, irreversible: false,
        warnings: skip.length ? [`${skip.length} dòng bị bỏ qua:`, ...skip.slice(0, 5)] : undefined,
      },
      run: async () => { await assignStation(ok.map(p => p.id), stationId); },
    });
  };

  const doChangeRole = (role: 'chinh' | 'phu') => {
    const ok: Point[] = [], skip: string[] = [];
    for (const p of checkedPoints) {
      const c = checkChangeRole(p, role);
      if (c.ok) ok.push(p); else skip.push(`${p.line_id}: ${c.reason}`);
    }
    if (!ok.length) { notify.show('warning', 'Không đổi được', skip[0] ?? ''); return; }
    setPending({
      request: {
        title: 'Đổi vai trò điểm đo',
        detail: `${ok.length} điểm đo → ${role === 'chinh' ? 'CHÍNH' : 'PHỤ'}\n`
          + (role === 'chinh'
            ? 'Điểm đo chính ĐƯỢC tính vào tổn thất máy biến áp.'
            : 'Điểm đo phụ KHÔNG được tính vào tổn thất máy biến áp.'),
        needsDate: false, irreversible: false,
        warnings: skip.length ? [`${skip.length} dòng bị bỏ qua`] : undefined,
      },
      run: async () => { await changeRole(ok.map(p => p.id), role); },
    });
  };

  const doHang = () => {
    if (!selected) { notify.show('warning', 'Chưa chọn điểm đo', 'Bấm một dòng điểm đo để chọn nơi treo'); return; }
    const ok: Asset[] = [], skip: string[] = [];
    for (const a of pickedAssets) {
      const c = checkHang(a, selected, data, pickedAssets);
      if (c.ok) ok.push(a); else skip.push(`${a.serial}: ${c.reason}`);
    }
    if (!ok.length) { notify.show('warning', 'Không treo được', skip[0] ?? ''); return; }
    setPending({
      request: {
        title: 'Treo vật tư lên điểm đo',
        detail: `${ok.map(a => a.serial).join(', ')}\n→ điểm đo ${selected.line_id} — ${selected.line_name || '—'}`,
        needsDate: true, irreversible: true,
        warnings: skip.length ? [`${skip.length} vật tư bị bỏ qua:`, ...skip.slice(0, 5)] : undefined,
      },
      run: async p => { await hangAssets(ok, selected, p); },
    });
  };

  const doRemove = () => {
    const wh = warehouseOfZone(data, activeZone);
    if (!wh) { notify.show('error', 'Thiếu kho', 'Khu công nghiệp này chưa có kho'); return; }
    const ok: Asset[] = [], skip: string[] = [];
    for (const a of pickedAssets) {
      const c = checkRemove(a);
      if (c.ok) ok.push(a); else skip.push(`${a.serial}: ${c.reason}`);
    }
    if (!ok.length) { notify.show('warning', 'Không tháo được', skip[0] ?? ''); return; }
    setPending({
      request: {
        title: 'Tháo vật tư về kho',
        detail: `${ok.map(a => a.serial).join(', ')}\n→ ${wh.name}`,
        needsDate: true, irreversible: true,
        warnings: skip.length ? [`${skip.length} vật tư bị bỏ qua`] : undefined,
      },
      run: async p => { await removeAssets(ok, wh.id, data, p); },
    });
  };

  const confirm = async (p: EventPayload) => {
    if (!pending) return;
    try {
      await pending.run(p);
      notify.show('success', 'Đã ghi', pending.request.title);
      setPending(null);
      setChecked(new Set());
      setAssetPick(new Set());
      await load();
    } catch (err: any) {
      notify.show('error', 'Ghi thất bại', err?.message || String(err));
      setPending(null);
    }
  };

  /* ---------------- Render ---------------- */

  const Th = ({ k, children }: { k: SortKey; children: ReactNode }) => (
    <th className="px-2 py-2 whitespace-nowrap">
      <button onClick={() => toggleSort(k)} className="flex items-center gap-1 hover:text-accent transition-colors">
        {children}
        <ArrowUpDown className={`w-3 h-3 ${sort.key === k ? 'text-accent' : 'opacity-30'}`} />
      </button>
    </th>
  );

  const zoneStations = data.stations.filter(s => s.zone === activeZone);

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Sắp xếp điểm đo</h2>
          <p className="text-soft text-sm mt-1">
            Tích chọn nhiều dòng rồi dùng thanh thao tác ở dưới màn hình.
            Thêm/sửa/xóa bản ghi ở trang <strong>Quản lý danh mục</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Tìm điểm đo, trạm, khách..."
              className="w-full pl-10 pr-4 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
          </div>
          <button onClick={load} className="p-2 rounded border border-[var(--border)] text-soft hover:bg-subtle transition-colors" title="Tải lại">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!editable && (
        <p className="text-xs bg-subtle text-soft font-bold px-3 py-2 rounded flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />Tài khoản vận hành chỉ xem được.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {data.zones.map(z => {
          const n = data.points.filter(p => p.zone === z.id).length;
          const orphan = data.points.filter(p => p.zone === z.id && !p.station).length;
          return (
            <button key={z.id} onClick={() => { setActiveZone(z.id); setSelected(null); }}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                activeZone === z.id ? 'border-accent text-accent' : 'border-transparent text-soft hover:text-dim'
              }`}>
              {z.name}
              <span className="text-xs text-faint">{n}</span>
              {orphan > 0 && (
                <span className="text-[0.65rem] font-bold px-1.5 py-0.5 rounded vl-badge-warning" title={`${orphan} điểm đo chưa gắn trạm`}>
                  {orphan}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map(f => {
          const count = f.id === 'all'
            ? undefined
            : data.points.filter(p => p.zone === activeZone && matchFilter(p, f.id)).length;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-xs font-bold px-2.5 py-1.5 rounded transition-colors ${
                filter === f.id ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-soft hover:text-dim'
              }`}>
              {f.label}{count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-faint">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 items-start">
          <div className="vl-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-xs text-soft">
                <tr className="text-left">
                  <th className="px-2 py-2 w-8">
                    <input type="checkbox" disabled={!editable || rows.length === 0}
                      checked={rows.length > 0 && checked.size === rows.length}
                      onChange={toggleAll} className="w-3.5 h-3.5" />
                  </th>
                  <Th k="line_id">Mã</Th>
                  <Th k="line_name">Tên điểm đo</Th>
                  <Th k="station">Trạm</Th>
                  <Th k="role">Vai trò</Th>
                  <th className="px-2 py-2 whitespace-nowrap">Trạng thái</th>
                  <Th k="customer">Khách hàng</Th>
                  <Th k="assets">Vật tư</Th>
                  <th className="px-2 py-2">Cảnh báo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-faint">Không có điểm đo nào khớp</td></tr>
                ) : rows.map(p => {
                  const cur = currentCustomerOf(data.periods, data.customers, p.id);
                  const at = assetsAtPoint(data, p.id);
                  const noMeter = !at.some(x => x.asset && isMeter(x.asset.type));
                  const hsnBad = p.hsn_invoice === 0 || (p.hsn_invoice ?? 0) > 100000;
                  return (
                    <tr key={p.id} onClick={() => setSelected(p)}
                      className={`cursor-pointer transition-colors ${
                        selected?.id === p.id ? 'bg-accent-soft' : 'hover:bg-subtle'
                      }`}>
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" disabled={!editable} checked={checked.has(p.id)}
                          onChange={() => setChecked(prev => {
                            const n = new Set(prev);
                            if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                            return n;
                          })}
                          className="w-3.5 h-3.5" />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs font-bold text-accent whitespace-nowrap">{p.line_id}</td>
                      <td className="px-2 py-2 text-dim max-w-[220px] truncate" title={p.line_name}>{p.line_name || '—'}</td>
                      <td className={`px-2 py-2 whitespace-nowrap ${p.station ? 'text-dim' : 'text-warn font-semibold'}`}>
                        {p.station ? stationCode(p.station) : 'chưa gắn'}
                      </td>
                      <td className="px-2 py-2"><RoleTag role={p.role} /></td>
                      <td className="px-2 py-2"><PointStatusTag status={p.point_status} /></td>
                      <td className="px-2 py-2 font-mono text-xs text-soft whitespace-nowrap">{cur?.period.mkh ?? '—'}</td>
                      <td className="px-2 py-2 text-dim">{at.length || '—'}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {noMeter && <span className="text-[0.65rem] text-warn">thiếu công tơ</span>}
                          {hsnBad && <span className="text-[0.65rem] text-bad">HSN {p.hsn_invoice}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-4 xl:sticky xl:top-4">
            <WarehousePanel
              data={data} zoneId={activeZone} canEditNow={editable}
              picked={assetPick} onPick={setAssetPick}
            />
            <PointDetail
              point={selected} data={data} canEditNow={editable}
              picked={assetPick} onPick={setAssetPick}
            />
          </div>
        </div>
      )}

      {/* Thanh thao tác: điểm đo */}
      {editable && checked.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 vl-card shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-ink">Đã chọn {checked.size} điểm đo</span>
          <select defaultValue=""
            onChange={e => { if (e.target.value) { doAssignStation(e.target.value); e.target.value = ''; } }}
            className="px-3 py-1.5 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none">
            <option value="">Gắn vào trạm…</option>
            {zoneStations.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
          <button onClick={() => doChangeRole('chinh')}
            className="px-3 py-1.5 rounded text-sm font-semibold border border-[var(--border)] text-soft hover:bg-subtle transition-colors">
            Đổi thành Chính
          </button>
          <button onClick={() => doChangeRole('phu')}
            className="px-3 py-1.5 rounded text-sm font-semibold border border-[var(--border)] text-soft hover:bg-subtle transition-colors">
            Đổi thành Phụ
          </button>
          <button onClick={() => setChecked(new Set())} className="text-faint hover:text-ink transition-colors" title="Bỏ chọn">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Thanh thao tác: vật tư */}
      {editable && assetPick.size > 0 && checked.size === 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 vl-card shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <Package className="w-4 h-4 text-accent" />
          <span className="text-sm font-bold text-ink">Đã chọn {assetPick.size} vật tư</span>
          <span className="text-xs text-soft">
            {selected ? `Điểm đo đang chọn: ${selected.line_id}` : 'Bấm một dòng điểm đo để chọn nơi treo'}
          </span>
          <button onClick={doHang} disabled={!selected}
            className="px-3 py-1.5 rounded text-sm font-bold bg-accent text-[var(--on-accent)] hover:opacity-90 transition-opacity disabled:opacity-40">
            Treo lên điểm đo
          </button>
          <button onClick={doRemove}
            className="px-3 py-1.5 rounded text-sm font-semibold border border-[var(--border)] text-soft hover:bg-subtle transition-colors">
            Tháo về kho
          </button>
          <button onClick={() => setAssetPick(new Set())} className="text-faint hover:text-ink transition-colors" title="Bỏ chọn">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <ActionConfirmDialog request={pending?.request ?? null} onCancel={() => setPending(null)} onConfirm={confirm} />

      {!isLoading && rows.length > 0 && (
        <p className="text-xs text-faint flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          Hiện {rows.length} điểm đo. Bấm tiêu đề cột để sắp xếp; bấm một dòng để xem chi tiết bên phải.
        </p>
      )}
    </div>
  );
}
