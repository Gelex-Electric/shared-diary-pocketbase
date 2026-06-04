import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS } from '../lib/pocketbase';
import { Customer, Meter, AccountHes, HesItem } from '../types';
import {
  Plus, Trash2, MapPin, RefreshCw, Edit2, X, ChevronRight,
  CheckCircle2, XCircle, Search, Gauge,
  Users, CloudDownload, AlertCircle, Info, CreditCard,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import HesReadingManager from './HesReadingManager';


const inputCls =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] text-sm';
const compactInputCls =
  'px-2 py-1.5 bg-white border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] text-sm';

/* ---- Types ---- */
type ModalMode =
  | { type: 'new' }
  | { type: 'add-meter'; customerId: string; customer: Partial<Customer> };

type MeterForm = { MeterNo: string; HSN: string; Type: string; Line: string; area: string; Activate: boolean };
type CustomerGroup = { customer: Partial<Customer>; meters: Meter[] };

/* ================================================================
   COMPONENT
================================================================ */
export default function CustomerManager() {
  const [activeTab, setActiveTab] = useState<'main' | 'hes'>('main');
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterArea, setFilterArea] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  /* ---- Accordion ---- */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* ---- Modal ---- */
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [modalCust, setModalCust] = useState({ MKH: '', customerName: '', area: '' });
  const [modalMeters, setModalMeters] = useState<MeterForm[]>([]);
  const [isSavingModal, setIsSavingModal] = useState(false);

  /* ---- Inline edit: customer ---- */
  const [editingCustId, setEditingCustId] = useState<string | null>(null);
  const [editCust, setEditCust] = useState({ MKH: '', Name: '', area: '' });

  /* ---- Inline edit: meter row ---- */
  const [editingMeterId, setEditingMeterId] = useState<string | null>(null);
  const [editMeter, setEditMeter] = useState({ MeterNo: '', HSN: '', Type: '', Line: '', area: '', Activate: true });

  /* ---- HES ---- */
  const [hesAccount, setHesAccount] = useState<AccountHes | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGettingToken, setIsGettingToken] = useState(false);
  const [hesPreviewData, setHesPreviewData] = useState<HesItem[]>([]);
  const [selectedHesIds, setSelectedHesIds] = useState<string[]>([]);
  const [showHesPreview, setShowHesPreview] = useState(false);
  const [isSavingHes, setIsSavingHes] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });

  /* ---- Batch activate ---- */
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);

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
  const defaultArea = effectiveAreas[0] || AREAS[0];

  /* ================================================================
     DATA
  ================================================================ */
  const loadAllMeters = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoading(true);
    try {
      const fp: string[] = [];
      if (filterArea) fp.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      else if (userAreas.length > 0) fp.push(`(${userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ')})`);
      if (searchTerm) fp.push(`(MeterNo ~ '${searchTerm}' || Customer.Name ~ '${searchTerm}' || Customer.MKH ~ '${searchTerm}')`);
      const result = await pb.collection('Meter').getFullList<Meter>({
        filter: fp.join(' && '), sort: 'Customer.MKH,MeterNo', expand: 'Customer', requestKey: null,
      });
      setAllMeters(result);
    } catch (err: any) { if (!err.isAbort) console.error(err); }
    finally { setIsLoading(false); }
  }, [filterArea, userAreas, searchTerm]);

  const loadHesAccount = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    try { setHesAccount((await pb.collection('AccountHes').getFirstListItem('')) as any); } catch { /* no account */ }
  }, []);

  useEffect(() => { loadAllMeters(); loadHesAccount(); }, [loadAllMeters, loadHesAccount]);

  const customerGroups = React.useMemo((): CustomerGroup[] => {
    const map = new Map<string, CustomerGroup>();
    for (const m of allMeters) {
      if (!map.has(m.Customer))
        map.set(m.Customer, { customer: m.expand?.Customer ?? ({ id: m.Customer, MKH: '?', Name: '?' } as any), meters: [] });
      map.get(m.Customer)!.meters.push(m);
    }
    return Array.from(map.values());
  }, [allMeters]);

  /* ================================================================
     ACCORDION
  ================================================================ */
  const toggleExpand = (cid: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });

  /* ================================================================
     MODAL HELPERS
  ================================================================ */
  const blankMeter = (area = defaultArea): MeterForm =>
    ({ MeterNo: '', HSN: '', Type: '', Line: '', area, Activate: true });

  const openNewModal = () => {
    setModalMode({ type: 'new' });
    setModalCust({ MKH: '', customerName: '', area: defaultArea });
    setModalMeters([blankMeter()]);
  };

  const openAddMeterModal = (cid: string, cust: Partial<Customer>) => {
    setModalMode({ type: 'add-meter', customerId: cid, customer: cust });
    setModalCust({ MKH: cust.MKH || '', customerName: cust.Name || '', area: (cust as any).area || defaultArea });
    setModalMeters([blankMeter((cust as any).area || defaultArea)]);
  };

  const addMeterRow = () => setModalMeters(prev => [...prev, blankMeter(modalCust.area || defaultArea)]);
  const removeMeterRow = (i: number) => setModalMeters(prev => prev.filter((_, idx) => idx !== i));
  const updateMeterRow = (i: number, field: keyof MeterForm, val: string | boolean) =>
    setModalMeters(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));

  const saveModal = async () => {
    const filledMeters = modalMeters.filter(m => m.MeterNo.trim());
    if (!filledMeters.length) { showToast('Vui lòng nhập ít nhất một số công tơ', 'warning'); return; }
    setIsSavingModal(true);
    try {
      let customerId: string;
      if (modalMode?.type === 'add-meter') {
        customerId = modalMode.customerId;
      } else {
        const cp = { Name: modalCust.customerName, MKH: modalCust.MKH, area: modalCust.area };
        try {
          const ex = await pb.collection('Customer').getFirstListItem<Customer>(`MKH = '${modalCust.MKH.replace(/'/g, "\\'")}'`, { requestKey: null });
          await pb.collection('Customer').update(ex.id, cp);
          customerId = ex.id;
        } catch {
          customerId = (await pb.collection('Customer').create<Customer>(cp)).id;
        }
      }
      for (const m of filledMeters) {
        await pb.collection('Meter').create({
          MeterNo: m.MeterNo, HSN: m.HSN, Type: m.Type, Line: m.Line,
          area: m.area || modalCust.area || defaultArea, Activate: m.Activate, Customer: customerId,
        });
      }
      setModalMode(null);
      setExpandedIds(prev => new Set(prev).add(customerId));
      await loadAllMeters();
      showToast(`Đã thêm ${filledMeters.length} công tơ thành công`, 'success');
    } catch (err: any) { showToast('Lỗi: ' + (err.message || 'Unknown'), 'error'); }
    finally { setIsSavingModal(false); }
  };

  /* ================================================================
     INLINE EDIT — CUSTOMER
  ================================================================ */
  const startEditCust = (cust: Partial<Customer>) => {
    setEditingCustId(cust.id!);
    setEditCust({ MKH: cust.MKH || '', Name: cust.Name || '', area: (cust as any).area || '' });
  };
  const saveCustEdit = async (cid: string) => {
    try { await pb.collection('Customer').update(cid, editCust); setEditingCustId(null); await loadAllMeters(); showToast('Đã cập nhật khách hàng', 'success'); }
    catch (err: any) { showToast('Lỗi: ' + err.message, 'error'); }
  };
  const deleteCustomer = async (cid: string, count: number) => {
    if (!window.confirm(`Xóa khách hàng và ${count} công tơ liên quan?`)) return;
    try {
      await Promise.all(allMeters.filter(m => m.Customer === cid).map(m => pb.collection('Meter').delete(m.id)));
      await pb.collection('Customer').delete(cid);
      await loadAllMeters(); showToast('Đã xóa khách hàng', 'success');
    } catch (err: any) { showToast('Lỗi xóa: ' + err.message, 'error'); }
  };

  /* ================================================================
     INLINE EDIT — METER
  ================================================================ */
  const startEditMeter = (m: Meter) => {
    setEditingMeterId(m.id);
    setEditMeter({ MeterNo: m.MeterNo, HSN: m.HSN || '', Type: m.Type || '', Line: m.Line || '', area: m.area, Activate: m.Activate });
  };
  const saveMeterEdit = async (mid: string) => {
    try { await pb.collection('Meter').update(mid, editMeter); setEditingMeterId(null); await loadAllMeters(); showToast('Đã cập nhật công tơ', 'success'); }
    catch (err: any) { showToast('Lỗi: ' + err.message, 'error'); }
  };
  const deleteMeter = async (mid: string) => {
    try { await pb.collection('Meter').delete(mid); await loadAllMeters(); showToast('Đã xóa công tơ', 'success'); }
    catch (err: any) { showToast('Lỗi: ' + err.message, 'error'); }
  };
  const toggleActivate = (m: Meter) =>
    setPendingChanges(prev => {
      const n = { ...prev }; const cur = n[m.id] !== undefined ? n[m.id] : m.Activate;
      if (!cur === m.Activate) delete n[m.id]; else n[m.id] = !cur; return n;
    });

  const hasPending = Object.keys(pendingChanges).length > 0;

  const handleBatchUpdate = async () => {
    if (!hasPending) return;
    setIsBatchUpdating(true);
    try {
      await Promise.all(Object.entries(pendingChanges).map(([id, v]) => pb.collection('Meter').update(id, { Activate: v })));
      setPendingChanges({}); await loadAllMeters(); showToast('Đã cập nhật trạng thái', 'success');
    } catch { showToast('Lỗi cập nhật hàng loạt', 'error'); }
    finally { setIsBatchUpdating(false); }
  };

  /* ================================================================
     HES HANDLERS
  ================================================================ */
  const getToken = async () => {
    if (!hesAccount) { showToast('Không tìm thấy tài khoản HES.', 'error'); return; }
    setIsGettingToken(true);
    try {
      const res = await fetch(`/hes/api/Login?UserAccount=${hesAccount.Account}&Password=${hesAccount.Password}`);
      if (!res.ok) throw new Error('Lỗi kết nối API');
      const data = await res.json();
      if (data?.TOKEN) { setHesAccount((await pb.collection('AccountHes').update(hesAccount.id, { Token: data.TOKEN })) as any); showToast('Lấy Token thành công!', 'success'); }
      else throw new Error('Không nhận được Token');
    } catch (err: any) { showToast('Lỗi lấy Token: ' + err.message, 'error'); }
    finally { setIsGettingToken(false); }
  };

  const syncFromHes = async () => {
    if (!hesAccount) { showToast('Không tìm thấy tài khoản HES.', 'error'); return; }
    setIsSyncing(true);
    try {
      const res = await fetch(`/hes/api/GetMeterAccount?UserID=${hesAccount.HesID}&Token=${hesAccount.Token || 'Token'}`);
      if (!res.ok) throw new Error(`Lỗi HES API: ${res.status}`);
      const hesData: any = await res.json();
      if (hesData?.CODE === '0' && hesData?.MESSAGE === 'invalid token') { showToast('Token hết hạn. Vui lòng lấy Token mới.', 'warning'); return; }
      if (!Array.isArray(hesData)) throw new Error('Dữ liệu HES không đúng định dạng');
      const filtered: HesItem[] = hesData.filter((i: any) => i.ADDRESS === hesAccount.area);
      if (!filtered.length) { showToast(`Không có bản ghi tại "${hesAccount.area}"`, 'warning'); return; }
      const existing = await pb.collection('Meter').getFullList<Meter>({ filter: `area = "${hesAccount.area}"`, expand: 'Customer', requestKey: null });
      const em = new Map(existing.map(m => [m.MeterNo, m]));
      const preview = filtered.map(item => {
        const ex = em.get(item.METER_NO);
        if (!ex) return { ...item, syncStatus: 'new' as const, isDuplicate: false };
        const changed = (ex.HSN ?? '') !== (item.METER_NAME ?? '') || (ex.Type ?? '') !== (item.METER_MODEL_DESC ?? '') || (ex.Line ?? '') !== (item.LINE_NAME ?? '') || (ex.expand?.Customer?.Name ?? '') !== (item.CUSTOMER_NAME ?? '');
        return { ...item, syncStatus: changed ? 'update' as const : 'unchanged' as const, isDuplicate: !changed, existingMeterId: ex.id, existingCustomerId: ex.Customer };
      });
      setHesPreviewData(preview);
      setSelectedHesIds(preview.filter(i => i.syncStatus !== 'unchanged').map(i => i.METER_NO));
      setShowHesPreview(true);
    } catch (err: any) { showToast('Lỗi đồng bộ HES: ' + err.message, 'error'); }
    finally { setIsSyncing(false); }
  };

  const saveSelectedHesData = async () => {
    if (!selectedHesIds.length) { showToast('Vui lòng chọn ít nhất một bản ghi.', 'warning'); return; }
    const items = hesPreviewData.filter(i => selectedHesIds.includes(i.METER_NO));
    setIsSavingHes(true); setSaveProgress({ current: 0, total: items.length });
    try {
      let created = 0, updated = 0; const failed: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]; setSaveProgress({ current: i + 1, total: items.length });
        try {
          const area = hesAccount?.area || defaultArea;
          const cp = { Name: item.CUSTOMER_NAME, MKH: item.CUSTOMER_CODE, area };
          const upsertC = async (): Promise<Customer> => {
            let eid: string | null = null;
            try { eid = (await pb.collection('Customer').getFirstListItem(`MKH = '${item.CUSTOMER_CODE.replace(/'/g, "\\'")}'`, { requestKey: null })).id; } catch { /* new */ }
            return eid
              ? await pb.collection('Customer').update(eid, cp) as Customer
              : await pb.collection('Customer').create(cp) as Customer;
          };
          const cust = await upsertC();
          const mp = { MeterNo: item.METER_NO, HSN: item.METER_NAME, Type: item.METER_MODEL_DESC, CreatedHES: item.CREATED, Line: item.LINE_NAME, Customer: cust.id, area, Activate: true };
          if (item.existingMeterId) { await pb.collection('Meter').update(item.existingMeterId, mp); updated++; }
          else { await pb.collection('Meter').create(mp); created++; }
        } catch (err) { console.error(`Lỗi ${item.METER_NO}:`, err); failed.push(item.METER_NO); }
      }
      setShowHesPreview(false);
      const parts = [...(created ? [`${created} mới`] : []), ...(updated ? [`${updated} cập nhật`] : [])];
      if (failed.length) showToast(`Đã lưu ${parts.join(', ')||'0'}. Lỗi ${failed.length}: ${failed.slice(0,5).join(', ')}${failed.length>5?`… (+${failed.length-5})`:''}`, 'warning');
      else showToast(`Đồng bộ thành công: ${parts.join(', ')}.`, 'success');
      await loadAllMeters();
    } catch (err: any) { showToast('Lỗi lưu dữ liệu: ' + err.message, 'error'); }
    finally { setIsSavingHes(false); }
  };

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
          ADD MODAL
      ================================================================ */}
      <AnimatePresence>
        {modalMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-lg w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                <h3 className="text-lg font-bold text-slate-800">
                  {modalMode.type === 'new' ? 'Thêm mới khách hàng & Công tơ' : `Thêm công tơ — ${modalMode.customer.Name || ''}`}
                </h3>
                <button onClick={() => setModalMode(null)} className="p-1.5 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">

                {/* Customer section */}
                {modalMode.type === 'new' ? (
                  <div>
                    <p className="text-xs font-bold text-[#475f7b] uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Users className="w-3.5 h-3.5" /> Thông tin khách hàng
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Mã khách hàng</label>
                        <input type="text" placeholder="VD: KH001" value={modalCust.MKH}
                          onChange={e => setModalCust({ ...modalCust, MKH: e.target.value })} className={inputCls} autoFocus />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Tên khách hàng</label>
                        <input type="text" placeholder="Nhập tên khách hàng" value={modalCust.customerName}
                          onChange={e => setModalCust({ ...modalCust, customerName: e.target.value })} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Khu vực</label>
                        <select value={modalCust.area} onChange={e => setModalCust({ ...modalCust, area: e.target.value })} className={inputCls}>
                          {effectiveAreas.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-[#e8f3ff] rounded">
                    <Users className="w-4 h-4 text-[#5a8dee] shrink-0" />
                    <span className="font-mono text-xs font-bold text-[#5a8dee] bg-white px-2 py-0.5 rounded mr-1">{modalMode.customer.MKH}</span>
                    <span className="text-sm font-semibold text-slate-700">{modalMode.customer.Name}</span>
                  </div>
                )}

                <div className="border-t border-slate-100" />

                {/* Meters section */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-[#475f7b] uppercase tracking-wider flex items-center gap-2">
                      <Gauge className="w-3.5 h-3.5" /> Danh sách công tơ
                      <span className="normal-case font-normal text-slate-400">({modalMeters.length} hàng)</span>
                    </p>
                    <button onClick={addMeterRow} className="vl-btn vl-btn-outline-primary vl-btn-sm gap-1.5">
                      <Plus className="w-3.5 h-3.5" /> Thêm hàng
                    </button>
                  </div>

                  {/* Column labels */}
                  <div className="grid gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider px-1 mb-1"
                    style={{ gridTemplateColumns: '1.5rem 1fr 5rem 1fr 1fr 5rem 2rem' }}>
                    <span />
                    <span>Số công tơ</span>
                    <span>Hệ số nhân</span>
                    <span>Loại CT</span>
                    <span>Trạm</span>
                    <span>Hoạt động</span>
                    <span />
                  </div>

                  <div className="space-y-2">
                    {modalMeters.map((m, idx) => (
                      <div key={idx} className="grid items-center gap-2 p-2 bg-slate-50 rounded border border-slate-100"
                        style={{ gridTemplateColumns: '1.5rem 1fr 5rem 1fr 1fr 5rem 2rem' }}>
                        {/* Row number */}
                        <span className="text-xs font-bold text-slate-300 text-center">{idx + 1}</span>

                        {/* Số CT */}
                        <input type="text" placeholder="Số công tơ" value={m.MeterNo}
                          onChange={e => updateMeterRow(idx, 'MeterNo', e.target.value)}
                          className={compactInputCls + ' w-full'} />

                        {/* Hệ số nhân */}
                        <input type="text" placeholder="HSN" value={m.HSN}
                          onChange={e => updateMeterRow(idx, 'HSN', e.target.value)}
                          className={compactInputCls + ' w-full'} />

                        {/* Loại CT */}
                        <input type="text" placeholder="Loại công tơ" value={m.Type}
                          onChange={e => updateMeterRow(idx, 'Type', e.target.value)}
                          className={compactInputCls + ' w-full'} />

                        {/* Trạm */}
                        <input type="text" placeholder="Tên trạm" value={m.Line}
                          onChange={e => updateMeterRow(idx, 'Line', e.target.value)}
                          className={compactInputCls + ' w-full'} />

                        {/* Toggle Activate */}
                        <div className="flex items-center justify-center">
                          <button type="button"
                            onClick={() => updateMeterRow(idx, 'Activate', !m.Activate)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${m.Activate ? 'bg-[#5a8dee]' : 'bg-slate-300'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${m.Activate ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>

                        {/* Remove row */}
                        <div className="flex items-center justify-center">
                          {modalMeters.length > 1 ? (
                            <button onClick={() => removeMeterRow(idx)}
                              className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : <span className="w-5" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
                <p className="text-xs text-slate-400">
                  {modalMeters.filter(m => m.MeterNo.trim()).length} / {modalMeters.length} hàng có số công tơ
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setModalMode(null)} className="vl-btn vl-btn-secondary">Hủy</button>
                  <button onClick={saveModal} disabled={isSavingModal} className="vl-btn vl-btn-primary gap-2 disabled:opacity-50">
                    {isSavingModal
                      ? <><RefreshCw className="w-4 h-4 animate-spin" />Đang lưu...</>
                      : <><CheckCircle2 className="w-4 h-4" />Lưu</>
                    }
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================
          HES PREVIEW MODAL
      ================================================================ */}
      <AnimatePresence>
        {showHesPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Xem trước dữ liệu HES</h3>
                  <p className="text-sm text-slate-500">Tìm thấy {hesPreviewData.length} bản ghi tại {hesAccount?.area}</p>
                </div>
                <button onClick={() => setShowHesPreview(false)} disabled={isSavingHes} className="p-2 hover:bg-slate-200 rounded-full disabled:opacity-50">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-6">
                <table className="vl-table w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr>
                      <th className="p-3">
                        <input type="checkbox"
                          checked={hesPreviewData.filter(i => i.syncStatus !== 'unchanged').every(i => selectedHesIds.includes(i.METER_NO)) && hesPreviewData.some(i => i.syncStatus !== 'unchanged')}
                          onChange={e => setSelectedHesIds(e.target.checked ? hesPreviewData.filter(i => i.syncStatus !== 'unchanged').map(i => i.METER_NO) : [])}
                          className="w-4 h-4 rounded"
                        />
                      </th>
                      <th className="p-3">Mã KH</th>
                      <th className="p-3">Tên khách hàng</th>
                      <th className="p-3">Số công tơ</th>
                      <th className="p-3">Trạm</th>
                      <th className="p-3">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {hesPreviewData.map(item => (
                      <tr key={item.METER_NO} className={`hover:bg-slate-50 transition-colors ${item.syncStatus === 'unchanged' ? 'opacity-50' : item.syncStatus === 'update' ? 'bg-blue-50/30' : ''}`}>
                        <td className="p-3">
                          <input type="checkbox" disabled={item.syncStatus === 'unchanged'}
                            checked={selectedHesIds.includes(item.METER_NO)}
                            onChange={e => setSelectedHesIds(e.target.checked ? [...selectedHesIds, item.METER_NO] : selectedHesIds.filter(id => id !== item.METER_NO))}
                            className="w-4 h-4 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="p-3 font-mono text-sm text-slate-600">{item.CUSTOMER_CODE}</td>
                        <td className="p-3 text-sm font-medium text-slate-800">{item.CUSTOMER_NAME}</td>
                        <td className="p-3 font-mono text-sm text-[#5a8dee]">{item.METER_NO}</td>
                        <td className="p-3 text-sm text-slate-500">{item.LINE_NAME}</td>
                        <td className="p-3">
                          {item.syncStatus === 'new' && <span className="vl-badge-success inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded"><CheckCircle2 className="w-3 h-3" /> Mới</span>}
                          {item.syncStatus === 'update' && <span className="vl-badge-primary inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded"><RefreshCw className="w-3 h-3" /> Cập nhật</span>}
                          {item.syncStatus === 'unchanged' && <span className="bg-slate-100 text-slate-400 text-xs font-bold rounded px-2 py-1">Không đổi</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="text-sm text-slate-500 flex items-center gap-3 flex-wrap">
                  <span>Đã chọn <span className="font-bold text-slate-800">{selectedHesIds.length}</span> / {hesPreviewData.length}</span>
                  {(() => {
                    const n = hesPreviewData.filter(i => i.syncStatus === 'new' && selectedHesIds.includes(i.METER_NO)).length;
                    const u = hesPreviewData.filter(i => i.syncStatus === 'update' && selectedHesIds.includes(i.METER_NO)).length;
                    return (<>{n > 0 && <span className="vl-badge-success px-2 py-0.5 text-xs font-bold rounded inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{n} mới</span>}{u > 0 && <span className="vl-badge-primary px-2 py-0.5 text-xs font-bold rounded inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />{u} cập nhật</span>}</>);
                  })()}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowHesPreview(false)} disabled={isSavingHes} className="vl-btn vl-btn-outline-primary disabled:opacity-50">Hủy bỏ</button>
                  <button onClick={saveSelectedHesData} disabled={isSavingHes || !selectedHesIds.length} className="vl-btn vl-btn-primary gap-2 disabled:opacity-50">
                    {isSavingHes ? <><RefreshCw className="w-4 h-4 animate-spin" />Đang lưu ({saveProgress.current}/{saveProgress.total})</> : <><CloudDownload className="w-4 h-4" />Lưu vào hệ thống</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================
          PAGE HEADER + TOOLBAR
      ================================================================ */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Quản lý khách hàng &amp; Công tơ</h2>
          <p className="text-slate-500 text-sm mt-1">Hệ thống quản lý thông tin khách hàng và thiết bị đo đếm</p>
        </div>
        {activeTab === 'main' && (
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Search */}
            <div className="relative flex-1 md:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Tìm tên, mã KH, số CT..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded text-sm focus:ring-2 focus:ring-[#5a8dee] outline-none"
              />
            </div>

            <button onClick={getToken} disabled={isGettingToken || isSyncing} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
              {isGettingToken ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
              {isGettingToken ? 'Đang lấy...' : 'Lấy Token'}
            </button>

            <button onClick={syncFromHes} disabled={isSyncing || isGettingToken} className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
              {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
              {isSyncing ? 'Đang đồng bộ...' : 'Lấy dữ liệu HES'}
            </button>

            {userAreas.length !== 1 && (
              <select value={filterArea} onChange={e => setFilterArea(e.target.value)}
                className="bg-white border border-slate-200 rounded px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-[#5a8dee] outline-none">
                <option value="">Tất cả khu vực</option>
                {effectiveAreas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            )}

            {/* Lưu trạng thái — always visible, grayed when no pending */}
            <button
              onClick={handleBatchUpdate}
              disabled={!hasPending || isBatchUpdating}
              className={`vl-btn vl-btn-sm gap-1.5 transition-all ${hasPending ? 'vl-btn-warning' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              title={hasPending ? `Lưu ${Object.keys(pendingChanges).length} thay đổi trạng thái` : 'Không có thay đổi trạng thái'}
            >
              {isBatchUpdating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Lưu trạng thái{hasPending ? ` (${Object.keys(pendingChanges).length})` : ''}
            </button>

            <button onClick={openNewModal} className="vl-btn vl-btn-success vl-btn-sm gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Thêm mới
            </button>
          </div>
        )}
      </div>

      {/* ================================================================
          TABS
      ================================================================ */}
      <div className="vl-nav-tabs flex border-b border-slate-200">
        <button onClick={() => setActiveTab('main')} className={`vl-nav-link px-6 py-3 text-sm font-bold transition-all ${activeTab === 'main' ? 'active' : ''}`}>
          <div className="flex items-center gap-2"><Users className="w-4 h-4" />Thông tin khách hàng &amp; Công tơ</div>
        </button>
        <button onClick={() => setActiveTab('hes')} className={`vl-nav-link px-6 py-3 text-sm font-bold transition-all ${activeTab === 'hes' ? 'active' : ''}`}>
          <div className="flex items-center gap-2"><CloudDownload className="w-4 h-4" />Lấy chỉ số từ HES</div>
        </button>
      </div>

      {/* ================================================================
          MAIN CONTENT
      ================================================================ */}
      {activeTab === 'hes' ? (
        <HesReadingManager />
      ) : isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải dữ liệu...</p>
        </div>
      ) : customerGroups.length === 0 ? (
        <div className="vl-card flex flex-col items-center justify-center py-20 text-slate-400">
          <Users className="w-14 h-14 mb-4 opacity-20" />
          <p className="font-semibold">Chưa có dữ liệu</p>
          <p className="text-sm mt-1">Nhấn "Thêm mới" để thêm khách hàng và công tơ đầu tiên</p>
        </div>
      ) : (
        /* ============================================================
           CUSTOMER ACCORDION CARDS
        ============================================================ */
        <div>
          {customerGroups.map(({ customer, meters }) => {
            const cid = customer.id!;
            const isExpanded = expandedIds.has(cid);
            const isEC = editingCustId === cid;

            return (
              <div key={cid} className="vl-card overflow-hidden">

                {/* ---- Card header ---- */}
                <div
                  className={`flex items-center gap-3 px-5 py-4 cursor-pointer select-none transition-colors ${isExpanded ? 'bg-[#f4f8ff]' : 'hover:bg-slate-50/60'}`}
                  onClick={() => !isEC && toggleExpand(cid)}
                >
                  <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }} className="text-slate-400 shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </motion.div>

                  {isEC ? (
                    /* EDIT MODE */
                    <div className="flex-1 flex flex-wrap items-center gap-2" onClick={e => e.stopPropagation()}>
                      <input type="text" placeholder="Mã KH" value={editCust.MKH}
                        onChange={e => setEditCust({ ...editCust, MKH: e.target.value })}
                        className="w-24 px-2 py-1 border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee] bg-white" />
                      <input type="text" placeholder="Tên khách hàng" value={editCust.Name}
                        onChange={e => setEditCust({ ...editCust, Name: e.target.value })}
                        className="flex-1 min-w-[140px] px-2 py-1 border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee] bg-white" />
                      <select value={editCust.area} onChange={e => setEditCust({ ...editCust, area: e.target.value })}
                        className="px-2 py-1 border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee] bg-white">
                        {effectiveAreas.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <button onClick={() => saveCustEdit(cid)} className="p-1.5 text-[#5a8dee] hover:bg-[#e8f3ff] rounded" title="Lưu"><CheckCircle2 className="w-4 h-4" /></button>
                      <button onClick={() => setEditingCustId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded" title="Hủy"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    /* VIEW MODE */
                    <div className="flex-1 flex flex-wrap items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">{customer.MKH || '—'}</span>
                      <span className="font-bold text-slate-800 truncate">{customer.Name || '—'}</span>
                      {(customer as any).area && (
                        <span className="vl-badge-primary text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3" />{(customer as any).area}
                        </span>
                      )}
                      <span className="vl-badge-info text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0">
                        <Gauge className="w-3 h-3" />{meters.length} công tơ
                      </span>
                    </div>
                  )}

                  {!isEC && (
                    <div className="flex items-center gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => startEditCust(customer)} className="p-1.5 text-slate-400 hover:text-[#5a8dee] hover:bg-[#e8f3ff] rounded transition-all" title="Sửa KH"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteCustomer(cid, meters.length)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-all" title="Xóa KH"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
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
                      <div className="border-t border-slate-100">
                        <table className="vl-table w-full text-left border-collapse">
                          <thead>
                            <tr>
                              <th className="pl-12">Số công tơ</th>
                              <th>Hệ số nhân</th>
                              <th>Loại CT</th>
                              <th>Trạm</th>
                              <th>Khu vực</th>
                              <th>Trạng thái</th>
                              <th className="text-right">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {meters.map(meter => {
                              const isEM = editingMeterId === meter.id;
                              const isAct = pendingChanges[meter.id] !== undefined ? pendingChanges[meter.id] : meter.Activate;
                              const isPend = pendingChanges[meter.id] !== undefined;
                              return (
                                <tr key={meter.id} className="hover:bg-[#f4f8ff] transition-colors">
                                  <td className="pl-12">
                                    {isEM ? <input type="text" value={editMeter.MeterNo} onChange={e => setEditMeter({ ...editMeter, MeterNo: e.target.value })} className={inputCls} />
                                      : <span className="font-mono text-sm font-bold text-[#5a8dee] bg-[#e8f3ff] px-2 py-1 rounded">{meter.MeterNo}</span>}
                                  </td>
                                  <td>
                                    {isEM ? <input type="text" placeholder="Hệ số nhân" value={editMeter.HSN} onChange={e => setEditMeter({ ...editMeter, HSN: e.target.value })} className={inputCls} />
                                      : <span className="text-sm text-slate-600">{meter.HSN || '—'}</span>}
                                  </td>
                                  <td>
                                    {isEM ? <input type="text" placeholder="Loại CT" value={editMeter.Type} onChange={e => setEditMeter({ ...editMeter, Type: e.target.value })} className={inputCls} />
                                      : <span className="text-sm text-slate-600">{meter.Type || '—'}</span>}
                                  </td>
                                  <td>
                                    {isEM ? <input type="text" placeholder="Trạm" value={editMeter.Line} onChange={e => setEditMeter({ ...editMeter, Line: e.target.value })} className={inputCls} />
                                      : <span className="text-sm text-slate-600">{meter.Line || '—'}</span>}
                                  </td>
                                  <td>
                                    {isEM ? <select value={editMeter.area} onChange={e => setEditMeter({ ...editMeter, area: e.target.value })} className={inputCls}>
                                        {effectiveAreas.map(a => <option key={a} value={a}>{a}</option>)}
                                      </select>
                                      : <span className="text-sm text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{meter.area}</span>}
                                  </td>
                                  <td>
                                    {isEM
                                      ? <button type="button" onClick={() => setEditMeter({ ...editMeter, Activate: !editMeter.Activate })}
                                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editMeter.Activate ? 'bg-[#5a8dee]' : 'bg-slate-300'}`}>
                                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editMeter.Activate ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                      : <div className="flex items-center gap-2">
                                          <button onClick={() => toggleActivate(meter)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAct ? 'bg-[#5a8dee]' : 'bg-slate-300'}`}>
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAct ? 'translate-x-6' : 'translate-x-1'}`} />
                                          </button>
                                          {isPend && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Chưa lưu" />}
                                        </div>}
                                  </td>
                                  <td className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      {isEM ? (
                                        <>
                                          <button onClick={() => saveMeterEdit(meter.id)} className="p-2 text-[#5a8dee] hover:bg-[#e8f3ff] rounded transition-all" title="Lưu"><CheckCircle2 className="w-4 h-4" /></button>
                                          <button onClick={() => setEditingMeterId(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded transition-all" title="Hủy"><X className="w-4 h-4" /></button>
                                        </>
                                      ) : (
                                        <>
                                          <button onClick={() => startEditMeter(meter)} className="p-2 text-slate-400 hover:text-[#5a8dee] hover:bg-[#e8f3ff] rounded transition-all" title="Sửa"><Edit2 className="w-4 h-4" /></button>
                                          <button onClick={() => deleteMeter(meter.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-all" title="Xóa"><Trash2 className="w-4 h-4" /></button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        {/* Add meter for this customer */}
                        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
                          <button onClick={() => openAddMeterModal(cid, customer)} className="vl-btn vl-btn-outline-primary vl-btn-sm gap-1.5">
                            <Plus className="w-3.5 h-3.5" /> Thêm công tơ
                          </button>
                        </div>
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
