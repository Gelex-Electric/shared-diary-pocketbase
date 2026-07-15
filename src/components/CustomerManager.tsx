import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS } from '../lib/pocketbase';
import { fetchMeterInfo, MeterInfoRow, updateMeterHsn, canEditHsn } from '../lib/meterInfo';
import {
  MapPin, RefreshCw, ChevronRight,
  CheckCircle2, XCircle, Search, Gauge,
  Users, Pencil, Check, X, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from './ui/Select';
import { toast as notify, type ToastType } from '../lib/toast';

/** Tiêu đề mặc định cho từng loại thông báo (toast hiển thị tiêu đề + nội dung). */
const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo', alert: 'Thông báo',
};

/* ---- Types ---- */
type CustomerGroup = { code: string; name: string; area: string; meters: MeterInfoRow[] };

/* ---- Ô hệ số nhân (HSN) sửa tại chỗ ---- */
function HsnCell({ meter, onSaved, showToast }: {
  meter: MeterInfoRow;
  onSaved: (meterNo: string, hsn: number) => void;
  showToast: (msg: string, type?: ToastType) => void;
}) {
  const editable = canEditHsn(meter.CUSTOMER_CODE) && !!meter._id;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(meter.METER_NAME || '');
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5 group/hsn">
        <span className="text-sm text-dim">{meter.METER_NAME || '—'}</span>
        {editable && (
          <button
            onClick={() => { setVal(meter.METER_NAME || ''); setEditing(true); }}
            className="opacity-0 group-hover/hsn:opacity-100 transition-opacity text-soft hover:text-accent"
            title="Sửa hệ số nhân"
          ><Pencil className="w-3.5 h-3.5" /></button>
        )}
      </span>
    );
  }

  const save = async () => {
    const n = Number(String(val).replace(',', '.').trim());
    if (!isFinite(n) || n <= 0) { showToast('Hệ số nhân phải là số dương.', 'error'); return; }
    setSaving(true);
    try {
      await updateMeterHsn(meter._id, n);
      onSaved(meter.METER_NO, n);
      showToast(`Đã cập nhật HSN công tơ ${meter.METER_NO} = ${n}.`, 'success');
      setEditing(false);
    } catch (err: any) {
      showToast('Không lưu được HSN: ' + (err?.message || 'lỗi quyền hoặc mạng'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" autoFocus value={val} disabled={saving}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className="w-24 px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-ink"
      />
      <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700" title="Lưu">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button onClick={() => setEditing(false)} disabled={saving} className="text-soft hover:text-red-600" title="Hủy">
        <X className="w-4 h-4" />
      </button>
    </span>
  );
}

/* ================================================================
   COMPONENT
================================================================ */
export default function CustomerManager() {
  const [rows, setRows] = useState<MeterInfoRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterArea, setFilterArea] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  /* ---- Accordion ---- */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* ---- Toast (dùng chung hệ thống toast của app) ---- */
  const showToast = useCallback((msg: string, type: ToastType = 'info') => {
    notify.show(type, TOAST_TITLE[type], msg);
  }, []);

  /* ---- Area helpers ---- */
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    return Array.isArray(raw)
      ? raw
      : typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  }, [JSON.stringify(pb.authStore.model?.area)]);
  const effectiveAreas = React.useMemo(() => (userAreas.length > 0 ? userAreas : AREAS), [userAreas]);

  /* ================================================================
     DATA
  ================================================================ */
  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchMeterInfo();
      setRows(data);
    } catch (err: any) {
      showToast('Lỗi tải metterinfo.csv: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const filteredRows = React.useMemo(() => {
    const allowed = new Set(effectiveAreas);
    const term = searchTerm.trim().toLowerCase();
    return rows.filter(r => {
      if (filterArea) { if (r.ADDRESS !== filterArea) return false; }
      else if (!allowed.has(r.ADDRESS)) return false;
      if (term) {
        const hay = `${r.METER_NO} ${r.CUSTOMER_NAME} ${r.CUSTOMER_CODE}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filterArea, effectiveAreas, searchTerm]);

  const customerGroups = React.useMemo((): CustomerGroup[] => {
    const map = new Map<string, CustomerGroup>();
    for (const r of filteredRows) {
      const key = r.CUSTOMER_CODE || r.CUSTOMER_NAME;
      if (!map.has(key)) map.set(key, { code: r.CUSTOMER_CODE, name: r.CUSTOMER_NAME, area: r.ADDRESS, meters: [] });
      map.get(key)!.meters.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [filteredRows]);

  /* ================================================================
     ACCORDION
  ================================================================ */
  const toggleExpand = (cid: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });

  /* Cập nhật HSN vừa sửa vào state để hiển thị ngay (không phải tải lại cả danh sách). */
  const onHsnSaved = useCallback((meterNo: string, hsn: number) => {
    setRows(prev => prev.map(r => (r.METER_NO === meterNo ? { ...r, METER_NAME: String(hsn) } : r)));
  }, []);


  /* ================================================================
     RENDER
  ================================================================ */
  return (
    <div className="space-y-6">

      {/* ================================================================
          PAGE HEADER + TOOLBAR
      ================================================================ */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Thông tin khách hàng &amp; Công tơ</h2>
          <p className="text-soft text-sm mt-1">Danh sách khách hàng và thiết bị đo đếm (Đồng bộ trực tiếp từ HES sau mỗi 1 ngày)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Search */}
            <div className="relative flex-1 md:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
              <input type="text" placeholder="Tìm tên, mã KH, số CT..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none"
              />
            </div>

            {userAreas.length !== 1 && (
              <Select value={filterArea} onChange={setFilterArea}
                options={[{ value: '', label: 'Tất cả khu vực' }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
                className="min-w-[160px]" />
            )}
          </div>
      </div>

      {/* ================================================================
          MAIN CONTENT
      ================================================================ */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-faint">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải dữ liệu...</p>
        </div>
      ) : customerGroups.length === 0 ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
          <Users className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold">Không có dữ liệu phù hợp</p>
        </div>
      ) : (
        /* ============================================================
           CUSTOMER ACCORDION CARDS
        ============================================================ */
        <div className="vl-accordion">
          {customerGroups.map(({ code, name, area, meters }) => {
            const cid = code || name;
            const isExpanded = expandedIds.has(cid);

            return (
              <div key={cid} className={`vl-accordion-item ${isExpanded ? 'is-open' : ''}`}>

                {/* ---- Card header ---- */}
                <div
                  className="vl-accordion-header"
                  onClick={() => toggleExpand(cid)}
                >
                  <div className="flex-1 flex flex-wrap items-center gap-2.5 min-w-0">
                    <span className="font-mono text-xs font-bold text-soft bg-subtle px-2 py-0.5 rounded shrink-0">{code || '—'}</span>
                    <span className="font-bold text-ink truncate">{name || '—'}</span>
                    {area && (
                      <span className="vl-badge-primary text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                        <MapPin className="w-3 h-3" />{area}
                      </span>
                    )}
                    <span className="vl-badge-info text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                      <Gauge className="w-3 h-3" />{meters.length} công tơ
                    </span>
                  </div>
                  <ChevronRight className="vl-accordion-chevron w-5 h-5" style={{ marginLeft: '0.5rem' }} />
                </div>

                {/* ---- Expanded meter table ---- */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <div className="vl-accordion-body">
                        <table className="vl-table w-full text-left border-collapse">
                          <thead>
                            <tr>
                              <th className="pl-12">Số công tơ</th>
                              <th>Hệ số nhân</th>
                              <th>Loại CT</th>
                              <th>Trạm</th>
                              <th>Khu vực</th>
                              <th>Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {meters.map(meter => {
                              const isAct = meter.STATUS === 'Yes';
                              return (
                                <tr key={meter.METER_NO} className="hover:bg-accent-soft transition-colors">
                                  <td className="pl-12">
                                    <span className="font-mono text-sm font-bold text-accent bg-accent-soft px-2 py-1 rounded">{meter.METER_NO}</span>
                                  </td>
                                  <td><HsnCell meter={meter} onSaved={onHsnSaved} showToast={showToast} /></td>
                                  <td><span className="text-sm text-dim">{meter.METER_MODEL_DESC || '—'}</span></td>
                                  <td><span className="text-sm text-dim">{meter.LINE_NAME || '—'}</span></td>
                                  <td><span className="text-sm text-soft flex items-center gap-1"><MapPin className="w-3 h-3" />{meter.ADDRESS || '—'}</span></td>
                                  <td>
                                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded ${isAct ? 'vl-badge-success' : 'bg-subtle text-faint'}`}>
                                      {isAct ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                      {isAct ? 'Hoạt động' : 'Ngừng'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
