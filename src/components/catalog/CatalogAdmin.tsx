import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw, Plus, Pencil, Trash2, Search, Lock, AlertTriangle, Ban, Archive,
} from 'lucide-react';
import { toast as notify } from '../../lib/toast';
import {
  fetchCatalog, type CatalogData, ASSET_TYPE_LABEL, ASSET_STATUS_LABEL,
  POINT_STATUS_LABEL,
} from '../../lib/catalog';
import { canEdit } from '../../lib/dnd';
import {
  type EntityKind, ENTITY_LABEL, deleteBlockers, assetHasLedger,
  createRecord, updateRecord, deleteRecord, liquidateAsset,
} from '../../lib/catalogCrud';
import RecordForm from './RecordForm';

const EMPTY: CatalogData = {
  zones: [], stations: [], customers: [], points: [], periods: [],
  warehouses: [], assets: [], installs: [],
};

const TABS: EntityKind[] = ['zone', 'station', 'point', 'asset', 'warehouse'];

/** Trang QUẢN LÝ DANH MỤC — thêm / sửa / xóa. Kéo thả nằm ở trang riêng. */
export default function CatalogAdmin() {
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<EntityKind>('zone');
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<{ kind: EntityKind; record: any | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ kind: EntityKind; record: any; blockers: string[]; ledger: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const editable = canEdit();

  const load = useCallback(async () => {
    setIsLoading(true);
    try { setData(await fetchCatalog()); }
    catch (err: any) { notify.show('error', 'Lỗi', 'Không tải được danh mục: ' + (err?.message || err)); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const zoneName = (id: string) => data.zones.find(z => z.id === id)?.code ?? '—';
  const stationCode = (id: string) => data.stations.find(s => s.id === id)?.code ?? '—';
  const whName = (id: string) => data.warehouses.find(w => w.id === id)?.code ?? '—';

  /** Danh sách + cột hiển thị cho tab đang chọn. */
  const view = useMemo(() => {
    const t = term.trim().toLowerCase();
    const hit = (s: string) => !t || s.toLowerCase().includes(t);

    switch (tab) {
      case 'zone':
        return {
          cols: ['Mã', 'Tên', 'Nhãn khu vực', 'Trạm', 'Điểm đo'],
          rows: data.zones.filter(z => hit(`${z.code} ${z.name}`)).map(z => ({
            rec: z,
            cells: [z.code, z.name, z.area_label || '—',
              String(data.stations.filter(s => s.zone === z.id).length),
              String(data.points.filter(p => p.zone === z.id).length)],
          })),
        };
      case 'station':
        return {
          cols: ['Mã trạm', 'KCN', 'Sdm (kVA)', 'P0 (kW)', 'Pk (kW)', 'Điểm đo'],
          rows: data.stations.filter(s => hit(`${s.code} ${s.name}`)).map(s => ({
            rec: s,
            cells: [s.code, zoneName(s.zone),
              s.sdm_kva ? String(s.sdm_kva) : '—',
              s.p0_kw != null ? String(s.p0_kw) : '—',
              s.pk_kw != null ? String(s.pk_kw) : '—',
              String(data.points.filter(p => p.station === s.id).length)],
            warn: !(s.sdm_kva && s.p0_kw && s.pk_kw) ? 'Thiếu thông số MBA — không tính được tổn thất' : '',
          })),
        };
      case 'point':
        return {
          cols: ['Mã', 'Tên điểm đo', 'Trạm', 'KCN', 'Vai trò', 'Trạng thái', 'HSN hóa đơn'],
          rows: data.points.filter(p => hit(`${p.line_id} ${p.line_name}`)).map(p => ({
            rec: p,
            cells: [p.line_id, p.line_name || '—',
              p.station ? stationCode(p.station) : '—', zoneName(p.zone),
              p.role === 'chinh' ? 'Chính' : p.role === 'phu' ? 'Phụ' : '—',
              POINT_STATUS_LABEL[p.point_status] ?? p.point_status,
              p.hsn_invoice != null ? String(p.hsn_invoice) : '—'],
            warn: !p.station ? 'Chưa gắn trạm' : (p.hsn_invoice === 0 ? 'HSN hóa đơn = 0, bất thường' : ''),
          })),
        };
      case 'asset':
        return {
          cols: ['Số hiệu', 'Loại', 'Tỷ số', 'Năm SX', 'Hạn KĐ', 'Trạng thái', 'Vị trí'],
          rows: data.assets.filter(a => hit(`${a.serial} ${a.model_desc ?? ''}`)).map(a => {
            const at = data.installs.find(i => i.asset === a.id && i.is_current);
            const pt = at ? data.points.find(p => p.id === at.point) : undefined;
            const overdue = a.type !== 'GP03' && a.next_calibration
              && a.next_calibration.slice(0, 10) < new Date().toISOString().slice(0, 10);
            return {
              rec: a,
              cells: [a.serial, ASSET_TYPE_LABEL[a.type] ?? a.type,
                a.ratio ? `${a.ratio_primary}/${a.ratio_secondary}` : '—',
                a.manufacture_year ? String(a.manufacture_year) : '—',
                a.next_calibration?.slice(0, 10) ?? '—',
                ASSET_STATUS_LABEL[a.current_status] ?? a.current_status,
                pt ? `điểm đo ${pt.line_id}` : (a.current_warehouse ? whName(a.current_warehouse) : '—')],
              warn: overdue ? 'Quá hạn kiểm định' : '',
            };
          }),
        };
      case 'warehouse':
        return {
          cols: ['Mã kho', 'Tên', 'KCN', 'Vật tư trong kho'],
          rows: data.warehouses.filter(w => hit(`${w.code} ${w.name}`)).map(w => ({
            rec: w,
            cells: [w.code, w.name, zoneName(w.zone),
              String(data.assets.filter(a => a.current_warehouse === w.id).length)],
          })),
        };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data, term]);

  const askDelete = async (rec: any) => {
    const blockers = deleteBlockers(tab, rec.id, data);
    let ledger = 0;
    if (tab === 'asset') {
      try { ledger = await assetHasLedger(rec.id); }
      catch { ledger = -1; }   // không đọc được ⇒ coi như có, chặn cho an toàn
    }
    setConfirmDel({ kind: tab, record: rec, blockers, ledger });
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteRecord(confirmDel.kind, confirmDel.record.id);
      notify.show('success', 'Đã xóa', `${ENTITY_LABEL[confirmDel.kind]} ${confirmDel.record.code ?? confirmDel.record.serial ?? confirmDel.record.line_id}`);
      setConfirmDel(null);
      await load();
    } catch (err: any) {
      notify.show('error', 'Xóa thất bại', err?.message || String(err));
    } finally { setBusy(false); }
  };

  const doLiquidate = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await liquidateAsset(
        confirmDel.record.id, confirmDel.record.serial,
        new Date().toISOString().slice(0, 10), '', 'Thanh lý từ trang quản lý danh mục',
      );
      notify.show('success', 'Đã thanh lý', confirmDel.record.serial);
      setConfirmDel(null);
      await load();
    } catch (err: any) {
      notify.show('error', 'Thanh lý thất bại', err?.message || String(err));
    } finally { setBusy(false); }
  };

  const save = async (body: Record<string, any>) => {
    if (!editing) return;
    if (editing.record) await updateRecord(editing.kind, editing.record.id, body);
    else await createRecord(editing.kind, body);
    notify.show('success', editing.record ? 'Đã cập nhật' : 'Đã thêm', ENTITY_LABEL[editing.kind]);
    setEditing(null);
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Quản lý danh mục</h2>
          <p className="text-soft text-sm mt-1">
            Thêm, sửa, xóa khu công nghiệp / trạm / điểm đo / vật tư / kho.
            Việc gắn chúng vào nhau nằm ở trang <strong>Sắp xếp điểm đo</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Tìm..."
              className="w-full pl-10 pr-4 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
          </div>
          <button onClick={load} className="p-2 rounded border border-[var(--border)] text-soft hover:bg-subtle transition-colors" title="Tải lại">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {editable && (
            <button onClick={() => setEditing({ kind: tab, record: null })}
              className="flex items-center gap-2 px-3 py-2 rounded bg-accent text-[var(--on-accent)] text-sm font-bold hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" />Thêm {ENTITY_LABEL[tab].toLowerCase()}
            </button>
          )}
        </div>
      </div>

      {!editable && (
        <p className="text-xs bg-subtle text-soft font-bold px-3 py-2 rounded flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />Tài khoản vận hành chỉ xem được, không sửa danh mục.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); setTerm(''); }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-soft hover:text-dim'
            }`}>
            {ENTITY_LABEL[t]}
            <span className="ml-1.5 text-xs text-faint">
              {t === 'zone' ? data.zones.length : t === 'station' ? data.stations.length
                : t === 'point' ? data.points.length : t === 'asset' ? data.assets.length
                : data.warehouses.length}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-faint">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải...</p>
        </div>
      ) : (
        <div className="vl-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle">
              <tr className="text-left text-xs text-soft">
                {view!.cols.map(c => <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>)}
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {view!.rows.length === 0 ? (
                <tr><td colSpan={view!.cols.length + 1} className="px-3 py-8 text-center text-faint">Không có dữ liệu</td></tr>
              ) : view!.rows.map(({ rec, cells, warn }: any) => (
                <tr key={rec.id} className="hover:bg-subtle transition-colors">
                  {cells.map((c: string, i: number) => (
                    <td key={i} className={`px-3 py-2 whitespace-nowrap ${i === 0 ? 'font-mono text-xs font-bold text-accent' : 'text-dim'}`}>
                      {c}
                      {i === cells.length - 1 && warn && (
                        <span className="ml-2 text-[0.65rem] text-warn inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />{warn}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {editable && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditing({ kind: tab, record: rec })}
                          className="p-1.5 rounded text-soft hover:bg-accent-soft hover:text-accent transition-colors" title="Sửa">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => askDelete(rec)}
                          className="p-1.5 rounded text-soft hover:bg-[var(--danger-soft)] hover:text-bad transition-colors" title="Xóa">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RecordForm kind={editing.kind} record={editing.record} data={data}
          onClose={() => setEditing(null)} onSave={save} />
      )}

      {/* Xác nhận xóa — chặn khi còn phụ thuộc */}
      {confirmDel && (() => {
        const isAsset = confirmDel.kind === 'asset';
        const hasLedger = isAsset && confirmDel.ledger !== 0;
        const blocked = confirmDel.blockers.length > 0 || hasLedger;
        const name = confirmDel.record.code ?? confirmDel.record.serial ?? confirmDel.record.line_id;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setConfirmDel(null)}>
            <div className="vl-card w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-ink">
                {blocked ? 'Không xóa được' : 'Xác nhận xóa'}
              </h3>
              <p className="text-sm text-dim">
                {ENTITY_LABEL[confirmDel.kind]} <strong className="font-mono">{name}</strong>
              </p>

              {blocked ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm text-warn bg-[var(--warning-soft)] rounded p-3">
                    <Ban className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      {confirmDel.blockers.length > 0 && (
                        <p>Đang bị tham chiếu: {confirmDel.blockers.join(', ')}. Phải gỡ hoặc chuyển chúng đi trước.</p>
                      )}
                      {hasLedger && (
                        <p className={confirmDel.blockers.length ? 'mt-1' : ''}>
                          {confirmDel.ledger > 0
                            ? `Vật tư đã có ${confirmDel.ledger} bản ghi trong sổ cái.`
                            : 'Không đọc được sổ cái — chặn xóa cho an toàn.'}
                          {' '}Sổ cái không sửa/xóa được, nên chỉ có thể thanh lý.
                        </p>
                      )}
                    </div>
                  </div>
                  {isAsset && confirmDel.record.current_status !== 'thanh_ly' && (
                    <button onClick={doLiquidate} disabled={busy}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded text-sm font-bold border border-[var(--border)] text-soft hover:bg-subtle transition-colors disabled:opacity-50">
                      <Archive className="w-4 h-4" />
                      {busy ? 'Đang ghi...' : 'Thanh lý vật tư này thay vì xóa'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-soft">Thao tác này không hoàn tác được.</p>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDel(null)} disabled={busy}
                  className="px-4 py-2 rounded text-sm font-semibold text-soft border border-[var(--border)] hover:bg-subtle transition-colors disabled:opacity-50">
                  Đóng
                </button>
                {!blocked && (
                  <button onClick={doDelete} disabled={busy}
                    className="px-4 py-2 rounded text-sm font-bold bg-[var(--danger)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                    {busy ? 'Đang xóa...' : 'Xóa'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
