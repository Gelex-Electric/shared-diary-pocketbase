import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  RefreshCw, Search, AlertTriangle, Lock, ArrowUpDown, Package, MapPin,
} from 'lucide-react';
import { toast as notify } from '../../lib/toast';
import {
  fetchCatalog, type CatalogData, type Point, type Asset,
  currentCustomerOf, assetsAtPoint, isMeter, isAbortError,
} from '../../lib/catalog';
import {
  canEdit, checkAssignStation, checkChangeRole, checkHang, checkRemove,
  assignStation, changeRole, hangAssets, removeAssets, warehouseOfZone,
  type EventPayload,
} from '../../lib/assign';
import { Tabs } from '../ui/Tabs';
import { Select } from '../ui/Select';
import PointDetail from './PointDetail';
import WarehousePanel from './WarehousePanel';
import ActionConfirmDialog, { type ActionRequest } from './ActionConfirmDialog';
import { RoleTag, PointStatusTag } from './tags';
import { assignCustomer } from '../../lib/pointCustomer';

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

type SortKey = 'line_name' | 'station' | 'role' | 'customer' | 'assets';

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
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'line_name', asc: true });
  const [selected, setSelected] = useState<Point | null>(null);
  const [assetPick, setAssetPick] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  const editable = canEdit();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await fetchCatalog());
    } catch (err: any) {
      // Request bị hủy (đổi trang, tải lại chồng nhau) không phải lỗi thật
      if (!isAbortError(err)) {
        notify.show('error', 'Lỗi', 'Không tải được danh mục: ' + (err?.message || err));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!activeZone && data.zones.length) setActiveZone(data.zones[0].id);
  }, [data.zones, activeZone]);

  // Đổi KCN / đổi bộ lọc ⇒ bỏ dòng đang chọn và vật tư đã tích,
  // tránh thao tác lên thứ không còn thấy trên bảng.
  useEffect(() => { setSelected(null); setAssetPick(new Set()); }, [activeZone, filter]);

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

  const pickedAssets = useMemo(() => data.assets.filter(a => assetPick.has(a.id)), [data.assets, assetPick]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));

  /* ---------------- Thao tác với điểm đo đang chọn ---------------- */

  const doAssignStation = (stationId: string) => {
    if (!selected) return;
    const c = checkAssignStation(selected, stationId, data);
    if (!c.ok) { notify.show('warning', 'Không gắn được', c.reason); return; }
    const ok = [selected], skip: string[] = [];
    setPending({
      request: {
        title: 'Gắn điểm đo vào trạm',
        detail: `${selected.line_name}
→ trạm ${stationCode(stationId)}`,
        needsDate: false, irreversible: false,
        warnings: skip.length ? [`${skip.length} dòng bị bỏ qua:`, ...skip.slice(0, 5)] : undefined,
      },
      run: async () => { await assignStation(ok.map(p => p.id), stationId); },
    });
  };

  const doChangeRole = (role: 'chinh' | 'phu') => {
    if (!selected) return;
    const c = checkChangeRole(selected, role);
    if (!c.ok) { notify.show('warning', 'Không đổi được', c.reason); return; }
    const ok = [selected], skip: string[] = [];
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

  /** Danh sách khách của KCN đang mở — không cho gắn khách KCN khác. */
  const cusOptions = useMemo(() => [
    { value: '', label: '— chưa gắn —' },
    ...data.customers
      .filter(c => c.zone === activeZone)
      .map(c => ({ value: c.id, label: `${c.mkh} · ${c.name}` })),
  ], [data.customers, activeZone]);

  /**
   * Gắn / đổi khách hàng của một điểm đo. Ghi luôn, không qua hộp xác nhận:
   * đây là việc sửa danh mục, đảo lại được ngay, khác với treo/tháo vật tư
   * (ghi sổ cái, không xoá được).
   */
  const doAssignCustomer = async (p: Point, customerId: string) => {
    try {
      const msg = await assignCustomer(data, p.id, customerId);
      notify.show('success', 'Đã cập nhật khách hàng', msg);
      await load();
    } catch (e: any) {
      notify.show('error', 'Không lưu được', e?.message || String(e));
    }
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
        detail: `${ok.map(a => a.serial).join(', ')}
→ điểm đo ${selected.line_name}`,
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
      setAssetPick(new Set());
      await load();
    } catch (err: any) {
      notify.show('error', 'Ghi thất bại', err?.message || String(err));
      setPending(null);
    }
  };

  /* ---------------- Render ---------------- */

  const Th = ({ k, children }: { k: SortKey; children: ReactNode }) => (
    <th className="whitespace-nowrap">
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
          <button onClick={load} className="vl-btn vl-btn-secondary vl-btn-sm px-2!" title="Tải lại">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!editable && (
        <p className="text-xs bg-subtle text-soft font-bold px-3 py-2 rounded flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />Tài khoản vận hành chỉ xem được.
        </p>
      )}

      <Tabs
        tabs={data.zones.map(z => {
          const orphan = data.points.filter(p => p.zone === z.id && !p.station).length;
          const n = data.points.filter(p => p.zone === z.id).length;
          return {
            id: z.id,
            label: `${z.name} (${n})${orphan ? ` · ${orphan} chưa gắn` : ''}`,
            icon: MapPin,
            sub: orphan ? `${orphan} điểm đo chưa gắn trạm` : undefined,
          };
        })}
        value={activeZone}
        onChange={id => { setActiveZone(id); setSelected(null); }}
      />

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-subtle p-1">
        {FILTERS.map(f => {
          const count = f.id === 'all'
            ? undefined
            : data.points.filter(p => p.zone === activeZone && matchFilter(p, f.id)).length;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                filter === f.id ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-soft hover:text-dim'
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
        <div className="grid grid-cols-1 xl:grid-cols-[3fr_1fr] gap-4 items-start">
          <div className="vl-card overflow-x-auto mb-0!">
            <table className="vl-table vl-table-grid w-full text-left border-collapse">
              <thead>
                <tr>
                  <Th k="line_name">Mã điểm đo</Th>
                  <Th k="station">Trạm</Th>
                  <Th k="role">Vai trò</Th>
                  <th className="whitespace-nowrap">Trạng thái</th>
                  <Th k="customer">Khách hàng</Th>
                  <Th k="assets">Vật tư</Th>
                  <th>Cảnh báo</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-faint">Không có điểm đo nào khớp</td></tr>
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
                      <td className="font-mono text-xs font-bold text-accent max-w-[280px] truncate" title={p.line_name}>{p.line_name || '—'}</td>
                      <td className={`px-2 py-2 whitespace-nowrap ${p.station ? 'text-dim' : 'text-warn font-semibold'}`}>
                        {p.station ? stationCode(p.station) : 'chưa gắn'}
                      </td>
                      <td><RoleTag role={p.role} /></td>
                      <td><PointStatusTag status={p.point_status} /></td>
                      {/* Chọn MKH ngay tại ô (user chốt 05/08 — gọn hơn tab riêng).
                          stopPropagation để bấm vào bộ chọn không kéo theo chọn dòng. */}
                      <td onClick={e => e.stopPropagation()}>
                        {editable ? (
                          <Select
                            value={cur?.period.customer ?? ''}
                            onChange={v => doAssignCustomer(p, v)}
                            options={cusOptions}
                            placeholder="— chưa gắn —" searchable variant="bare"
                            className="w-full px-2 py-1.5 rounded-none border-0 text-xs font-bold font-mono"
                          />
                        ) : (
                          <span className="px-2 font-mono text-xs text-soft whitespace-nowrap">
                            {cur?.period.mkh ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className=" text-dim">{at.length || '—'}</td>
                      <td>
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

          <div className="space-y-4 order-first xl:order-none xl:sticky xl:top-4">
            <WarehousePanel
              data={data} zoneId={activeZone} canEditNow={editable}
              picked={assetPick} onPick={setAssetPick}
            />
            {/* Thao tac cua diem do dang chon - truoc day nam o thanh noi duoi
                man hinh, user chot 05/08 dua han vao the ben phai. */}
            {editable && selected && (
              <div className="vl-card p-4 space-y-3 mb-0!">
                <p className="vl-section-title">Thao tác với điểm đo đang chọn</p>
                <p className="text-xs font-mono font-bold text-accent break-words">{selected.line_name}</p>

                <Select
                  value={selected.station || ''}
                  onChange={v => { if (v) doAssignStation(v); }}
                  options={zoneStations.map(st => ({ value: st.id, label: st.code }))}
                  placeholder="Gắn vào trạm…" searchable label="Trạm" className="w-full"
                />

                <div className="flex gap-2">
                  <button onClick={() => doChangeRole('chinh')}
                    disabled={selected.role === 'chinh'}
                    className="vl-btn vl-btn-secondary vl-btn-sm flex-1">Đổi thành Chính</button>
                  <button onClick={() => doChangeRole('phu')}
                    disabled={selected.role === 'phu'}
                    className="vl-btn vl-btn-secondary vl-btn-sm flex-1">Đổi thành Phụ</button>
                </div>

                <div className="border-t border-[var(--border)] pt-3 space-y-2">
                  <p className="text-xs text-soft flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    {assetPick.size > 0
                      ? `Đã chọn ${assetPick.size} vật tư`
                      : 'Tích chọn vật tư ở ngăn kho hoặc ở danh sách đang treo bên dưới'}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={doHang} disabled={assetPick.size === 0}
                      className="vl-btn vl-btn-primary vl-btn-sm flex-1">Treo lên điểm đo</button>
                    <button onClick={doRemove} disabled={assetPick.size === 0}
                      className="vl-btn vl-btn-secondary vl-btn-sm flex-1">Tháo về kho</button>
                  </div>
                </div>
              </div>
            )}

            <PointDetail
              point={selected} data={data} canEditNow={editable}
              picked={assetPick} onPick={setAssetPick}
            />
          </div>
        </div>
      )}

      <ActionConfirmDialog request={pending?.request ?? null} onCancel={() => setPending(null)} onConfirm={confirm} />

      {!isLoading && rows.length > 0 && (
        <p className="text-xs text-faint flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          Hiện {rows.length} điểm đo. Bấm tiêu đề cột để sắp xếp; bấm một dòng rồi thao tác ở thẻ bên phải.
        </p>
      )}
    </div>
  );
}
