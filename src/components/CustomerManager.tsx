import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS } from '../lib/pocketbase';
import { fetchMeterInfo, MeterInfoRow } from '../lib/meterInfo';
import {
  MapPin, RefreshCw, ChevronRight,
  CheckCircle2, XCircle, Search, Gauge,
  Users, AlertCircle, Info, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from './ui/Select';

/* ---- Types ---- */
type CustomerGroup = { code: string; name: string; area: string; meters: MeterInfoRow[] };

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

  /* ---- Toast ---- */
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 4000);
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

  /* ================================================================
     TOAST CONFIG
  ================================================================ */
  const toastCfg = {
    success: { icon: CheckCircle2, cls: 'vl-alert vl-alert-success' },
    error:   { icon: XCircle,      cls: 'vl-alert vl-alert-danger'  },
    warning: { icon: AlertCircle,  cls: 'vl-alert vl-alert-warning' },
    info:    { icon: Info,         cls: 'vl-alert vl-alert-primary' },
  };

  /* ================================================================
     RENDER
  ================================================================ */
  return (
    <div className="space-y-6">

      {/* ---- Toast ---- */}
      <AnimatePresence>
        {toast && (() => {
          const c = toastCfg[toast.type]; const Icon = c.icon;
          return (
            <motion.div key="toast"
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className={`fixed top-4 right-4 z-[120] max-w-sm flex items-center gap-3 px-4 py-3 rounded shadow-xl text-white text-sm font-medium ${c.cls}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button onClick={() => setToast(null)} className="hover:opacity-60"><X className="w-3.5 h-3.5" /></button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ================================================================
          PAGE HEADER + TOOLBAR
      ================================================================ */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Thông tin khách hàng &amp; Công tơ</h2>
          <p className="text-slate-500 text-sm mt-1">Danh sách khách hàng và thiết bị đo đếm (nguồn: metterinfo.csv)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Search */}
            <div className="relative flex-1 md:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Tìm tên, mã KH, số CT..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded text-sm focus:ring-2 focus:ring-[#5a8dee] outline-none"
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
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải dữ liệu...</p>
        </div>
      ) : customerGroups.length === 0 ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-slate-400">
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
                    <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">{code || '—'}</span>
                    <span className="font-bold text-slate-800 truncate">{name || '—'}</span>
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
                          <tbody className="divide-y divide-slate-50">
                            {meters.map(meter => {
                              const isAct = meter.STATUS === 'Yes';
                              return (
                                <tr key={meter.METER_NO} className="hover:bg-[#f4f8ff] transition-colors">
                                  <td className="pl-12">
                                    <span className="font-mono text-sm font-bold text-[#5a8dee] bg-[#e8f3ff] px-2 py-1 rounded">{meter.METER_NO}</span>
                                  </td>
                                  <td><span className="text-sm text-slate-600">{meter.METER_NAME || '—'}</span></td>
                                  <td><span className="text-sm text-slate-600">{meter.METER_MODEL_DESC || '—'}</span></td>
                                  <td><span className="text-sm text-slate-600">{meter.LINE_NAME || '—'}</span></td>
                                  <td><span className="text-sm text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{meter.ADDRESS || '—'}</span></td>
                                  <td>
                                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded ${isAct ? 'vl-badge-success' : 'bg-slate-100 text-slate-400'}`}>
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
