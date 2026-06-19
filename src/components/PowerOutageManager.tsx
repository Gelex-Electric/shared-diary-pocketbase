import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, ID_TO_AREA } from '../lib/pocketbase';
import { fetchMeterInfo } from '../lib/meterInfo';
import { PowerOutage, OutageCustomer, OutageSlot, OutageAppendix } from '../types';
import {
  Plus, Trash2, Edit2, X, CheckCircle2, XCircle, AlertCircle, Info,
  Search, Download, RefreshCw, ZapOff, AlertTriangle,
  CalendarClock, Users, MapPin, CheckSquare, Square, BookOpen, UserPlus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from './ui/Select';
import { DatePicker, TimePicker } from './ui/DateTimePickers';
import { useConfirm } from './ui/ConfirmDialog';
import { generateOutageDocx } from '../lib/outageDocx';

const TYPE_LABEL: Record<PowerOutage['type'], string> = {
  emergency: 'Khẩn cấp',
  planned: 'Theo kế hoạch',
};

/* ── helpers ── */
const p2 = (n: number) => String(n).padStart(2, '0');
const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
};
const fmtNoticeDateSave = (s: string) => {
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `Ngày ${Number(d)} tháng ${Number(m)} năm ${y}`;
};
const parseNoticeDateEdit = (text: string) => {
  const match = text.match(/Ngày\s+(\d+)\s+tháng\s+(\d+)\s+năm\s+(\d+)/);
  if (!match) return todayStr();
  const [, d, m, y] = match;
  return `${y}-${p2(Number(m))}-${p2(Number(d))}`;
};
const splitDT = (dt: string) => {
  if (!dt) return { date: todayStr(), time: '00:00' };
  const parts = dt.includes('T') ? dt.split('T') : dt.split(' ');
  return { date: parts[0] || todayStr(), time: (parts[1] || '00:00').substring(0, 5) };
};
const joinDT = (date: string, time: string) => `${date} ${time}:00`;
const fmtFull = (dt: string) => {
  if (!dt) return '---';
  const d = new Date(dt.includes('Z') ? dt : dt + 'Z');
  if (isNaN(d.getTime())) return '---';
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
const fmtDate = (dt: string) => {
  if (!dt) return '---';
  const d = new Date(dt.includes('Z') ? dt : dt + 'Z');
  if (isNaN(d.getTime())) return '---';
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

type ToastType = 'success' | 'error' | 'warning' | 'info';

/* ── slot form ── */
interface SlotForm {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  scope: string;
  appendixIndex: number;
}
const emptySlot = (): SlotForm => ({
  startDate: todayStr(), startTime: '08:00',
  endDate: todayStr(),   endTime: '12:00',
  scope: '', appendixIndex: 0,
});

/* ── appendix form ── */
interface AppendixForm {
  selectedIds: string[];
  search: string;
}
const emptyAppendix = (): AppendixForm => ({ selectedIds: [], search: '' });

export default function PowerOutageManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [notices, setNotices] = useState<PowerOutage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [filterArea, setFilterArea] = useState('');
  const [filterMonth, setFilterMonth] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${p2(t.getMonth() + 1)}`;
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  /* meta */
  const [noticeDate, setNoticeDate] = useState(todayStr());
  const [type, setType] = useState<PowerOutage['type']>('planned');
  const [area, setArea] = useState('');
  const [reason, setReason] = useState('');
  const [addLegal, setAddLegal] = useState('');

  /* slots & appendices */
  const [slots, setSlots] = useState<SlotForm[]>([emptySlot()]);
  const [appendices, setAppendices] = useState<AppendixForm[]>([emptyAppendix()]);

  const [customerList, setCustomerList] = useState<OutageCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  /* khách hàng nhập tay (ngoài danh sách CSV) */
  const [manualCustomers, setManualCustomers] = useState<OutageCustomer[]>([]);
  const [manualForm, setManualForm] = useState<{ appIdx: number; MKH: string; Name: string } | null>(null);

  const allCustomers = React.useMemo(() => {
    const map = new Map<string, OutageCustomer>();
    customerList.forEach(c => map.set(c.id, c));
    manualCustomers.forEach(c => map.set(c.id, c));
    return Array.from(map.values());
  }, [customerList, manualCustomers]);

  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const showToast = useCallback((message: string, t: ToastType = 'info') => {
    setToast({ message, type: t });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const userAreas = React.useMemo(() => {
    const raw = (pb.authStore.model as any)?.areas || pb.authStore.model?.area;
    const items = Array.isArray(raw)
      ? raw
      : (typeof raw === 'string' ? raw.split(',').map((s: string) => s.trim()).filter(Boolean) : []);
    return items.map((item: string) => ID_TO_AREA[item] || item);
  }, [JSON.stringify((pb.authStore.model as any)?.areas), JSON.stringify(pb.authStore.model?.area)]);

  const effectiveAreas = React.useMemo(
    () => (userAreas.length > 0 ? userAreas : AREAS),
    [userAreas],
  );

  /* load notices */
  const loadNotices = useCallback(async () => {
    setIsLoading(true);
    try {
      const parts: string[] = [];
      if (filterArea) {
        parts.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        parts.push(`(${userAreas.map((a: string) => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ')})`);
      }
      const result = await pb.collection('PowerOutage').getFullList<PowerOutage>({
        filter: parts.join(' && '),
        sort: '-created',
        requestKey: null,
      });
      setNotices(result);
    } catch (err: any) {
      showToast(`Lỗi tải thông báo: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, userAreas, showToast]);

  useEffect(() => { loadNotices(); }, [loadNotices]);

  /* load customers — từ metterinfo.csv, lọc theo khu vực (KCN) */
  const loadCustomers = useCallback(async (a: string) => {
    if (!a) { setCustomerList([]); return; }
    setLoadingCustomers(true);
    try {
      const rows = await fetchMeterInfo();
      const map = new Map<string, OutageCustomer>();
      rows
        .filter(r => r.ADDRESS === a)
        .forEach(r => {
          const id = r.CUSTOMER_CODE || r.CUSTOMER_NAME;
          if (id && !map.has(id)) map.set(id, { id, MKH: r.CUSTOMER_CODE || '?', Name: r.CUSTOMER_NAME || '?' });
        });
      setCustomerList(Array.from(map.values()).sort((x, y) => x.MKH.localeCompare(y.MKH)));
    } catch {
      showToast('Lỗi tải danh sách khách hàng từ metterinfo.csv', 'error');
      setCustomerList([]);
    } finally {
      setLoadingCustomers(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isModalOpen && area) loadCustomers(area);
  }, [isModalOpen, area, loadCustomers]);

  /* ── slot helpers ── */
  const updateSlot = (i: number, patch: Partial<SlotForm>) =>
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const addSlot = () => setSlots(prev => [...prev, { ...emptySlot(), appendixIndex: appendices.length - 1 }]);
  const removeSlot = (i: number) => setSlots(prev => prev.filter((_, idx) => idx !== i));

  /* ── appendix helpers ── */
  const updateAppendix = (i: number, patch: Partial<AppendixForm>) =>
    setAppendices(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));

  const addAppendix = () => setAppendices(prev => [...prev, emptyAppendix()]);

  const removeAppendix = (i: number) => {
    if (appendices.length <= 1) return;
    setAppendices(prev => prev.filter((_, idx) => idx !== i));
    setSlots(prev => prev.map(s => ({
      ...s,
      appendixIndex: s.appendixIndex >= i
        ? Math.max(0, s.appendixIndex - 1)
        : s.appendixIndex,
    })));
  };

  const toggleCustomer = (appIdx: number, id: string) => {
    const a = appendices[appIdx];
    const next = a.selectedIds.includes(id)
      ? a.selectedIds.filter(x => x !== id)
      : [...a.selectedIds, id];
    updateAppendix(appIdx, { selectedIds: next });
  };

  const getFiltered = (a: AppendixForm) => {
    const q = a.search.trim().toLowerCase();
    return q
      ? allCustomers.filter(c => c.Name.toLowerCase().includes(q) || c.MKH.toLowerCase().includes(q))
      : allCustomers;
  };

  const addManualCustomer = () => {
    if (!manualForm) return;
    const MKH = manualForm.MKH.trim();
    const Name = manualForm.Name.trim();
    if (!Name) { showToast('Vui lòng nhập tên khách hàng', 'warning'); return; }
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setManualCustomers(prev => [...prev, { id, MKH: MKH || '—', Name }]);
    updateAppendix(manualForm.appIdx, { selectedIds: [...appendices[manualForm.appIdx].selectedIds, id] });
    setManualForm(null);
  };

  const toggleAll = (appIdx: number) => {
    const a = appendices[appIdx];
    const filtered = getFiltered(a);
    const allSel = filtered.length > 0 && filtered.every(c => a.selectedIds.includes(c.id));
    const next = allSel
      ? a.selectedIds.filter(id => !filtered.some(c => c.id === id))
      : [...new Set([...a.selectedIds, ...filtered.map(c => c.id)])];
    updateAppendix(appIdx, { selectedIds: next });
  };

  /* ── open / close modal ── */
  const startAdd = () => {
    setEditingId(null);
    setNoticeDate(todayStr());
    setType('planned');
    setArea(effectiveAreas[0] || AREAS[0]);
    setReason('');
    setAddLegal('');
    setSlots([emptySlot()]);
    setAppendices([emptyAppendix()]);
    setManualCustomers([]);
    setManualForm(null);
    setIsModalOpen(true);
  };

  const startEdit = (n: PowerOutage) => {
    setEditingId(n.id);
    setNoticeDate(parseNoticeDateEdit(n.noticeDate));
    setType(n.type);
    setArea(n.area);
    setReason(n.reason || '');
    setAddLegal(n.addLegal || '');
    setSlots((n.slots || []).map(s => {
      const st = splitDT(s.startTime);
      const et = splitDT(s.endTime);
      return {
        startDate: st.date, startTime: st.time,
        endDate: et.date,   endTime: et.time,
        scope: s.scope || '',
        appendixIndex: s.appendixIndex ?? 0,
      };
    }));
    setAppendices((n.appendices || []).map(a => ({
      selectedIds: (a.customers || []).map(c => c.id),
      search: '',
    })));
    /* khôi phục snapshot khách hàng đã lưu (gồm cả khách hàng nhập tay trước đó) để hiển thị đúng khi sửa */
    const snapshot = new Map<string, OutageCustomer>();
    (n.appendices || []).forEach(a => (a.customers || []).forEach(c => snapshot.set(c.id, c)));
    setManualCustomers(Array.from(snapshot.values()));
    setManualForm(null);
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditingId(null); };

  /* ── save ── */
  const saveNotice = async () => {
    if (isSaving) return;
    if (!area) { showToast('Vui lòng chọn khu vực', 'warning'); return; }
    if (slots.length === 0) { showToast('Cần ít nhất một khung giờ', 'warning'); return; }
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (new Date(joinDT(s.endDate, s.endTime)) <= new Date(joinDT(s.startDate, s.startTime))) {
        showToast(`Khung giờ ${i + 1}: thời gian cấp lại phải sau thời gian ngừng`, 'warning');
        return;
      }
    }
    setIsSaving(true);
    try {
      const outageSlots: OutageSlot[] = slots.map(s => ({
        startTime: joinDT(s.startDate, s.startTime),
        endTime:   joinDT(s.endDate, s.endTime),
        scope:     s.scope,
        appendixIndex: s.appendixIndex,
      }));
      const outageAppendices: OutageAppendix[] = appendices.map(a => ({
        customers: allCustomers.filter(c => a.selectedIds.includes(c.id)),
      }));
      const data = {
        noticeDate: fmtNoticeDateSave(noticeDate),
        type, area, reason, addLegal,
        slots: outageSlots,
        appendices: outageAppendices,
      };
      if (editingId) await pb.collection('PowerOutage').update(editingId, data);
      else await pb.collection('PowerOutage').create(data);
      closeModal();
      loadNotices();
      showToast(editingId ? 'Đã cập nhật thông báo' : 'Đã tạo thông báo ngừng cấp điện', 'success');
    } catch (err: any) {
      showToast(`Lỗi khi lưu: ${err?.data?.message || err?.message || ''}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Xóa thông báo?',
      message: 'Thao tác này không thể hoàn tác. Thông báo sẽ bị xóa vĩnh viễn.',
      confirmLabel: 'Xóa',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await pb.collection('PowerOutage').delete(id);
      loadNotices();
      showToast('Đã xóa thông báo', 'success');
    } catch {
      showToast('Lỗi khi xóa thông báo', 'error');
    }
  };

  const exportDocx = async (n: PowerOutage) => {
    setIsExporting(true);
    try {
      const blob = await generateOutageDocx(n);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const firstSlot = n.slots?.[0];
      a.download = `TBCD_${n.area}_${firstSlot ? fmtDate(firstSlot.startTime).replace(/\//g, '-') : n.noticeDate}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export DOCX error:', err);
      showToast('Lỗi khi xuất file Word', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const toastCfg: Record<ToastType, { icon: React.ElementType; cls: string }> = {
    success: { icon: CheckCircle2, cls: 'vl-alert vl-alert-success' },
    error:   { icon: XCircle,      cls: 'vl-alert vl-alert-danger' },
    warning: { icon: AlertCircle,  cls: 'vl-alert vl-alert-warning' },
    info:    { icon: Info,         cls: 'vl-alert vl-alert-primary' },
  };

  const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] text-sm';

  const appendixOptions = appendices.map((_, i) => ({
    value: String(i),
    label: `Phụ lục ${String(i + 1).padStart(2, '0')}`,
  }));

  /* ── filtered + stats ── */
  const filteredNotices = React.useMemo(() => {
    if (!filterMonth) return notices;
    return notices.filter(n => {
      // match against noticeDate text "Ngày D tháng M năm YYYY"
      const match = n.noticeDate?.match(/tháng\s+(\d+)\s+năm\s+(\d+)/);
      if (match) {
        const [, m, y] = match;
        return `${y}-${p2(Number(m))}` === filterMonth;
      }
      // fallback: match against first slot startTime
      const st = n.slots?.[0]?.startTime;
      if (st) return st.startsWith(filterMonth.replace('-', '-').substring(0, 7) + '-') || st.substring(0, 7) === filterMonth;
      return false;
    });
  }, [notices, filterMonth]);

  const stats = React.useMemo(() => {
    const list = filteredNotices;
    return {
      total:     list.length,
      planned:   list.filter(n => n.type === 'planned').length,
      emergency: list.filter(n => n.type === 'emergency').length,
      totalKH:   list.reduce((s, n) => s + (n.appendices || []).reduce((a, ap) => a + (ap.customers?.length || 0), 0), 0),
    };
  }, [filteredNotices]);

  /* month picker options: current year ± 1 */
  const monthOptions = React.useMemo(() => {
    const now = new Date();
    const opts: { value: string; label: string }[] = [{ value: '', label: 'Tất cả tháng' }];
    for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 1; y--) {
      for (let m = 12; m >= 1; m--) {
        const val = `${y}-${p2(m)}`;
        opts.push({ value: val, label: `Tháng ${m}/${y}` });
      }
    }
    return opts;
  }, []);

  return (
    <div className="space-y-8 relative">
      {confirmDialog}
      {/* Toast */}
      <AnimatePresence>
        {toast && (() => {
          const cfg = toastCfg[toast.type];
          const Icon = cfg.icon;
          return (
            <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
              className="fixed top-6 right-6 z-[120]">
              <div className={`${cfg.cls} flex items-center gap-2 px-4 py-3 rounded shadow-lg`}>
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-sm font-semibold">{toast.message}</span>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Thông báo ngừng cấp điện</h2>
          <p className="text-slate-500 text-sm mt-1">Soạn, lưu và phát hành thông báo ngừng cấp điện tới khách hàng</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <Select value={filterMonth} onChange={setFilterMonth} options={monthOptions} className="min-w-[140px]" />
          <Select value={filterArea} onChange={setFilterArea}
            options={[{ value: '', label: 'Tất cả khu vực' }, ...effectiveAreas.map((a: string) => ({ value: a, label: a }))]}
            className="min-w-[160px]" />
          <button onClick={startAdd}
            className="vl-btn vl-btn-primary flex-1 md:flex-none px-6 py-2.5 font-medium text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-95">
            <Plus className="w-5 h-5" /> Thêm thông báo
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tổng thông báo', value: stats.total, color: 'bg-blue-600', light: 'bg-blue-50 text-blue-700', icon: ZapOff },
          { label: 'Theo kế hoạch', value: stats.planned, color: 'bg-[#5a8dee]', light: 'bg-indigo-50 text-indigo-700', icon: CalendarClock },
          { label: 'Khẩn cấp', value: stats.emergency, color: 'bg-red-500', light: 'bg-red-50 text-red-700', icon: AlertTriangle },
          { label: 'Khách hàng', value: stats.totalKH, color: 'bg-emerald-500', light: 'bg-emerald-50 text-emerald-700', icon: Users },
        ].map(({ label, value, light, icon: Icon }) => (
          <div key={label} className="vl-card px-5 py-4 flex items-center gap-4">
            <div className={`p-2.5 rounded-xl ${light}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-extrabold text-slate-800 leading-none">{value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="vl-card flex flex-col items-center justify-center p-20 text-slate-400">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" />
          <p className="text-sm">Đang tải thông báo...</p>
        </div>
      ) : filteredNotices.length === 0 ? (
        <div className="vl-card flex flex-col items-center justify-center p-20 text-slate-400">
          <ZapOff className="w-16 h-16 opacity-20 mb-4" />
          <p className="text-sm font-semibold">Không có thông báo nào trong khoảng thời gian này</p>
        </div>
      ) : (
        <div className="vl-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="vl-table w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ngày TB</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loại</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Khung giờ đầu</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Khu vực</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Khung / Phụ lục / KH</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredNotices.map(n => {
                  const first = n.slots?.[0];
                  const totalKH = (n.appendices || []).reduce((acc, a) => acc + (a.customers?.length || 0), 0);
                  return (
                    <tr key={n.id} className="hover:bg-[#f4f8ff] transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-600 whitespace-nowrap">{n.noticeDate || '---'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold ${n.type === 'emergency' ? 'vl-badge-danger' : 'vl-badge-primary'}`}>
                          {n.type === 'emergency' ? <AlertTriangle className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
                          {TYPE_LABEL[n.type]}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600 whitespace-nowrap">
                        {first ? (
                          <>
                            <div className="font-semibold text-slate-700">{fmtFull(first.startTime)}</div>
                            <div className="text-slate-400">→ {fmtFull(first.endTime)}</div>
                          </>
                        ) : '---'}
                      </td>
                      <td className="px-6 py-4 text-xs">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-bold text-[10px] uppercase tracking-wide">
                          <MapPin className="w-3 h-3" /> {n.area}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center gap-0.5 text-xs text-slate-500">
                          <span className="font-bold">{(n.slots || []).length} khung</span>
                          <span>{(n.appendices || []).length} phụ lục</span>
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Users className="w-3 h-3" />{totalKH} KH
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => exportDocx(n)} disabled={isExporting}
                            className="p-2 hover:bg-slate-100 hover:text-blue-600 text-slate-400 rounded border border-slate-100 transition-all disabled:opacity-50"
                            title="Tải file Word"><Download className="w-4 h-4" /></button>
                          <button onClick={() => startEdit(n)}
                            className="p-2 hover:bg-slate-100 hover:text-blue-600 text-slate-400 rounded border border-slate-100 transition-all"
                            title="Chỉnh sửa"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(n.id)}
                            className="p-2 hover:bg-slate-100 hover:text-red-500 text-slate-400 rounded border border-slate-100 transition-all"
                            title="Xóa"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeModal} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-5xl max-h-[96vh] bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col">

              {/* Modal header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20">
                    <ZapOff className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{editingId ? 'Sửa thông báo' : 'Thêm thông báo ngừng cấp điện'}</h3>
                    <p className="text-slate-500 text-xs mt-0.5">Điền thông tin, phân khung giờ và chọn khách hàng theo phụ lục</p>
                  </div>
                </div>
                <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded transition-colors">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              {/* Modal body */}
              <div className="flex-1 overflow-y-auto bg-slate-100 p-4 space-y-4">

                {/* KCN + Ngày TB */}
                <div className="mx-auto max-w-3xl grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-bold text-slate-500 uppercase shrink-0">Khu vực</label>
                    <Select value={area} onChange={setArea}
                      options={effectiveAreas.map((a: string) => ({ value: a, label: a }))}
                      placeholder="Chọn khu vực" />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] font-bold text-slate-500 uppercase shrink-0">Ngày TB</label>
                    <DatePicker value={noticeDate} onChange={setNoticeDate} />
                  </div>
                </div>

                {/* ── Tờ văn bản ── */}
                <div className="bg-white shadow rounded-sm mx-auto max-w-3xl px-12 py-8 space-y-3 text-[13px] leading-relaxed" style={{ fontFamily: 'Times New Roman, serif' }}>

                  {/* Tiêu đề */}
                  <div className="text-center space-y-1">
                    <div className="font-bold text-base uppercase tracking-wide">THÔNG BÁO</div>
                    <div className="font-bold uppercase text-[13px]">
                      TẠM NGỪNG CẤP ĐIỆN {type === 'planned' ? 'THEO KẾ HOẠCH' : 'KHẨN CẤP'}
                    </div>
                    <div className="flex justify-center gap-2 pt-1">
                      {(['emergency', 'planned'] as const).map(t => (
                        <button key={t} type="button" onClick={() => setType(t)}
                          className={`flex items-center gap-1 text-[11px] px-3 py-1 rounded border font-bold transition-all ${type === t
                            ? t === 'emergency' ? 'bg-red-50 border-red-300 text-red-600' : 'bg-blue-50 border-blue-300 text-blue-600'
                            : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                          {t === 'emergency' ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                          {TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-center font-bold italic text-[13px] pt-1">Kính gửi: Quý khách hàng</div>

                  {/* Căn cứ */}
                  <div className="space-y-0.5 text-[12px]">
                    <div>- Căn cứ Khoản 2 điều 49 của Luật điện lực 2024, số 61/2024/QH15 ngày 30/11/2024;</div>
                    <div>- Căn cứ Thông tư số 04/2025/TT-BCT ngày 01 tháng 02 năm 2025 của Bộ Công Thương;</div>
                    <div className="flex items-start gap-1">
                      <span className="shrink-0 mt-1">-</span>
                      <textarea value={addLegal} onChange={e => setAddLegal(e.target.value)}
                        placeholder="Căn cứ bổ sung (để trống để bỏ dòng này)" rows={2}
                        className="flex-1 border border-dashed border-blue-300 bg-blue-50/40 px-2 py-1 text-[12px] outline-none focus:border-blue-500 rounded-sm placeholder:text-slate-400 placeholder:italic resize-none" />
                    </div>
                    <div>- Căn cứ Hợp đồng mua bán điện đã ký kết.</div>
                  </div>

                  <div className="text-[12px] text-justify indent-6">
                    Công ty CP Mua bán điện Gelex tạm ngừng cấp điện cho Quý khách hàng tại điểm mua điện TBA cấp điện, cụ thể:
                  </div>

                  {/* ── Bảng khung giờ ── */}
                  <table className="w-full border border-black border-collapse text-[12px]">
                    <thead>
                      <tr>
                        <th className="border border-black px-2 py-2 text-center font-bold w-[6%]">STT</th>
                        <th className="border border-black px-2 py-2 text-center font-bold w-[40%]">Thời gian</th>
                        <th className="border border-black px-2 py-2 text-center font-bold w-[18%]">Khu vực</th>
                        <th className="border border-black px-2 py-2 text-center font-bold">Phạm vi</th>
                        <th className="border border-black px-2 py-2 text-center font-bold w-[15%]">Phụ lục</th>
                        <th className="border border-black px-1 py-2 w-[20px]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((s, i) => (
                        <tr key={i} className="align-top">
                          <td className="border border-black px-2 py-3 text-center font-bold">{i + 1}</td>
                          <td className="border border-black px-2 py-3">
                            <div className="space-y-2">
                              <div>
                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Bắt đầu ngừng</div>
                                <div className="flex items-center gap-1.5">
                                  <DatePicker value={s.startDate} onChange={v => updateSlot(i, { startDate: v })} />
                                  <TimePicker value={s.startTime} onChange={v => updateSlot(i, { startTime: v })} />
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Cấp điện trở lại</div>
                                <div className="flex items-center gap-1.5">
                                  <DatePicker value={s.endDate} onChange={v => updateSlot(i, { endDate: v })} />
                                  <TimePicker value={s.endTime} onChange={v => updateSlot(i, { endTime: v })} />
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="border border-black px-2 py-3 text-center align-middle text-[12px] font-medium">
                            {area || <span className="text-slate-400 italic text-[11px]">—</span>}
                          </td>
                          <td className="border border-black px-2 py-3">
                            <textarea value={s.scope} onChange={e => updateSlot(i, { scope: e.target.value })}
                              placeholder="Phạm vi..." rows={4}
                              className="w-full text-[12px] bg-blue-50/40 border border-dashed border-blue-200 rounded outline-none resize-none focus:border-blue-400 p-1.5 placeholder:text-slate-400 placeholder:italic" />
                          </td>
                          <td className="border border-black px-2 py-3 align-middle">
                            <Select
                              value={String(s.appendixIndex)}
                              onChange={v => updateSlot(i, { appendixIndex: Number(v) })}
                              options={appendixOptions} />
                          </td>
                          <td className="border border-black px-1 py-3 text-center align-top">
                            {slots.length > 1 && (
                              <button type="button" onClick={() => removeSlot(i)}
                                className="p-1 text-slate-300 hover:text-red-500 transition-colors mt-1">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" onClick={addSlot}
                    className="flex items-center gap-2 text-[12px] text-blue-600 hover:text-blue-700 font-bold transition-colors">
                    <Plus className="w-4 h-4" /> Thêm khung giờ
                  </button>

                  {/* Lý do */}
                  <div className="text-[12px] space-y-1">
                    <span className="font-bold">Lý do ngừng cấp điện:</span>
                    <textarea value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Nhập lý do..." rows={3}
                      className="w-full border border-dashed border-blue-300 bg-blue-50/40 px-2 py-1 text-[12px] outline-none focus:border-blue-500 rounded-sm placeholder:text-slate-400 placeholder:italic resize-none" />
                  </div>
                </div>

                {/* ── Phụ lục cards ── */}
                {appendices.map((app, ai) => {
                  const filtered = getFiltered(app);
                  const allSel = filtered.length > 0 && filtered.every(c => app.selectedIds.includes(c.id));
                  const refSlots = slots
                    .map((s, si) => s.appendixIndex === ai ? si + 1 : null)
                    .filter((x): x is number => x !== null);

                  return (
                    <div key={ai} className="bg-white shadow rounded-sm mx-auto max-w-3xl px-12 py-6 space-y-3" style={{ fontFamily: 'Times New Roman, serif' }}>
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="text-[13px] font-bold uppercase">
                            Phụ lục {String(ai + 1).padStart(2, '0')}: Danh sách khách hàng
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {refSlots.length > 0 && (
                            <span className="text-[10px] text-slate-400 italic">
                              Khung giờ: {refSlots.join(', ')}
                            </span>
                          )}
                          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                            {app.selectedIds.length} KH
                          </span>
                          {appendices.length > 1 && (
                            <button type="button" onClick={() => removeAppendix(ai)}
                              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                              title="Xóa phụ lục">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Search + toggle all */}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input type="text" value={app.search}
                            onChange={e => updateAppendix(ai, { search: e.target.value })}
                            placeholder="Tìm theo tên hoặc mã khách hàng..."
                            className={`${inputCls} pl-9`} />
                        </div>
                        <button type="button" onClick={() => toggleAll(ai)} disabled={filtered.length === 0}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded text-xs font-bold hover:bg-slate-50 transition-all disabled:opacity-50 shrink-0">
                          {allSel ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                          {allSel ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                        <button type="button"
                          onClick={() => setManualForm(manualForm?.appIdx === ai ? null : { appIdx: ai, MKH: '', Name: '' })}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-blue-600 rounded text-xs font-bold hover:bg-blue-50 transition-all shrink-0">
                          <UserPlus className="w-3.5 h-3.5" /> Thêm KH ngoài danh sách
                        </button>
                      </div>

                      {/* Form thêm khách hàng ngoài danh sách */}
                      {manualForm?.appIdx === ai && (
                        <div className="flex items-center gap-2 bg-blue-50/60 border border-dashed border-blue-300 rounded p-2.5">
                          <input type="text" placeholder="Mã KH (tùy chọn)" value={manualForm.MKH}
                            onChange={e => setManualForm({ ...manualForm, MKH: e.target.value })}
                            className="w-32 px-2 py-1.5 bg-white border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] text-sm" />
                          <input type="text" placeholder="Tên khách hàng" value={manualForm.Name}
                            onChange={e => setManualForm({ ...manualForm, Name: e.target.value })}
                            className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] text-sm" autoFocus />
                          <button type="button" onClick={addManualCustomer}
                            className="vl-btn vl-btn-primary vl-btn-sm">Thêm</button>
                          <button type="button" onClick={() => setManualForm(null)}
                            className="p-1.5 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                        </div>
                      )}

                      {/* Customer list */}
                      <div className="border border-slate-200 rounded max-h-52 overflow-y-auto divide-y divide-slate-100">
                        {loadingCustomers ? (
                          <div className="flex items-center justify-center gap-2 p-6 text-slate-400 text-sm">
                            <RefreshCw className="w-4 h-4 animate-spin" /> Đang tải khách hàng...
                          </div>
                        ) : filtered.length === 0 ? (
                          <div className="p-6 text-center text-slate-400 text-sm italic">
                            {area ? 'Không có khách hàng phù hợp' : 'Vui lòng chọn khu vực trước'}
                          </div>
                        ) : (
                          filtered.map(c => {
                            const checked = app.selectedIds.includes(c.id);
                            return (
                              <label key={c.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => toggleCustomer(ai, c.id)}
                                  className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                                <span className="text-xs font-bold text-slate-400 w-24 shrink-0">{c.MKH}</span>
                                <span className="text-sm text-slate-700 font-medium">{c.Name}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add appendix button */}
                <div className="mx-auto max-w-3xl">
                  <button type="button" onClick={addAppendix}
                    className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 rounded-sm text-[13px] font-bold transition-colors">
                    <Plus className="w-4 h-4" /> Thêm phụ lục
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50 shrink-0">
                <button onClick={closeModal} disabled={isSaving}
                  className="vl-btn vl-btn-secondary px-6 py-2.5 font-bold disabled:opacity-50">
                  Hủy bỏ
                </button>
                <button onClick={saveNotice} disabled={isSaving}
                  className="vl-btn vl-btn-primary px-6 py-2.5 font-bold shadow-lg shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2">
                  {isSaving ? (<><RefreshCw className="w-5 h-5 animate-spin" /> Đang lưu...</>) : 'Lưu thông báo'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
