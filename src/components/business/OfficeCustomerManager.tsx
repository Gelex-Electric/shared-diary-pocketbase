import React, { useState, useEffect, useCallback } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { kcnColorOf } from '../../lib/kcnColors';
import { fetchMeterInfo, MeterInfoRow } from '../../lib/meterInfo';
import {
  MapPin, RefreshCw, ChevronRight,
  CheckCircle2, XCircle, Search, Gauge, Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from '../ui/Select';
import { toast as notify, type ToastType } from '../../lib/toast';

const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo', alert: 'Thông báo',
};

type CustomerGroup = { code: string; name: string; area: string; meters: MeterInfoRow[] };
type ZoneSection = { area: string; groups: CustomerGroup[] };

/* ================================================================
   Thông tin KH & Công tơ — bản khối Văn phòng.
   Khác bản Vận hành: bộ chọn KCN luôn hiện (có "Tất cả"); khi xem
   tất cả thì chia section theo KCN với tiêu đề + badge màu riêng.
================================================================ */
export default function OfficeCustomerManager() {
  const [rows, setRows] = useState<MeterInfoRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterArea, setFilterArea] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const showToast = useCallback((msg: string, type: ToastType = 'info') => {
    notify.show(type, TOAST_TITLE[type], msg);
  }, []);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await fetchMeterInfo());
    } catch (err: any) {
      showToast('Lỗi tải dữ liệu công tơ: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const filteredRows = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter(r => {
      if (filterArea && r.ADDRESS !== filterArea) return false;
      if (term) {
        const hay = `${r.METER_NO} ${r.CUSTOMER_NAME} ${r.CUSTOMER_CODE}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filterArea, searchTerm]);

  /** Gom KH theo KCN → section. Giữ thứ tự KCN theo AREAS. */
  const zoneSections = React.useMemo((): ZoneSection[] => {
    const byZone = new Map<string, Map<string, CustomerGroup>>();
    for (const r of filteredRows) {
      const zone = r.ADDRESS || '—';
      if (!byZone.has(zone)) byZone.set(zone, new Map());
      const gmap = byZone.get(zone)!;
      const key = r.CUSTOMER_CODE || r.CUSTOMER_NAME;
      if (!gmap.has(key)) gmap.set(key, { code: r.CUSTOMER_CODE, name: r.CUSTOMER_NAME, area: r.ADDRESS, meters: [] });
      gmap.get(key)!.meters.push(r);
    }
    const order = [...AREAS, '—'];
    return Array.from(byZone.entries())
      .map(([area, gmap]) => ({
        area,
        groups: Array.from(gmap.values()).sort((a, b) => a.code.localeCompare(b.code)),
      }))
      .sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  }, [filteredRows]);

  const totalGroups = React.useMemo(
    () => zoneSections.reduce((s, z) => s + z.groups.length, 0), [zoneSections]);

  const toggleExpand = (cid: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });

  const renderCard = ({ code, name, area, meters }: CustomerGroup) => {
    const cid = `${area}::${code || name}`;
    const isExpanded = expandedIds.has(cid);
    const c = kcnColorOf(area);
    return (
      <div key={cid} className={`vl-accordion-item ${isExpanded ? 'is-open' : ''}`} style={{ borderLeft: `3px solid ${c.hex}` }}>
        <div className="vl-accordion-header" onClick={() => toggleExpand(cid)}>
          <div className="flex-1 flex flex-wrap items-center gap-2.5 min-w-0">
            <span className="font-mono text-xs font-bold text-soft bg-subtle px-2 py-0.5 rounded shrink-0">{code || '—'}</span>
            <span className="font-bold text-ink truncate">{name || '—'}</span>
            {area && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0 border ${c.bg} ${c.text} ${c.border}`}>
                <MapPin className="w-3 h-3" />{area}
              </span>
            )}
            <span className="vl-badge-info text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
              <Gauge className="w-3 h-3" />{meters.length} công tơ
            </span>
          </div>
          <ChevronRight className="vl-accordion-chevron w-5 h-5" style={{ marginLeft: '0.5rem' }} />
        </div>
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden"
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
                          <td><span className="text-sm text-dim">{meter.METER_NAME || '—'}</span></td>
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
  };

  return (
    <div className="space-y-6">
      {/* Header + toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Thông tin khách hàng &amp; Công tơ</h2>
          <p className="text-soft text-sm mt-1">Danh sách khách hàng và thiết bị đo đếm theo từng KCN (Đồng bộ trực tiếp từ HES sau mỗi 1 ngày)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
            <input type="text" placeholder="Tìm tên, mã KH, số CT..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none"
            />
          </div>
          <Select value={filterArea} onChange={setFilterArea}
            options={[{ value: '', label: 'Tất cả KCN' }, ...AREAS.map(a => ({ value: a, label: a }))]}
            className="min-w-[170px]" />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-faint">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải dữ liệu...</p>
        </div>
      ) : totalGroups === 0 ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
          <Users className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold">Không có dữ liệu phù hợp</p>
        </div>
      ) : (
        <div className="space-y-7">
          {zoneSections.map(({ area, groups }) => {
            const c = kcnColorOf(area);
            return (
              <section key={area}>
                <div className={`flex items-center gap-2.5 mb-3 px-3 py-2 rounded-lg border ${c.bg} ${c.border}`}>
                  <span className={`w-3 h-3 rounded-full ${c.dot}`} />
                  <h3 className={`text-sm font-bold ${c.text}`}>{area}</h3>
                  <span className="text-xs font-semibold text-soft">· {groups.length} khách hàng</span>
                </div>
                <div className="vl-accordion">
                  {groups.map(renderCard)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
