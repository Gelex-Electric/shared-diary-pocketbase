import React, { useState, useEffect, useCallback } from 'react';
import { AREAS } from '../lib/pocketbase';
import { kcnColorOf } from '../lib/kcnColors';
import { ZoneSection } from './business/ZoneSection';
import { isAbortError, loadCatalog, pbErrorMessage } from '../lib/dm/repo';
import { customerMetersOf } from '../lib/dm/meterRows';
import type { CustomerMeters } from '../lib/dm/meterRows';
import { useScopeAreas, type Scope } from '../lib/scope';
import {
  MapPin, RefreshCw, ChevronRight,
  CheckCircle2, XCircle, Search, Gauge,
  Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from './ui/Select';
import { toast as notify, type ToastType } from '../lib/toast';

/** Tiêu đề mặc định cho từng loại thông báo (toast hiển thị tiêu đề + nội dung). */
const TOAST_TITLE: Record<ToastType, string> = {
  success: 'Thành công', error: 'Lỗi', warning: 'Lưu ý', info: 'Thông báo', alert: 'Thông báo',
};

/* ---- Types ---- */
type CustomerGroup = CustomerMeters;
type Zone = { area: string; groups: CustomerGroup[] };

/* ================================================================
   Thông tin KH & Công tơ.

   scope='doi'      — khối Vận hành: chỉ KCN của tài khoản, một danh
                      sách phẳng, gom KH theo mã (một KH nằm ở 2 KCN
                      vẫn là MỘT thẻ).
   scope='vanphong' — khối Văn phòng: toàn bộ KCN, chia section theo
                      KCN.

   NGUỒN DỮ LIỆU: danh mục `dm_*` trên PocketBase (user chốt 25/08/2026).
   Trước đây màn này đọc `public/metterinfo.csv` — bản kết xuất từ HES chạy
   theo pipeline nên trễ một ngày và không thấy những gì vừa khai bên Danh mục.
   Việc ghép dữ liệu nằm ở `lib/dm/meterRows.ts`, ở đây chỉ lọc và bày.
================================================================ */
export default function CustomerManager({ scope = 'doi' }: { scope?: Scope }) {
  const [all, setAll] = useState<CustomerGroup[]>([]);
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
  const { areas: effectiveAreas, canPickArea, allLabel, isOffice } = useScopeAreas(scope);

  /* ================================================================
     DATA
  ================================================================ */
  const loadRows = useCallback(async () => {
    setIsLoading(true);
    try {
      setAll(customerMetersOf(await loadCatalog()));
    } catch (err) {
      // Request bị huỷ giữa chừng không phải lỗi — lần nạp mới đang chạy.
      if (isAbortError(err)) return;
      showToast('Không đọc được danh mục: ' + pbErrorMessage(err), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadRows(); }, [loadRows]);

  /**
   * Lọc theo KHÁCH HÀNG. Ô tìm kiếm khớp mã/tên khách, hoặc khớp số công tơ —
   * gõ số công tơ thì thẻ khách hàng chỉ còn đúng công tơ đó cho dễ nhìn.
   */
  const customerGroups = React.useMemo((): CustomerGroup[] => {
    const allowed = new Set(effectiveAreas);
    const term = searchTerm.trim().toLowerCase();
    const out: CustomerGroup[] = [];

    for (const g of all) {
      if (filterArea) { if (g.area !== filterArea) continue; }
      else if (!isOffice && !allowed.has(g.area)) continue;

      if (!term) { out.push(g); continue; }
      const hitCustomer = `${g.name} ${g.code}`.toLowerCase().includes(term);
      const meters = g.meters.filter(m => m.METER_NO.toLowerCase().includes(term));
      if (hitCustomer) out.push(g);
      else if (meters.length) out.push({ ...g, meters });
    }
    return out;
  }, [all, filterArea, effectiveAreas, isOffice, searchTerm]);

  /** Khối Văn phòng: chia section theo KCN. Giữ thứ tự KCN theo `AREAS`. */
  const zones = React.useMemo((): Zone[] => {
    const byZone = new Map<string, CustomerGroup[]>();
    for (const g of customerGroups) {
      const key = g.area || '—';
      const list = byZone.get(key);
      if (list) list.push(g); else byZone.set(key, [g]);
    }
    const order = [...AREAS, '—'];
    return [...byZone.entries()]
      .map(([area, groups]) => ({ area, groups }))
      .sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  }, [customerGroups]);

  const isEmpty = isOffice
    ? zones.every(z => z.groups.length === 0)
    : customerGroups.length === 0;

  /* ================================================================
     ACCORDION
  ================================================================ */
  const toggleExpand = (cid: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });

  /** Thẻ accordion một khách hàng. Bản Văn phòng thêm dải màu KCN bên trái. */
  const renderCard = ({ code, name, area, meters }: CustomerGroup) => {
    // Văn phòng gom theo (KCN, mã) nên id phải kèm KCN mới không đụng nhau.
    const cid = isOffice ? `${area}::${code || name}` : (code || name);
    const isExpanded = expandedIds.has(cid);
    const c = kcnColorOf(area);

    return (
      <div
        key={cid}
        className={`vl-accordion-item ${isExpanded ? 'is-open' : ''}`}
        style={isOffice ? { borderLeft: `3px solid ${c.hex}` } : undefined}
      >

        {/* ---- Card header ---- */}
        <div
          className="vl-accordion-header"
          onClick={() => toggleExpand(cid)}
        >
          <div className="flex-1 flex flex-wrap items-center gap-2.5 min-w-0">
            <span className="font-mono text-xs font-bold text-soft bg-subtle px-2 py-0.5 rounded shrink-0">{code || '—'}</span>
            <span className="font-bold text-ink truncate">{name || '—'}</span>
            {area && (
              <span className={
                isOffice
                  ? `text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0 border ${c.bg} ${c.text} ${c.border}`
                  : 'vl-badge-primary text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0'
              }>
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
                {meters.length === 0 ? (
                  <p className="px-12 py-4 text-sm italic text-faint">
                    Khách hàng này chưa khai công tơ nào trong Danh mục.
                  </p>
                ) : (
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
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

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
          <p className="text-soft text-sm mt-1">
            Danh sách khách hàng và thiết bị đo đếm{isOffice ? ' theo từng KCN' : ''} — lấy từ <b className="text-dim">Danh mục</b>, sửa ở đó thì ở đây đổi theo
          </p>
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

            {canPickArea && (
              <Select value={filterArea} onChange={setFilterArea}
                options={[{ value: '', label: allLabel }, ...effectiveAreas.map(a => ({ value: a, label: a }))]}
                className={isOffice ? 'min-w-[170px]' : 'min-w-[160px]'} />
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
      ) : isEmpty ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-faint">
          <Users className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold">Không có dữ liệu phù hợp</p>
        </div>
      ) : isOffice ? (
        /* ---- Văn phòng: chia section theo KCN ---- */
        <div className="space-y-7">
          {zones.map(({ area, groups }) => (
            <ZoneSection key={area} area={area} count={groups.length} countLabel="khách hàng">
              <div className="vl-accordion">
                {groups.map(renderCard)}
              </div>
            </ZoneSection>
          ))}
        </div>
      ) : (
        /* ---- Vận hành: một danh sách phẳng ---- */
        <div className="vl-accordion">
          {customerGroups.map(renderCard)}
        </div>
      )}
    </div>
  );
}
