import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw, Plus, Search, Lock, AlertTriangle, Ban, Archive, Save, Undo2,
  MapPin, Building2, Gauge, Package, ChevronDown, Upload, Users,
} from 'lucide-react';
import { toast as notify } from '../../lib/toast';
import { fetchCatalog, isAbortError, type CatalogData, hasRatio, viDate } from '../../lib/catalog';
import { hsnOfPoint } from '../../lib/hsn';
import { validateCatalog } from '../../lib/validate';
import { canEdit } from '../../lib/assign';
import {
  type EntityKind, ENTITY_LABEL, deleteBlockers, assetHasLedger,
  createRecord, updateRecord, deleteRecord, liquidateAsset, columnsOf, parseRatioText,
} from '../../lib/catalogCrud';
import { motion, AnimatePresence } from 'motion/react';
import { Tabs } from '../ui/Tabs';
import { Select } from '../ui/Select';
import RecordForm from './RecordForm';
import EditableTable, { type Draft } from './EditableTable';
import AssetLifecycle from './AssetLifecycle';
import BulkImportAssets from './BulkImportAssets';
import ValidationBar from './ValidationBar';

const EMPTY: CatalogData = {
  zones: [], stations: [], customers: [], points: [], periods: [],
  warehouses: [], assets: [], installs: [],
};

// Bo tab Kho: moi KCN dung 1 kho, tao san boi script, khong can quan ly rieng
/** 'mkh' KHONG phai EntityKind: no gan khach hang vao diem do (ghi
    dm_point_customer), khong phai CRUD mot bang. */
const TABS: EntityKind[] = ['zone', 'station', 'point', 'asset', 'customer'];
const TAB_LABEL: Record<EntityKind, string> = {
  zone: 'Khu công nghiệp', station: 'Trạm', point: 'Điểm đo', asset: 'Vật tư',
  warehouse: 'Kho', customer: 'Khách hàng',
};
const TAB_ICON: Record<EntityKind, any> = {
  zone: MapPin, station: Building2, point: Gauge, asset: Package,
  warehouse: Package, customer: Users,
};

/** Trang QUẢN LÝ DANH MỤC — thêm / sửa / xóa. Kéo thả nằm ở trang riêng. */
export default function CatalogAdmin() {
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<EntityKind>('zone');
  const kind: EntityKind = tab;
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<{ kind: EntityKind; record: any | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ kind: EntityKind; record: any; blockers: string[]; ledger: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [lifecycleId, setLifecycleId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const editable = canEdit();

  const lifecycleAsset = lifecycleId ? data.assets.find(a => a.id === lifecycleId) ?? null : null;

  // Soat rang buoc ngay tren du lieu da nap - xem `src/lib/validate.ts`.
  const validation = useMemo(() => validateCatalog(data), [data]);

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

  // Đổi tab hoặc gõ tìm kiếm ⇒ về trang 1, tránh đứng ở trang trống
  useEffect(() => { setPage(1); }, [tab, term, perPage]);

  const dirtyCount = Object.keys(draft).length;

  const onChange = (id: string, key: string, value: any) =>
    setDraft(d => ({ ...d, [id]: { ...(d[id] ?? {}), [key]: value } }));

  /** Lưu tất cả dòng đã sửa. Dòng nào lỗi thì giữ lại trong draft để sửa tiếp. */
  const saveAll = async () => {
    const ids = Object.keys(draft);
    if (!ids.length) return;
    setBusy(true);
    let ok = 0;
    const failed: Draft = {};
    const errs: string[] = [];
    for (const id of ids) {
      const rec = (rowsRaw as any[]).find(r => r.id === id);
      const patch: Record<string, any> = {};
      let ratioBad = false;
      for (const [k, v] of Object.entries(draft[id])) {
        const col = columnsOf(kind).find(c => c.key === k);
        if (!col || col.kind === 'readonly') continue;
        if (k === 'ratio_text') {
          // Ô tỷ số gộp: "2000/5" -> sơ cấp / thứ cấp / tỷ số
          const parsed = parseRatioText(String(v));
          if (!parsed) { ratioBad = true; continue; }
          Object.assign(patch, parsed);
          continue;
        }
        patch[k] = col.kind === 'number' ? (v === '' || v == null ? null : Number(v)) : v;
      }
      if (ratioBad) {
        failed[id] = draft[id];
        errs.push(`${rec?.serial ?? id}: tỷ số phải dạng 2000/5`);
        continue;
      }
      // Đổi loại sang thứ không có tỷ số ⇒ xoá tỷ số cũ, tránh HSN tính nhầm
      if (tab === 'asset' && 'type' in patch && !hasRatio(String(patch.type))) {
        patch.ratio_primary = null; patch.ratio_secondary = null; patch.ratio = null;
      }
      try {
        await updateRecord(kind, id, patch);
        ok++;
      } catch (e: any) {
        failed[id] = draft[id];
        const detail = e?.response?.data
          ? Object.entries(e.response.data).map(([k, x]: any) => `${k}: ${x?.message ?? x}`).join('; ')
          : (e?.message || String(e));
        errs.push(`${rec?.code ?? rec?.serial ?? rec?.line_name ?? id}: ${detail}`);
      }
    }
    setDraft(failed);
    setBusy(false);
    if (ok) notify.show('success', 'Đã lưu', `${ok} dòng`);
    if (errs.length) notify.show('error', `${errs.length} dòng lưu lỗi`, errs.slice(0, 3).join(' | '));
    await load();
  };

  /** Bản ghi của tab đang chọn, đã lọc theo ô tìm kiếm. */
  const rowsRaw = useMemo(() => {
    const t = term.trim().toLowerCase();
    const hit = (s: string) => !t || s.toLowerCase().includes(t);
    switch (tab) {
      case 'zone': return data.zones.filter(z => hit(`${z.code} ${z.name}`));
      case 'station': return data.stations.filter(s => hit(`${s.code} ${s.name ?? ''}`));
      case 'point': return data.points.filter(p => hit(`${p.line_id} ${p.line_name}`));
      case 'asset': return data.assets.filter(a => hit(`${a.serial} ${a.model_desc ?? ''}`));
      case 'warehouse': return data.warehouses.filter(w => hit(`${w.code} ${w.name}`));
      case 'customer': return data.customers.filter(c => hit(`${c.mkh} ${c.name} ${c.address ?? ''}`));
    }
  }, [tab, data, term]) as any[];

  const cols = useMemo(() => columnsOf(kind), [kind]);

  /**
   * Trạm và Điểm đo chia MỖI KCN MỘT BẢNG (giống trang Công nợ khách hàng).
   * Mỗi nhóm nhiều nhất ~45 dòng nên không cần phân trang; KCN và Vật tư vẫn
   * dùng bảng phẳng + phân trang vì có thể tới ~700 dòng.
   */
  const grouped = tab === 'station' || tab === 'point' || tab === 'customer';

  const zoneGroups = useMemo(() => {
    if (!grouped) return [];
    return data.zones
      .map(z => ({ zone: z, rows: rowsRaw.filter((r: any) => r.zone === z.id) }))
      .filter(g => g.rows.length > 0 || !term.trim());
  }, [grouped, data.zones, rowsRaw, term]);

  const orphanRows = useMemo(
    () => (grouped ? rowsRaw.filter((r: any) => !r.zone) : []),
    [grouped, rowsRaw],
  );

  const totalPages = Math.max(1, Math.ceil(rowsRaw.length / perPage));
  const pageRows = useMemo(
    () => rowsRaw.slice((page - 1) * perPage, page * perPage),
    [rowsRaw, page, perPage],
  );

  /** Giá trị cho các cột tính toán (không sửa được). */
  const computeCell = useCallback((rec: any, key: string): string => {
    switch (key) {
      case '_stations': return String(data.stations.filter(s => s.zone === rec.id).length);
      case '_points':
        return String(tab === 'zone'
          ? data.points.filter(p => p.zone === rec.id).length
          : tab === 'customer'
            ? data.periods.filter(k => k.customer === rec.id && k.is_current).length
            : data.points.filter(p => p.station === rec.id).length);
      case '_assets': return String(data.installs.filter(i => i.point === rec.id && i.is_current).length);


      // HSN suy từ TI/TU đang treo — KHÔNG lấy số gõ tay (user chốt 05/08).
      case '_hsn_calc': {
        const r = hsnOfPoint(data, rec.id);
        if (r.value == null) return '—';
        return r.missingRatio.length ? `${r.value} ⚠` : String(r.value);
      }

      // Ngày treo hiện tại, hoặc ngày tháo của lần treo gần nhất.
      case '_mounted': {
        const cur = data.installs.find(i => i.asset === rec.id && i.is_current);
        if (cur) return `treo ${viDate(cur.from_date)}`;
        const past = data.installs
          .filter(i => i.asset === rec.id && i.to_date)
          .sort((x, y) => String(y.to_date).localeCompare(String(x.to_date)))[0];
        return past ? `tháo ${viDate(past.to_date)}` : '—';
      }

      default: return '';
    }
  }, [data, tab]);

  const askDelete = async (rec: any) => {
    const blockers = deleteBlockers(kind, rec.id, data);
    let ledger = 0;
    if (tab === 'asset') {
      try { ledger = await assetHasLedger(rec.id); }
      catch { ledger = -1; }   // không đọc được ⇒ coi như có, chặn cho an toàn
    }
    setConfirmDel({ kind, record: rec, blockers, ledger });
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteRecord(confirmDel.kind, confirmDel.record.id);
      notify.show('success', 'Đã xóa', `${ENTITY_LABEL[confirmDel.kind]} ${confirmDel.record.code ?? confirmDel.record.serial ?? confirmDel.record.line_name}`);
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
          <button onClick={() => {
              if (dirtyCount > 0 && !window.confirm(`Còn ${dirtyCount} dòng chưa lưu. Tải lại sẽ mất thay đổi. Tiếp tục?`)) return;
              setDraft({}); load();
            }}
            className="vl-btn vl-btn-secondary vl-btn-sm px-2!" title="Tải lại">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {editable && dirtyCount > 0 && (
            <>
              <button onClick={() => setDraft({})} disabled={busy}
                className="vl-btn vl-btn-secondary vl-btn-sm"
                title="Bỏ mọi thay đổi chưa lưu">
                <Undo2 className="w-4 h-4" />Hoàn tác
              </button>
              <button onClick={saveAll} disabled={busy}
                className="vl-btn vl-btn-success vl-btn-sm">
                <Save className="w-4 h-4" />
                {busy ? 'Đang lưu...' : `Lưu ${dirtyCount} dòng`}
              </button>
            </>
          )}
          {editable && tab === 'asset' && (
            <button onClick={() => setBulkOpen(true)}
              className="vl-btn vl-btn-secondary vl-btn-sm">
              <Upload className="w-4 h-4" />Thêm hàng loạt
            </button>
          )}
          {editable && (
            <button onClick={() => setEditing({ kind, record: null })}
              className="vl-btn vl-btn-primary vl-btn-sm">
              <Plus className="w-4 h-4" />Thêm {ENTITY_LABEL[kind].toLowerCase()}
            </button>
          )}
        </div>
      </div>

      {!isLoading && <ValidationBar result={validation} />}

      {!editable && (
        <p className="text-xs bg-subtle text-soft font-bold px-3 py-2 rounded flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" />Tài khoản vận hành chỉ xem được, không sửa danh mục.
        </p>
      )}

      {editable && dirtyCount > 0 && (
        <p className="text-xs bg-[var(--warning-soft)] text-warn font-bold px-3 py-2 rounded flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {dirtyCount} dòng đã sửa nhưng CHƯA lưu lên máy chủ. Ô nền vàng là ô vừa đổi.
        </p>
      )}

      <Tabs
        tabs={TABS.map(t => ({
          id: t,
          label: `${TAB_LABEL[t]}${
            t === 'zone' ? ` (${data.zones.length})`
              : t === 'station' ? ` (${data.stations.length})`
              : t === 'point' ? ` (${data.points.length})`
              : t === 'asset' ? ` (${data.assets.length})`
              : t === 'customer' ? ` (${data.customers.length})`
              : ''
          }`,
          icon: TAB_ICON[t],
        }))}
        value={tab}
        onChange={t => {
          if (dirtyCount > 0 && !window.confirm(`Còn ${dirtyCount} dòng chưa lưu. Rời tab sẽ mất thay đổi. Tiếp tục?`)) return;
          setTab(t); setTerm(''); setDraft({});
        }}
      />

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-faint">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" /><p>Đang tải...</p>
        </div>
      ) : grouped ? (
        <div className="space-y-4">
          {zoneGroups.map(({ zone, rows }) => {
            const isOpen = !collapsed[zone.id];
            const dirtyHere = rows.filter((r: any) => draft[r.id]).length;
            return (
              <div key={zone.id} className="vl-card overflow-hidden mb-0!">
                <div
                  onClick={() => setCollapsed(c => ({ ...c, [zone.id]: !c[zone.id] }))}
                  className="bg-accent px-5 py-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3 text-[var(--on-accent)] min-w-0">
                    <div className="p-2 bg-white/20 rounded-xl shrink-0">
                      {tab === 'station' ? <Building2 className="w-5 h-5" /> : <Gauge className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-black tracking-tight leading-tight truncate">{zone.name}</h3>
                      <p className="text-[11px] font-semibold opacity-80">
                        {rows.length} {ENTITY_LABEL[kind].toLowerCase()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {dirtyHere > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-black">
                        {dirtyHere} chưa lưu
                      </span>
                    )}
                    <ChevronDown className={`w-5 h-5 text-[var(--on-accent)] transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <EditableTable
                        kind={tab} cols={cols} rows={rows} data={data} draft={draft}
                        editable={editable} onChange={onChange} onDelete={askDelete}
                        computeCell={computeCell}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {orphanRows.length > 0 && (
            <div className="vl-card overflow-hidden mb-0!">
              <div className="bg-[var(--warning)] px-5 py-3.5 flex items-center gap-3 text-white">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <h3 className="text-base font-black tracking-tight">Chưa gán khu công nghiệp</h3>
                  <p className="text-[11px] font-semibold opacity-90">{orphanRows.length} bản ghi — cần chọn KCN</p>
                </div>
              </div>
              <EditableTable
                kind={tab} cols={cols} rows={orphanRows} data={data} draft={draft}
                editable={editable} onChange={onChange} onDelete={askDelete}
                computeCell={computeCell}
              />
            </div>
          )}
        </div>
      ) : (
        /* Tab Vật tư: bảng bên trái + thẻ vòng đời bên phải, cùng bố cục với
           trang Sắp xếp điểm đo (user chốt 05/08). Các tab khác vẫn full chiều
           ngang vì không có thẻ chi tiết đi kèm. */
        /* Ty le 3/4 - 1/4 (user chot 05/08): bang la thu lam viec chinh, the chi
           tiet chi de tra cuu nen khong can rong bang do. */
        <div className={tab === 'asset' && lifecycleAsset
          ? 'grid grid-cols-1 xl:grid-cols-[3fr_1fr] gap-4 items-start'
          : ''}>
          <div className="vl-card overflow-hidden mb-0! min-w-0">
            <EditableTable
              kind={kind} cols={cols} rows={pageRows} data={data} draft={draft}
              editable={editable} onChange={onChange} onDelete={askDelete}
              computeCell={computeCell}
              onOpenLifecycle={tab === 'asset' ? rec => setLifecycleId(rec.id) : undefined}
              onEditRecord={rec => setEditing({ kind, record: rec })}
              selectedId={lifecycleId}
            />
          </div>
          {tab === 'asset' && lifecycleAsset && (
            /* order-first duoi nguong xl: mot cot thi the phai nam TRUOC bang,
               khong thi nguoi dung phai cuon qua ca tram dong moi thay (user
               bao 05/08 "thu nho lai thi the phu khong xuat hien"). */
            <div className="order-first xl:order-none xl:sticky xl:top-4">
              <AssetLifecycle
                inline
                asset={lifecycleAsset} data={data} canEditNow={editable}
                onClose={() => setLifecycleId(null)}
                onChanged={load}
              />
            </div>
          )}
        </div>
      )}

      {!isLoading && !grouped && rowsRaw.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-soft">
            Hiện <strong className="text-ink">{(page - 1) * perPage + 1}–{Math.min(page * perPage, rowsRaw.length)}</strong>
            {' '}trên <strong className="text-ink">{rowsRaw.length}</strong> {ENTITY_LABEL[kind].toLowerCase()}
            {dirtyCount > 0 && <span className="text-warn"> · {dirtyCount} dòng chưa lưu (giữ nguyên khi đổi trang)</span>}
          </span>
          <div className="flex items-center gap-2">
            <Select
              value={String(perPage)} onChange={v => setPerPage(Number(v))}
              options={[25, 50, 100, 200].map(n => ({ value: String(n), label: `${n} dòng/trang` }))}
              className="w-[152px]"
            />
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="vl-btn vl-btn-secondary vl-btn-sm px-2.5!">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="vl-btn vl-btn-secondary vl-btn-sm px-2.5!">‹</button>
              <span className="px-3 text-soft">Trang <strong className="text-ink">{page}</strong>/{totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="vl-btn vl-btn-secondary vl-btn-sm px-2.5!">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
                className="vl-btn vl-btn-secondary vl-btn-sm px-2.5!">»</button>
            </div>
          </div>
        </div>
      )}



      {bulkOpen && (
        <BulkImportAssets data={data} onClose={() => setBulkOpen(false)}
          onDone={load} />
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
        const name = confirmDel.record.code ?? confirmDel.record.serial ?? confirmDel.record.line_name;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setConfirmDel(null)}>
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
                      className="vl-btn vl-btn-secondary w-full justify-center">
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
                  className="vl-btn vl-btn-secondary">
                  Đóng
                </button>
                {!blocked && (
                  <button onClick={doDelete} disabled={busy}
                    className="vl-btn vl-btn-danger">
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
