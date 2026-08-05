import { useState, useEffect, useCallback } from 'react';
import {
  X, RefreshCw, AlertTriangle, PackagePlus, ArrowLeftRight, Gauge,
  ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Trash2, Info,
} from 'lucide-react';
import { toast as notify } from '../../lib/toast';
import { type Asset, type CatalogData, viDate, ASSET_TYPE_LABEL, isAbortError } from '../../lib/catalog';
import {
  fetchLedger, actionsFor, noActionReason, applyLifecycle, EVENT_LABEL,
  type ActionDef, type ActionId, type LedgerEvent,
} from '../../lib/lifecycle';
import { Select } from '../ui/Select';
import { AssetTypeTag, AssetStatusTag, LocationTag, OverdueTag } from './tags';

const EVENT_ICON: Record<string, typeof Info> = {
  nhap_kho: PackagePlus, dieu_chuyen: ArrowLeftRight, treo: ArrowUpFromLine,
  thao: ArrowDownToLine, gui_kiem_dinh: ShieldCheck, ket_qua_kiem_dinh: ShieldCheck,
  thanh_ly: Trash2,
};

/**
 * Vòng đời một vật tư (task 7): sổ cái + các thao tác hợp lệ theo trạng thái.
 *
 * Treo/tháo KHÔNG có ở đây — hai việc đó gắn với điểm đo nên nằm ở trang
 * "Sắp xếp điểm đo", tránh hai chỗ làm cùng một việc theo hai cách khác nhau.
 */
export default function AssetLifecycle({
  asset, data, canEditNow, onClose, onChanged,
}: {
  asset: Asset;
  data: CatalogData;
  canEditNow: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [act, setAct] = useState<ActionDef | null>(null);
  const [date, setDate] = useState(today);
  const [docNo, setDocNo] = useState('');
  const [note, setNote] = useState('');
  const [whId, setWhId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLedger(await fetchLedger(asset.id));
    } catch (e: any) {
      if (!isAbortError(e)) notify.show('error', 'Lỗi', 'Không đọc được sổ cái: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [asset.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDate(today); setDocNo(''); setNote(''); setWhId(''); }, [act, today]);

  const actions = actionsFor(asset);
  const blockedReason = noActionReason(asset);

  const run = async () => {
    if (!act) return;
    setBusy(true);
    try {
      const msg = await applyLifecycle(act.id as ActionId, asset, data,
        { date, documentNo: docNo, note, warehouseId: whId });
      notify.show('success', EVENT_LABEL[act.id] ?? act.label, msg);
      setAct(null);
      await load();
      onChanged();
    } catch (e: any) {
      const detail = e?.response?.data
        ? Object.entries(e.response.data).map(([k, x]: any) => `${k}: ${x?.message ?? x}`).join('; ')
        : (e?.message || String(e));
      notify.show('error', 'Không ghi được', detail);
    } finally { setBusy(false); }
  };

  const whName = (id: string) => data.warehouses.find(w => w.id === id)?.name ?? '';
  const ptName = (id: string) => {
    const p = data.points.find(x => x.id === id);
    return p ? `điểm đo ${p.line_id}` : '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="vl-card w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-5" onClick={e => e.stopPropagation()}>

        {/* Tiêu đề + trạng thái */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-ink font-mono">{asset.serial}</h3>
              <AssetTypeTag asset={{ type: asset.type }} />
              <AssetStatusTag status={asset.current_status} />
              <LocationTag asset={asset} data={data} />
              <OverdueTag asset={asset} />
            </div>
            <p className="text-xs text-soft">
              {ASSET_TYPE_LABEL[asset.type]}
              {asset.ratio ? ` · tỷ số ${asset.ratio_primary}/${asset.ratio_secondary} = ${asset.ratio}` : ''}
              {asset.manufacture_year ? ` · SX ${asset.manufacture_year}` : ''}
              {asset.next_calibration ? ` · hạn KĐ ${viDate(asset.next_calibration)}` : ' · không kiểm định'}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-faint hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thao tác */}
        <section>
          <p className="vl-section-title">Thao tác</p>
          {!canEditNow ? (
            <p className="mt-2 text-sm text-faint">Tài khoản vận hành chỉ xem được.</p>
          ) : actions.length === 0 ? (
            <p className="mt-2 text-sm text-warn flex items-start gap-1.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />{blockedReason || 'Không có thao tác nào khả dụng.'}
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {actions.map(a => (
                <button key={a.id} onClick={() => setAct(a)}
                  className={`vl-btn vl-btn-sm ${
                    a.danger ? 'vl-btn-danger' : 'vl-btn-secondary'
                  } ${act?.id === a.id ? 'ring-2 ring-accent' : ''}`}>
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {act && (
            <div className="mt-3 p-3 rounded border border-[var(--border)] bg-subtle space-y-3">
              <p className="text-sm font-bold text-ink">{act.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-soft">Ngày hiệu lực *</span>
                  <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
                    className="mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm outline-none focus:ring-2 focus:ring-accent" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-soft">Số biên bản</span>
                  <input type="text" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="BB-2026-…"
                    className="mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm outline-none focus:ring-2 focus:ring-accent" />
                </label>
                {act.needsWarehouse && (
                  <label className="block">
                    <span className="text-xs font-semibold text-soft">
                      {act.id === 'ket_qua_dat' ? 'Kho nhận về *' : 'Kho đích *'}
                    </span>
                    <div className="mt-1">
                      <Select
                        value={whId} onChange={setWhId}
                        options={data.warehouses.map(w => ({ value: w.id, label: w.name }))}
                        placeholder="— chọn kho —"
                      />
                    </div>
                  </label>
                )}
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-soft">
                  Ghi chú{act.id === 'gui_kiem_dinh' && ' (tên đơn vị kiểm định)'}
                </span>
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm outline-none focus:ring-2 focus:ring-accent" />
              </label>

              <p className="text-xs text-warn flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Ghi vào sổ cái — <strong>không sửa/xoá được</strong>. Sai thì phải ghi nghiệp vụ ngược lại.
                {act.id === 'ket_qua_dat' && ' Hạn kiểm định mới sẽ tính từ ngày hiệu lực ở trên.'}
              </p>

              <div className="flex justify-end gap-2">
                <button onClick={() => setAct(null)} disabled={busy}
                  className="vl-btn vl-btn-secondary">
                  Hủy
                </button>
                <button onClick={run} disabled={busy || date > today || (act.needsWarehouse && !whId)}
                  className="vl-btn vl-btn-primary">
                  {busy ? 'Đang ghi...' : 'Xác nhận'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Sổ cái */}
        <section>
          <p className="vl-section-title flex items-center gap-2">
            <Gauge className="w-4 h-4" />Sổ cái vòng đời ({ledger.length} bản ghi)
          </p>
          {loading ? (
            <div className="py-8 flex justify-center text-faint"><RefreshCw className="w-6 h-6 animate-spin" /></div>
          ) : ledger.length === 0 ? (
            <p className="mt-2 text-sm text-faint">Chưa có bản ghi nào.</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {ledger.map(ev => {
                const Icon = EVENT_ICON[ev.event] ?? Info;
                const from = whName(ev.from_warehouse) || ptName(ev.from_point);
                const to = whName(ev.to_warehouse) || ptName(ev.to_point);
                return (
                  <li key={ev.id} className="flex gap-3 p-3 rounded border border-[var(--border)]">
                    <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${
                      ev.event === 'thanh_ly' ? 'text-bad'
                        : ev.result === 'khong_dat' ? 'text-bad'
                        : ev.result === 'dat' ? 'text-[var(--success)]' : 'text-soft'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-ink">{EVENT_LABEL[ev.event] ?? ev.event}</span>
                        {ev.result && (
                          <span className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded ${
                            ev.result === 'dat' ? 'vl-badge-success' : 'vl-badge-warning'
                          }`}>
                            {ev.result === 'dat' ? 'ĐẠT' : 'KHÔNG ĐẠT'}
                          </span>
                        )}
                        <span className="text-xs text-faint">{viDate(ev.at)}</span>
                        {ev.document_no && <span className="text-xs font-mono text-soft">{ev.document_no}</span>}
                      </div>
                      {(from || to) && (
                        <p className="text-xs text-soft mt-0.5">
                          {from && <>từ <strong>{from}</strong></>}
                          {from && to && ' → '}
                          {to && <>đến <strong>{to}</strong></>}
                        </p>
                      )}
                      {ev.note && <p className="text-xs text-faint mt-0.5 break-words">{ev.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
