/**
 * Màn "Vòng đời vật tư" — 2 tab tra cứu:
 *   1. Luân chuyển   — vật tư tái sử dụng nhiều nơi / đang nằm không / dự kiến
 *   2. Rà soát       — MỌI thứ đang lệch, gộp hai nguồn cảnh báo làm một:
 *                      vật tư đã khai mà không khớp hóa đơn, VÀ số công tơ có
 *                      hóa đơn nhưng chưa khai trong danh mục.
 *
 * Rà soát CHỈ hiện dòng có cảnh báo (user chốt 25/08/2026). Trước đây liệt kê
 * cả trăm dòng "khớp" khiến vài dòng lệch chìm nghỉm — bảng rà soát mà phải đi
 * tìm chỗ sai thì không còn là rà soát.
 *
 * Tab "Theo điểm đo" bỏ ngày 25/08/2026: cùng nội dung đó đã nằm ở card chi
 * tiết của màn "Quản lý chung", nơi người dùng chọn điểm đo ngay trên sơ đồ cây
 * thay vì phải tìm trong danh sách thả xuống.
 *
 * Toàn bộ màn này CHỈ ĐỌC: không sửa gì, chỉ đối chiếu `dm_*` với `invoice`.
 * Luật cắt chặng nằm ở `lib/dm/lifecycle.ts`, không nhân bản ở đây.
 *
 * ⚠️ Chặng hóa đơn KHÔNG phải ngày treo/tháo — công tơ treo TRƯỚC rồi mới dùng
 * điện, và tháo SAU khi ngừng dùng. Vì thế "ngày treo khai SAU hóa đơn đầu" là
 * lỗi, còn "ngày tháo khai SAU hóa đơn cuối" là bình thường.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ListChecks, RefreshCw, Recycle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { toast } from '../../lib/toast';
import { isAbortError, loadCatalog, pbErrorMessage } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { invoicesUsageOf, loadAllInvoicesLite } from '../../lib/dm/invoiceRepo';
import { bySerial, dmy, dmyRange, overlaps, recentSince, segmentOf, segmentsOf, ymd } from '../../lib/dm/lifecycle';
import { buildMainsWithSubs, checkSubDeduction } from '../../lib/dm/subDeduct';
import type { SubDeductIssue } from '../../lib/dm/subDeduct';
import type { InvoiceLite, Segment } from '../../lib/dm/lifecycle';
import type { Scope } from '../../lib/scope';
import { ASSET_LABEL } from '../../lib/dm/types';
import type { AssetType } from '../../lib/dm/types';
import { TH_CLS } from './entryUi';
import { buildPool, REUSE_MIN } from '../../lib/dm/assetPool';
import { REMOTE_LABEL, missingRemote } from '../../lib/dm/pointStatus';
import { SegmentBar, Warn } from './lifecycleUi';

type LcTab = 'pool' | 'audit';

const TABS: TabItem<LcTab>[] = [
  { id: 'pool', label: 'Luân chuyển vật tư', icon: Recycle, sub: 'Tái sử dụng · nằm không · dự kiến' },
  { id: 'audit', label: 'Rà soát', icon: ListChecks, sub: 'Chỉ những chỗ đang lệch' },
];


/** Sắc thái đầu thẻ theo mức nghiêm trọng của nhóm cảnh báo. */
const TONE: Record<'danger' | 'warn' | 'info', { bg: string; text: string }> = {
  danger: { bg: 'bg-[var(--danger-soft)]', text: 'text-bad' },
  warn: { bg: 'bg-[var(--warning-soft)]', text: 'text-warn' },
  info: { bg: 'bg-subtle', text: 'text-dim' },
};

/**
 * Một nhóm cảnh báo = một thẻ thu gọn được, có bảng riêng bên trong.
 *
 * Nhóm rỗng thì KHÔNG hiện gì: bảng rà soát nên chỉ nói về những chỗ đang lệch.
 */
function IssueSection({ id, title, desc, tone, count, open, onToggle, children }: {
  id: string;
  title: string;
  desc: string;
  tone: 'danger' | 'warn' | 'info';
  count: number;
  /** `id` của nhóm đang mở; rỗng = đóng hết. Mỗi lúc chỉ mở một nhóm. */
  open: string;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const t = TONE[tone];
  const isOpen = open === id;

  return (
    <div className="vl-card overflow-hidden">
      <button type="button" onClick={() => onToggle(isOpen ? '' : id)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-subtle/50">
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-black ${t.bg} ${t.text}`}>
          {count}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-ink">{title}</span>
          <span className="block text-[11px] text-faint">{desc}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div key="body"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden">
            <div className="overflow-x-auto border-t border-[var(--border)]">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AssetLifecycle({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  const [tab, setTab] = useState<LcTab>('audit');
  const [d, setD] = useState<CatalogData | null>(null);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [loading, setLoading] = useState(true);
  /** Cảnh báo phụ trừ — tra riêng vì cần các cột sản lượng, xem `subDeduct.ts`. */
  const [subIssues, setSubIssues] = useState<SubDeductIssue[]>([]);
  /** Nhóm cảnh báo đang mở ở tab Rà soát. Mở sẵn nhóm phụ trừ vì nó nặng nhất. */
  const [openSection, setOpenSection] = useState('sub');

  const load = async () => {
    setLoading(true);
    try {
      // Màn này buộc phải quét hết hóa đơn (đối chiếu toàn bộ), khác form nhập
      // liệu chỉ tra một số công tơ.
      const [catalog, inv] = await Promise.all([loadCatalog(), loadAllInvoicesLite()]);
      setD(catalog);
      setInvoices(inv);
    } catch (e) {
      if (isAbortError(e)) return;
      toast.error('Không nạp được dữ liệu', pbErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  /**
   * Đối chiếu phụ trừ của các điểm đo chính CÓ điểm đo phụ, trong 40 ngày gần
   * đây. Tra tách khỏi `load()` vì cần thêm 6 cột sản lượng mà chỉ việc này
   * dùng tới, và chỉ tra đúng các số công tơ liên quan chứ không quét cả kho.
   */
  useEffect(() => {
    if (!d) return;
    let cancelled = false;
    void (async () => {
      const mains = buildMainsWithSubs(d.points, d.assets);
      if (!mains.length) { setSubIssues([]); return; }

      const since = recentSince(new Date());
      const serials = mains.flatMap(m => [...m.serials, ...m.subs.flatMap(x => x.serials)]);
      try {
        const usage = await invoicesUsageOf(serials, since);
        if (cancelled) return;
        setSubIssues(mains.flatMap(m => checkSubDeduction(m, usage, since)));
      } catch (e) {
        // Không chặn cả màn vì một phép đối chiếu phụ hỏng.
        if (!isAbortError(e)) toast.error('Không đối chiếu được phụ trừ', pbErrorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [d]);

  /* ----------------------- dữ liệu dẫn xuất ----------------------- */

  const invBySerial = useMemo(() => bySerial(invoices), [invoices]);

  /** Chặng của mọi số công tơ có mặt trong hóa đơn. */
  const segsBySerial = useMemo(() => {
    const map = new Map<string, Segment[]>();
    for (const [serial, rows] of invBySerial) map.set(serial, segmentsOf(rows));
    return map;
  }, [invBySerial]);

  const pointById = useMemo(() => new Map((d?.points ?? []).map(p => [p.id, p])), [d]);
  const mkhOf = (customerId?: string) => d?.customers.find(c => c.id === customerId)?.mkh;
  const mkhOfPoint = (pointId?: string) => mkhOf(pointById.get(pointId ?? '')?.customer);

  /** Chỉ công tơ mới có hóa đơn — TI/TU/GP-03 không xuất hiện trong invoice. */
  /**
   * Công tơ ĐÃ LẮP. Bỏ vật tư đang nằm kho (`point` rỗng — xem tab "Vật tư dự
   * kiến"): chúng chưa lắp ở đâu nên đương nhiên chưa có hóa đơn, đem vào rà
   * soát chỉ đẻ ra cảnh báo giả.
   */
  const meters = useMemo(
    () => (d?.assets ?? []).filter(a => a.type === 'CONGTO' && a.point)
      .sort((a, b) => a.serial.localeCompare(b.serial, 'vi', { numeric: true })),
    [d]);

  /** Mỗi công tơ đã khai: gộp bản khai tay với chặng hóa đơn của đúng khách của nó. */
  const audit = useMemo(() => meters.map(a => {
    const point = pointById.get(a.point ?? '');
    const mkh = mkhOfPoint(a.point);
    const segs = segsBySerial.get(a.serial) ?? [];
    const mine = segmentOf(segs, mkh);
    const on = ymd(a.date_on);
    const off = ymd(a.date_off);

    const notes: string[] = [];
    if (!segs.length) notes.push('chưa có hóa đơn nào');
    else if (!mine) {
      notes.push(`hóa đơn thuộc khách khác: ${segs.map(s => s.mkh).join(', ')}`);
    } else {
      if (on && on > mine.from) notes.push(`khai treo ${dmy(on)} nhưng đã phát sinh tiền điện từ ${dmy(mine.from)}`);
      if (off && off < mine.to) notes.push(`khai tháo ${dmy(off)} nhưng còn phát sinh đến ${dmy(mine.to)}`);
      if (mine.hsnHistory.length > 1) notes.push(`HSN từng đổi: ${mine.hsnHistory.join(' → ')}`);
      if (a.active && point?.hsn != null && mine.hsn != null && point.hsn !== mine.hsn) {
        notes.push(`HSN điểm đo ${point.hsn} ≠ HSN hóa đơn ${mine.hsn} — TI phải là ${mine.hsn * 5}/5`);
      }
    }
    for (const [x, y] of overlaps(segs)) {
      notes.push(`chồng lấn: ${x.mkh} (${dmyRange(x.from, x.to)}) và ${y.mkh} (${dmyRange(y.from, y.to)})`);
    }

    return { asset: a, point, mkh, segs, mine, on, off, notes };
  }), [meters, segsBySerial, pointById, d]);

  /** Số công tơ có hóa đơn nhưng chưa có bản ghi `dm_asset` nào. */
  const orphans = useMemo(() => {
    const known = new Set(meters.map(a => a.serial));
    return [...segsBySerial.entries()]
      .filter(([serial]) => !known.has(serial))
      .map(([serial, segs]) => ({ serial, segs }))
      .sort((a, b) => a.serial.localeCompare(b.serial, 'vi', { numeric: true }));
  }, [segsBySerial, meters]);

  /**
   * Tab Rà soát chia thành nhiều BẢNG RIÊNG theo loại lệch (user chốt
   * 25/08/2026), mỗi bảng chỉ có đúng những cột nó cần.
   *
   * Trước đó gộp làm một bảng: cột phải chứa được mọi loại cảnh báo nên hàng
   * nào cũng có ô trống, và bảng dồn hết về trái. Tách ra thì mỗi bảng vừa gọn
   * vừa đọc được, và người dùng thấy ngay loại lệch nào đang có bao nhiêu.
   *
   * Nhóm nào không có dòng nào thì không hiện.
   */
  const noInvoice = useMemo(
    () => audit.filter(r => r.notes.some(x => x.startsWith('chưa có hóa đơn'))),
    [audit]);

  /** Lệch ngày treo/tháo, HSN, chồng lấn, hóa đơn của khách khác. */
  const mismatch = useMemo(
    () => audit.filter(r => r.notes.length > 0 && !r.notes.some(x => x.startsWith('chưa có hóa đơn'))),
    [audit]);

  /**
   * Điểm đo ĐANG VẬN HÀNH mà thiếu GP-03 hoặc SIM. Rà cả loạt ở đây, khỏi phải
   * mở từng điểm đo mới biết cái nào mất đo xa.
   */
  const noRemote = useMemo(() => {
    if (!d) return [];
    return d.points
      .filter(p => p.status === 'active')
      .map(p => {
        const rows = d.assets.filter(a => a.point === p.id);
        return { point: p, missing: missingRemote(rows), rows };
      })
      .filter(x => x.missing.length)
      .sort((a, b) => (a.point.code ?? '').localeCompare(b.point.code ?? '', 'vi', { numeric: true }));
  }, [d]);

  const issueCount = subIssues.length + mismatch.length + noInvoice.length
    + orphans.length + noRemote.length;

  /**
   * Ba nhóm vòng đời lắp đặt. Xét MỌI loại vật tư, không riêng công tơ: TI, TU,
   * GP-03 cũng luân chuyển và cũng nằm kho.
   */
  const pool = useMemo(() => buildPool(d?.assets ?? []), [d]);

  /** Mã điểm đo + mã khách của một lần lắp, để hiện trong bảng. */
  const whereOf = (pointId?: string) => {
    const p = pointId ? pointById.get(pointId) : undefined;
    if (!p) return { code: '—', mkh: '' };
    return { code: p.code || p.line_name || p.id, mkh: mkhOf(p.customer) ?? '' };
  };

  /* ------------------------------ giao diện ------------------------------ */

  return (
    <div className="space-y-6">
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">Vòng đời vật tư</h2>
          <p className="mt-1 text-sm text-soft">
            Đối chiếu vật tư đã khai với hóa đơn — chỉ tra cứu, không sửa gì.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="vl-btn vl-btn-secondary flex items-center gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Nạp lại
        </button>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={t => setTab(t)} />

      {!loading && (
        <div className="flex flex-wrap gap-3 text-[12px] text-soft">
          <span><b className="text-ink">{invoices.length}</b> hóa đơn</span>
          <span>·</span>
          <span><b className="text-ink">{meters.length}</b> công tơ đã khai</span>
          <span>·</span>
          <span><b className={issueCount ? 'text-warn' : 'text-good'}>{issueCount}</b> chỗ cần xem</span>
        </div>
      )}

      {/* ================== 1. Luân chuyển vật tư ================== */}
      {tab === 'pool' && (
        <div className="space-y-4">
          <p className="text-[12px] text-soft">
            Vòng đời LẮP ĐẶT của vật tư, suy từ các bản ghi trong danh mục. Một vật tư có thể
            nằm ở nhiều bảng: từng luân chuyển vài nơi mà hiện đang tháo xuống thì có mặt ở cả
            bảng 1 lẫn bảng 2.
          </p>

          {/* ---- 1a. Tái sử dụng nhiều nơi ---- */}
          <IssueSection id="reused" title={`Đã tái sử dụng (từ ${REUSE_MIN} nơi trở lên)`} tone="info"
            count={pool.reused.length}
            desc="Vật tư từng lắp ở nhiều điểm đo khác nhau — mỗi lần lắp là một bản ghi riêng, giữ nguyên lịch sử."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[16%] pl-8`}>Số chế tạo</th>
                  <th className={`${TH_CLS} w-[14%]`}>Thiết bị</th>
                  <th className={`${TH_CLS} w-[8%] text-center`}>Số nơi</th>
                  <th className={`${TH_CLS} w-[62%] pr-8`}>Đã lắp ở đâu, khi nào</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pool.reused.map(x => (
                  <tr key={x.serial} className="transition-colors hover:bg-subtle/50">
                    <td className="px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink">{x.serial}</td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-dim">
                      {ASSET_LABEL[x.type as AssetType] ?? x.type}
                      {x.ratio && <div className="font-mono text-[11px] font-normal text-faint">{x.ratio}</div>}
                    </td>
                    <td className="px-4 py-3 text-center text-[13px] font-black text-ink">{x.installs.length}</td>
                    <td className="px-4 py-3 pr-8">
                      <div className="space-y-1">
                        {x.installs.map(i => {
                          const w = whereOf(i.pointId);
                          return (
                            <div key={i.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="font-mono font-bold text-dim">{w.code}</span>
                              {w.mkh && <span className="font-mono text-faint">{w.mkh}</span>}
                              <span className="font-mono text-soft">{dmyRange(i.from, i.to)}</span>
                              {i.active && (
                                <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-good">
                                  đang treo
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IssueSection>

          {/* ---- 1b. Đã tháo, chưa lắp lại ---- */}
          <IssueSection id="idle" title="Đã tháo xuống, chưa lắp lại" tone="warn" count={pool.idle.length}
            desc="Không còn hoạt động ở điểm đo nào — đang nằm không, có thể dùng lại. Xếp theo ngày tháo mới nhất."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[18%] pl-8`}>Số chế tạo</th>
                  <th className={`${TH_CLS} w-[16%]`}>Thiết bị</th>
                  <th className={`${TH_CLS} w-[14%]`}>Ngày tháo</th>
                  <th className={`${TH_CLS} w-[52%] pr-8`}>Tháo khỏi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pool.idle.map(x => {
                  const last = [...x.installs].sort((a, b) => (a.to < b.to ? -1 : 1)).pop()!;
                  const w = whereOf(last.pointId);
                  return (
                    <tr key={x.serial} className="transition-colors hover:bg-subtle/50">
                      <td className="px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink">
                        {x.serial}
                        {x.installs.length >= REUSE_MIN && (
                          <div className="text-[10px] font-normal text-faint">đã qua {x.installs.length} nơi</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-dim">
                        {ASSET_LABEL[x.type as AssetType] ?? x.type}
                        {x.ratio && <div className="font-mono text-[11px] font-normal text-faint">{x.ratio}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-soft">{dmy(last.to) || '—'}</td>
                      <td className="px-4 py-3 pr-8">
                        <span className="font-mono text-[12px] font-bold text-dim">{w.code}</span>
                        {w.mkh && <span className="ml-2 font-mono text-[11px] text-faint">{w.mkh}</span>}
                        <div className="font-mono text-[11px] text-faint">{dmyRange(last.from, last.to)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </IssueSection>

          {/* ---- 1c. Dự kiến ---- */}
          <IssueSection id="planned" title="Vật tư dự kiến" tone="info" count={pool.planned.length}
            desc="Đã khai vào điểm đo nhưng CHƯA có ngày treo — chưa tính vào HSN, chưa đối chiếu hóa đơn."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[18%] pl-8`}>Số chế tạo</th>
                  <th className={`${TH_CLS} w-[16%]`}>Thiết bị</th>
                  <th className={`${TH_CLS} w-[40%]`}>Dự kiến lắp tại</th>
                  <th className={`${TH_CLS} w-[26%] pr-8`}>Đang lắp ở đâu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pool.planned.map(x => {
                  const live = x.installs.filter(i => i.active);
                  return (
                    <tr key={x.serial} className="transition-colors hover:bg-subtle/50">
                      <td className="px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink">{x.serial}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-dim">
                        {ASSET_LABEL[x.type as AssetType] ?? x.type}
                        {x.ratio && <div className="font-mono text-[11px] font-normal text-faint">{x.ratio}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {x.plannedAt.map(i => {
                            const w = whereOf(i.pointId);
                            return (
                              <div key={i.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="font-mono font-bold text-dim">{w.code}</span>
                                {w.mkh && <span className="font-mono text-faint">{w.mkh}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 pr-8 text-[11px]">
                        {live.length
                          ? live.map(i => (
                              <div key={i.id} className="font-mono text-warn">
                                {whereOf(i.pointId).code} — còn đang treo
                              </div>
                            ))
                          : <span className="italic text-faint">không ở đâu</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </IssueSection>
        </div>
      )}

      {/* ======================= 2. Rà soát ======================= */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <p className="text-[12px] text-soft">
            Chỉ liệt kê những chỗ danh mục và hóa đơn KHÔNG khớp nhau. Bảng nào không có
            dòng nào thì không hiện — không còn bảng nào tức là mọi thứ đang khớp.
          </p>

          {!loading && issueCount === 0 && (
            <div className="vl-card py-14 text-center text-[13px] italic text-faint">
              Không có chỗ nào lệch — danh mục khớp hóa đơn.
            </div>
          )}

          {/* ---- 2a. Sản lượng phụ trừ ---- */}
          <IssueSection id="sub" title="Sản lượng phụ trừ lệch" tone="danger" count={subIssues.length}
            desc="Chỉ xét điểm đo đang vận hành. Phụ trừ trên hóa đơn điểm đo chính phải bằng tổng sản lượng các điểm đo phụ cùng kỳ (40 ngày gần đây)."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[24%] pl-8`}>Điểm đo chính</th>
                  <th className={`${TH_CLS} w-[18%]`}>Kỳ hóa đơn</th>
                  <th className={`${TH_CLS} w-[14%] text-right`}>Phụ trừ (BT/CĐ/TĐ)</th>
                  <th className={`${TH_CLS} w-[14%] text-right`}>Tổng điểm đo phụ</th>
                  <th className={`${TH_CLS} w-[30%] pr-8`}>Cảnh báo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {subIssues.map((x, i) => (
                  <tr key={`${x.code}-${i}`} className="transition-colors hover:bg-subtle/50">
                    <td className="truncate px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink" title={x.code}>{x.code}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-soft">{x.periodLabel}</td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-dim">
                      {x.declared.bt}/{x.declared.cd}/{x.declared.td}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-dim">
                      {x.actual.bt}/{x.actual.cd}/{x.actual.td}
                    </td>
                    <td className="px-4 py-3 pr-8"><Warn>{x.note}</Warn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IssueSection>

          {/* ---- 2b. Vật tư lệch so với hóa đơn ---- */}
          <IssueSection id="mismatch" title="Vật tư lệch so với hóa đơn" tone="warn" count={mismatch.length}
            desc="Ngày treo / ngày tháo, HSN hoặc khách hàng không khớp với hóa đơn của chính số công tơ đó."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[14%] pl-8`}>Công tơ</th>
                  <th className={`${TH_CLS} w-[22%]`}>Điểm đo</th>
                  <th className={`${TH_CLS} w-[16%]`}>Khai tay (treo → tháo)</th>
                  <th className={`${TH_CLS} w-[22%]`}>Hóa đơn</th>
                  <th className={`${TH_CLS} w-[26%] pr-8`}>Cảnh báo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {mismatch.map(r => (
                  <tr key={r.asset.id} className="transition-colors hover:bg-subtle/50">
                    <td className="px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink">
                      {r.asset.serial}
                      {!r.asset.active && <div className="text-[10px] font-bold uppercase text-faint">đã ngưng</div>}
                    </td>
                    <td className="truncate px-4 py-3 font-mono text-[11px] text-soft" title={r.point?.code ?? ''}>
                      {r.point?.code ?? '—'}
                      <div className="text-[11px] text-faint">{r.mkh ?? 'chưa gắn KH'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-soft">{dmyRange(r.on, r.off)}</td>
                    <td className="px-4 py-3 text-[11px]">
                      {r.mine ? <SegmentBar seg={r.mine} /> : <span className="italic text-faint">—</span>}
                    </td>
                    <td className="px-4 py-3 pr-8">
                      <div className="space-y-1">{r.notes.map((x, i) => <Warn key={i}>{x}</Warn>)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IssueSection>

          {/* ---- 2c. Đã khai nhưng chưa có hóa đơn ---- */}
          <IssueSection id="noinv" title="Đã khai nhưng chưa có hóa đơn" tone="info" count={noInvoice.length}
            desc="Công tơ có trong danh mục nhưng chưa xuất hiện ở hóa đơn nào — bình thường nếu vừa treo, đáng ngờ nếu đã treo lâu."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[18%] pl-8`}>Công tơ</th>
                  <th className={`${TH_CLS} w-[38%]`}>Điểm đo</th>
                  <th className={`${TH_CLS} w-[22%]`}>Khách hàng</th>
                  <th className={`${TH_CLS} w-[22%] pr-8`}>Khai tay (treo → tháo)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {noInvoice.map(r => (
                  <tr key={r.asset.id} className="transition-colors hover:bg-subtle/50">
                    <td className="px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink">
                      {r.asset.serial}
                      {!r.asset.active && <div className="text-[10px] font-bold uppercase text-faint">đã ngưng</div>}
                    </td>
                    <td className="truncate px-4 py-3 font-mono text-[12px] text-soft" title={r.point?.code ?? ''}>
                      {r.point?.code ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-soft">{r.mkh ?? 'chưa gắn KH'}</td>
                    <td className="px-4 py-3 pr-8 font-mono text-[11px] text-soft">{dmyRange(r.on, r.off)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IssueSection>

          {/* ---- 2d. Đang vận hành nhưng mất đo xa ---- */}
          <IssueSection id="remote" title="Đang vận hành nhưng thiếu đo xa" tone="warn" count={noRemote.length}
            desc="Điểm đo đang vận hành phải có đủ GP-03 và SIM. Thiếu một trong hai là không đẩy được chỉ số về HES."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[34%] pl-8`}>Điểm đo</th>
                  <th className={`${TH_CLS} w-[16%]`}>Khách hàng</th>
                  <th className={`${TH_CLS} w-[22%]`}>Thiếu</th>
                  <th className={`${TH_CLS} w-[28%] pr-8`}>Đang có</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {noRemote.map(({ point, missing, rows }) => (
                  <tr key={point.id} className="transition-colors hover:bg-subtle/50">
                    <td className="truncate px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink"
                      title={point.code ?? ''}>
                      {point.code || point.line_name || point.id}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-soft">{mkhOf(point.customer) ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Warn>{missing.map(t => REMOTE_LABEL[t]).join(' và ')}</Warn>
                    </td>
                    {/*
                      Chỉ kể cái ĐÃ TREO, kèm nhãn cho cái mới chỉ dự kiến —
                      không thì cột "Thiếu" và cột này đọc ra mâu thuẫn: báo
                      thiếu GP-03 trong khi bên cạnh vẫn liệt kê một cái GP-03.
                    */}
                    <td className="px-4 py-3 pr-8 font-mono text-[11px] text-soft">
                      {rows.filter(a => a.active && (a.type === 'GP03' || a.type === 'SIM'))
                        .map(a => `${a.type} ${a.serial}${a.date_on ? '' : ' (dự kiến)'}`)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IssueSection>

          {/* ---- 2e. Có hóa đơn nhưng chưa khai ---- */}
          <IssueSection id="orphan" title="Có hóa đơn nhưng chưa khai" tone="warn" count={orphans.length}
            desc="Số công tơ đang phát sinh hóa đơn nhưng chưa có bản ghi vật tư nào. Khai bổ sung ở Danh mục → Điểm đo."
            open={openSection} onToggle={setOpenSection}>
            <table className="vl-table w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className={`${TH_CLS} w-[18%] pl-8`}>Công tơ</th>
                  <th className={`${TH_CLS} w-[70%]`}>Các chặng theo hóa đơn</th>
                  <th className={`${TH_CLS} w-[12%] pr-8 text-right`}>Số HĐ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {orphans.map(o => (
                  <tr key={o.serial} className="transition-colors hover:bg-subtle/50">
                    <td className="px-4 py-3 pl-8 font-mono text-[13px] font-bold text-ink">{o.serial}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {o.segs.map((x, i) => <div key={i}><SegmentBar seg={x} /></div>)}
                      </div>
                    </td>
                    <td className="px-4 py-3 pr-8 text-right text-[13px] font-semibold text-dim">
                      {o.segs.reduce((k, x) => k + x.count, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IssueSection>
        </div>
      )}

    </div>
  );
}
