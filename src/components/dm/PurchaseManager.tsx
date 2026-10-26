/**
 * ĐẶT MUA VẬT TƯ — màn của Nhóm Vật Tư (luồng cấp vật tư, đợt 3, 26/10/2026,
 * plan `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md` mục 3.4).
 *
 *   Cần mua  : phần thiếu của mọi điểm đo gom theo QUY CÁCH, đã trừ hàng đang về
 *              và hàng rảnh trong kho (`purchaseNeeds`). Tích quy cách ⇒ tạo đơn.
 *   Đơn mua  : danh sách đơn, trạng thái SUY RA từ số đã nhận; "Nhận hàng" mở
 *              đúng hộp Thêm vật tư của Kho (`AddStockModal`) đã khoá quy cách;
 *              dòng đơn dành cho điểm đo nào thì hỏi phân bổ luôn cho điểm đo đó.
 *
 * Đơn mua KHÔNG cần duyệt (user chốt 26/10/2026) — Vật Tư tự đặt.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, ShoppingCart, ClipboardList, Plus, Trash2, PackagePlus, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Tabs, type TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/dashboard';
import { toast } from '../../lib/toast';
import { CellInput, Field, FormModal, TextInput } from './entryUi';
import AddStockModal, { type StockPreset } from './AddStockModal';
import VariantCell from './VariantCell';
import { needText } from './SupplyAllocate';
import {
  isAbortError, loadCatalog, pbErrorMessage, purchaseLines as lineRepo, purchases as purchaseRepo,
  type CatalogData,
} from '../../lib/dm/repo';
import {
  HAS_RATIO, PURCHASE_STATE_LABEL, nextPurchaseCode, openBorrowsByPoint, purchaseNeeds, purchaseState,
  receivedByLine, type BuyRow, type PurchaseState,
} from '../../lib/dm/supply';
import { planAttach } from '../../lib/dm/attach';
import { runAttach } from '../../lib/dm/attachRun';
import { formatRatio, parseRatio } from '../../lib/dm/hsn';
import { dmy } from '../../lib/dm/lifecycle';
import {
  ASSET_LABEL, DEFAULT_TI_SHAPE, type AssetType, type Connection, type Device, type Purchase, type PurchaseLine, type TiShape,
} from '../../lib/dm/types';

type View = 'need' | 'orders';
const VIEWS: TabItem<View>[] = [
  { id: 'need', label: 'Cần mua', icon: ShoppingCart },
  { id: 'orders', label: 'Đơn mua', icon: ClipboardList },
];
const today = () => new Date().toISOString().slice(0, 10);
const STATE_CLS: Record<PurchaseState, string> = {
  huy: 'vl-badge-danger', da_dat: 'vl-badge-info', ve_mot_phan: 'vl-badge-warning', du: 'vl-badge-success',
};
const TYPE_OPTS = (Object.keys(ASSET_LABEL) as AssetType[]).map(t => ({ value: t, label: ASSET_LABEL[t] }));

/** Một dòng trên form tạo đơn — số và tỷ số giữ dạng chuỗi cho ô nhập. */
interface DraftLine {
  key: string; type: AssetType | ''; ratio: string; shape: TiShape | ''; meterKind: Connection | ''; qty: string; forPoint: string;
}
let seq = 0;
const draft = (x: Partial<DraftLine> = {}): DraftLine =>
  ({ key: `l${++seq}`, type: '', ratio: '', shape: DEFAULT_TI_SHAPE, meterKind: '', qty: '1', forPoint: '', ...x });

export default function PurchaseManager() {
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<View>('need');
  const [d, setD] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setD(await loadCatalog()); } catch (e) {
      if (!isAbortError(e)) toast.error('Không đọc được dữ liệu', pbErrorMessage(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const codeOf = (id?: string) => d?.points.find(p => p.id === id)?.code ?? '';
  const borrowed = useMemo(() => new Set(openBorrowsByPoint(d?.borrows ?? []).keys()), [d]);
  const needs = useMemo<BuyRow[]>(() => (d ? purchaseNeeds(d.points, d, borrowed) : []), [d, borrowed]);
  const toBuyTotal = needs.reduce((s, r) => s + r.toBuy, 0);

  /* ------------------------------ tạo đơn mua ------------------------------ */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [head, setHead] = useState({ code: '', ordered_at: today(), supplier: '', expected_at: '', note: '' });
  const [lines, setLines] = useState<DraftLine[]>([]);

  /**
   * Mở form từ các quy cách đã tích: chia số NÊN MUA cho từng điểm đo của quy
   * cách đó (bị mượn trước) — dòng đơn có "dành cho điểm đo" thì điểm đo đó mới
   * chuyển sang "Chờ hàng về". Phần lẻ còn lại thành dòng dự phòng.
   */
  const openCreate = (fromNeeds: boolean) => {
    const out: DraftLine[] = [];
    if (fromNeeds) {
      for (const r of needs.filter(x => picked.has(x.key) && x.toBuy > 0)) {
        let left = r.toBuy;
        const base = {
          type: r.spec.type, ratio: formatRatio(r.spec.ratio_primary, r.spec.ratio_secondary),
          shape: (r.spec.shape || '') as TiShape | '',
          meterKind: (r.spec.meter_kind || '') as Connection | '',
        };
        const pts = [...r.points].sort((a, b) => Number(b.borrowed) - Number(a.borrowed) || Number(!!b.point.urgent) - Number(!!a.point.urgent));
        for (const np of pts) {
          if (!left) break;
          const q = Math.min(left, np.missing);
          out.push(draft({ ...base, qty: String(q), forPoint: np.point.id }));
          left -= q;
        }
        if (left > 0) out.push(draft({ ...base, qty: String(left) }));
      }
    }
    setLines(out.length ? out : [draft()]);
    setHead({ code: nextPurchaseCode(d?.purchases ?? []), ordered_at: today(), supplier: '', expected_at: '', note: '' });
    setCreating(true);
  };
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const pointOpts = useMemo(() => [
    { value: '', label: 'Dự phòng' },
    ...(d?.points ?? []).filter(p => p.code).map(p => ({ value: p.id, label: p.code! }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ], [d]);

  const saveCreate = async () => {
    const code = head.code.trim();
    if (!code) return toast.warning('Thiếu mã đơn', 'Nhập mã đơn mua.');
    if ((d?.purchases ?? []).some(p => p.code === code)) return toast.error('Trùng mã đơn', `${code} đã có.`);
    const valid = lines.filter(l => l.type && parseInt(l.qty, 10) > 0);
    if (!valid.length) return toast.warning('Đơn chưa có dòng nào', 'Chọn loại và số lượng.');
    const noRatio = valid.find(l => HAS_RATIO.includes(l.type as AssetType) && !l.ratio.trim());
    if (noRatio) return toast.warning('Thiếu tỷ số', `${ASSET_LABEL[noRatio.type as AssetType]} phải có tỷ số.`);
    setSaving(true);
    let n = 0;
    try {
      const po = await purchaseRepo.create({
        code, ordered_at: head.ordered_at, supplier: head.supplier.trim(),
        expected_at: head.expected_at, note: head.note.trim(),
      });
      // Tuần tự — lỗi giữa chừng còn biết đã ghi bao nhiêu dòng.
      for (const l of valid) {
        const { primary, secondary } = parseRatio(l.ratio);
        await lineRepo.create({
          purchase: (po as { id: string }).id, type: l.type as AssetType,
          ...(HAS_RATIO.includes(l.type as AssetType) ? { ratio_primary: primary, ratio_secondary: secondary } : {}),
          shape: l.type === 'TI' ? l.shape : '', meter_kind: l.type === 'CONGTO' ? l.meterKind : '', qty: parseInt(l.qty, 10), for_point: l.forPoint,
        });
        n++;
      }
      toast.success('Đã tạo đơn mua', `${code} · ${n} dòng.`);
      setCreating(false); setPicked(new Set()); setView('orders');
      await load();
    } catch (e) {
      toast.error(`Dừng sau ${n} dòng`, pbErrorMessage(e));
      await load();
    } finally { setSaving(false); }
  };

  /* -------------------------------- đơn mua -------------------------------- */
  const [openPo, setOpenPo] = useState<string | null>(null);
  const got = useMemo(() => receivedByLine(d?.devices ?? []), [d]);
  const orders = useMemo(() => (d?.purchases ?? []).map(p => ({
    p, ...purchaseState(p, d!.purchaseLines, d!.devices),
    lines: d!.purchaseLines.filter(l => l.purchase === p.id),
  })), [d]);

  const toggleCancel = async (p: Purchase) => {
    const ok = await confirm({
      title: p.cancelled ? 'Bỏ hủy đơn' : 'Hủy đơn mua',
      message: p.cancelled
        ? `Khôi phục đơn ${p.code}? Hàng chờ về của đơn lại được tính.`
        : `Hủy đơn ${p.code}? Thiết bị đã nhận theo đơn vẫn giữ nguyên trong kho.`,
      variant: p.cancelled ? undefined : 'danger',
    });
    if (!ok) return;
    try { await purchaseRepo.update(p.id, { cancelled: !p.cancelled }); await load(); }
    catch (e) { toast.error('Không lưu được', pbErrorMessage(e)); }
  };

  /* ------------------------------- nhận hàng ------------------------------- */
  const [receiving, setReceiving] = useState<{ line: PurchaseLine; po: Purchase; preset: StockPreset } | null>(null);
  const openReceive = (po: Purchase, line: PurchaseLine) => setReceiving({
    po, line,
    preset: {
      type: line.type, ratio_primary: line.ratio_primary, ratio_secondary: line.ratio_secondary,
      shape: line.shape || '', meterKind: line.meter_kind || '', purchaseLine: line.id, batch: po.code,
      pending: Math.max(0, line.qty - (got.get(line.id) ?? 0)),
      holdNote: line.for_point ? '' : 'Dự phòng',
    },
  });

  /** Hàng về theo dòng đơn "dành cho điểm đo X" ⇒ hỏi phân bổ luôn cho X. */
  const afterReceive = async (created: Device[]) => {
    const r = receiving;
    if (created.length) setReceiving(null);
    const data = await loadCatalog().catch(() => null);
    if (data) setD(data);
    if (!r?.line.for_point || !created.length || !data) return;
    const code = codeOf(r.line.for_point);
    const ok = await confirm({
      title: 'Phân bổ luôn?',
      message: `Dòng đơn này dành cho ${code}. Phân bổ ${created.length} thiết bị vừa nhập cho ${code} (dạng dự kiến)?`,
    });
    if (!ok) return;
    const plan = planAttach(created, r.line.for_point, data);
    if (plan.blocks.length) {
      toast.error('Chưa phân bổ được — làm ở màn Phân bổ vật tư', `${plan.blocks.join('. ')}.`);
      return;
    }
    try {
      await runAttach(created, r.line.for_point, '', plan.moves, `Nhận hàng đơn ${r.po.code}`);
      toast.success('Đã phân bổ', `${created.length} thiết bị cho ${code}.`);
    } catch (e) { toast.error('Phân bổ dừng giữa chừng', pbErrorMessage(e)); }
    await load();
  };

  /* -------------------------------- giao diện -------------------------------- */
  return (
    <div className="space-y-6">
      {dialog}
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">Đặt mua vật tư</h2>
          <p className="mt-1 text-sm text-soft">
            Phần thiếu của các điểm đo đã trừ hàng đang về và hàng rảnh trong kho — tạo đơn, nhận hàng vào kho
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void load()} disabled={loading}
            className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Nạp lại
          </button>
          <button onClick={() => openCreate(false)} className="vl-btn vl-btn-outline-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Đơn trống
          </button>
        </div>
      </div>

      <Tabs tabs={VIEWS} value={view} onChange={v => setView(v as View)} />

      {view === 'need' && (
        <div className="vl-card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-soft">
              Cần mua tổng <b className="text-ink">{toBuyTotal}</b> thiết bị · {needs.length} quy cách đang thiếu
            </p>
            <button disabled={!picked.size} onClick={() => openCreate(true)}
              className="vl-btn vl-btn-primary vl-btn-sm flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" /> Tạo đơn từ {picked.size} quy cách
            </button>
          </div>
          {!loading && needs.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Không có quy cách nào đang thiếu"
              hint="Điểm đo chưa khai nhu cầu không được tính — Kinh Doanh khai ở form điểm đo." />
          ) : (
            <div className="overflow-x-auto">
              <table className="vl-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th className="text-left">Quy cách</th>
                    <th className="text-center">Thiếu</th>
                    <th className="text-center">Đang về</th>
                    <th className="text-center">Tồn rảnh</th>
                    <th className="text-center">Cần mua</th>
                    <th className="text-left">Điểm đo</th>
                  </tr>
                </thead>
                <tbody>
                  {needs.map(r => (
                    <tr key={r.key}>
                      <td>
                        <input type="checkbox" disabled={!r.toBuy} checked={picked.has(r.key)}
                          aria-label={`Chọn ${needText({ ...r.spec, qty: 0 }, false)}`}
                          onChange={() => setPicked(s => {
                            const n = new Set(s);
                            if (n.has(r.key)) n.delete(r.key); else n.add(r.key);
                            return n;
                          })} />
                      </td>
                      <td>{needText({ ...r.spec, qty: 0 }, false)}</td>
                      <td className="text-center">{r.missing}</td>
                      <td className="text-center">{r.onOrder || '—'}</td>
                      <td className="text-center">{r.inStock || '—'}</td>
                      <td className={`text-center font-bold ${r.toBuy ? 'text-bad' : 'text-faint'}`}>{r.toBuy || '—'}</td>
                      <td className="text-[12px] text-soft">
                        {r.points.map(np => (
                          <span key={np.point.id} className="mr-2 inline-flex items-center gap-1 whitespace-nowrap">
                            <span className="font-mono">{np.point.code}</span> ×{np.missing}
                            {np.borrowed && <span className="vl-badge-primary">bị mượn</span>}
                            {np.point.urgent && <span className="vl-badge-danger">gấp</span>}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-faint">
                "Tồn rảnh" có hàng thì chỉ cần phân bổ ở màn Phân bổ vật tư, không phải mua.
              </p>
            </div>
          )}
        </div>
      )}

      {view === 'orders' && (
        !loading && orders.length === 0 ? (
          <div className="vl-card p-5">
            <EmptyState icon={ClipboardList} title="Chưa có đơn mua nào" hint="Tạo đơn ở tab Cần mua." />
          </div>
        ) : (
          <div className="vl-card overflow-hidden"><div className="overflow-x-auto">
            <table className="vl-table w-full text-sm">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th className="text-left">Mã đơn</th>
                  <th className="text-left">Ngày đặt</th>
                  <th className="text-left">Nhà cung cấp</th>
                  <th className="text-left">Dự kiến về</th>
                  <th className="text-center">Đã nhận</th>
                  <th className="text-left">Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const late = o.p.expected_at && o.p.expected_at.slice(0, 10) < today()
                    && (o.state === 'da_dat' || o.state === 've_mot_phan');
                  const isOpen = openPo === o.p.id;
                  return [
                    <tr key={o.p.id} className={o.p.cancelled ? 'opacity-60' : ''}>
                      <td>
                        <button type="button" onClick={() => setOpenPo(isOpen ? null : o.p.id)}
                          className="text-faint hover:text-dim" aria-label="Xem dòng đơn">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="font-mono font-bold">{o.p.code}</td>
                      <td>{dmy(o.p.ordered_at)}</td>
                      <td>{o.p.supplier || <span className="text-faint">—</span>}</td>
                      <td className={late ? 'font-bold text-bad' : ''}>
                        {o.p.expected_at ? dmy(o.p.expected_at) : <span className="text-faint">—</span>}
                        {late && ' · trễ'}
                      </td>
                      <td className="text-center">{o.received}/{o.ordered}</td>
                      <td><span className={STATE_CLS[o.state]}>{PURCHASE_STATE_LABEL[o.state]}</span></td>
                      <td className="text-right">
                        <button className="vl-btn vl-btn-sm vl-btn-secondary" onClick={() => void toggleCancel(o.p)}>
                          {o.p.cancelled ? 'Bỏ hủy' : 'Hủy đơn'}
                        </button>
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${o.p.id}-lines`}>
                        <td />
                        <td colSpan={7}>
                          <table className="vl-table w-full text-sm">
                            <thead>
                              <tr>
                                <th className="text-left">Quy cách</th>
                                <th className="text-left">Dành cho</th>
                                <th className="text-center">Đặt</th>
                                <th className="text-center">Đã nhận</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {o.lines.map(l => {
                                const n = got.get(l.id) ?? 0;
                                return (
                                  <tr key={l.id}>
                                    <td>{needText({ ...l, qty: 0 }, false)}</td>
                                    <td className="font-mono text-[12px]">{l.for_point ? codeOf(l.for_point) : 'Dự phòng'}</td>
                                    <td className="text-center">{l.qty}</td>
                                    <td className={`text-center ${n >= l.qty ? 'text-emerald-600' : ''}`}>{n}</td>
                                    <td className="text-right">
                                      {!o.p.cancelled && (
                                        <button className="vl-btn vl-btn-sm vl-btn-primary flex items-center gap-1.5"
                                          onClick={() => openReceive(o.p, l)}>
                                          <PackagePlus className="h-4 w-4" /> Nhận hàng
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {o.p.note && <p className="mt-2 text-[12px] text-soft">Ghi chú: {o.p.note}</p>}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div></div>
        )
      )}

      {/* ------------------------------ form tạo đơn ------------------------------ */}
      <FormModal open={creating} title="Tạo đơn mua" wide onClose={() => setCreating(false)}
        onSubmit={() => void saveCreate()} saving={saving} submitLabel="Tạo đơn">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Mã đơn" required>
            <TextInput value={head.code} mono onChange={v => setHead(h => ({ ...h, code: v }))} />
          </Field>
          <Field label="Ngày đặt">
            <DatePicker value={head.ordered_at} onChange={v => setHead(h => ({ ...h, ordered_at: v }))} usePortal />
          </Field>
          <Field label="Dự kiến về" hint="Quá ngày mà chưa về đủ sẽ báo trễ">
            <DatePicker value={head.expected_at} onChange={v => setHead(h => ({ ...h, expected_at: v }))} usePortal />
          </Field>
          <Field label="Nhà cung cấp">
            <TextInput value={head.supplier} onChange={v => setHead(h => ({ ...h, supplier: v }))} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Ghi chú">
              <TextInput value={head.note} onChange={v => setHead(h => ({ ...h, note: v }))} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
          <p className="mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
            <ClipboardList className="h-4 w-4" /> Dòng đơn
          </p>
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-surface">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: '22%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead className="border-b border-[var(--border)] bg-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-soft">Loại</th>
                  <th className="px-4 py-3 text-left font-bold text-soft">Tỷ số</th>
                  <th className="px-2 py-3 text-left font-bold text-soft" title="TI: tròn / vuông · Công tơ: trực tiếp / gián tiếp">Kiểu</th>
                  <th className="px-2 py-3 text-left font-bold text-soft">SL</th>
                  <th className="px-2 py-3 text-left font-bold text-soft">Dành cho</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {lines.map(l => (
                  <tr key={l.key}>
                    <td className="p-2">
                      <Select value={l.type} variant="bare" options={TYPE_OPTS} placeholder="Chọn loại"
                        onChange={v => setLine(l.key, { type: v as AssetType })} />
                    </td>
                    <td className="p-2">
                      {HAS_RATIO.includes(l.type as AssetType) ? (
                        <CellInput value={l.ratio} mono placeholder="1000/5" onChange={v => setLine(l.key, { ratio: v })} />
                      ) : <span className="block p-2 text-faint">—</span>}
                    </td>
                    <td className="p-2">
                      <VariantCell type={l.type} shape={l.shape} meterKind={l.meterKind}
                        onShape={shape => setLine(l.key, { shape })} onMeterKind={meterKind => setLine(l.key, { meterKind })} />
                    </td>
                    <td className="p-2">
                      <CellInput value={l.qty} type="number" align="center" onChange={v => setLine(l.key, { qty: v })} />
                    </td>
                    <td className="p-2">
                      <Select value={l.forPoint} variant="bare" searchable options={pointOpts}
                        onChange={v => setLine(l.key, { forPoint: v })} />
                    </td>
                    <td className="p-2 text-center">
                      <button type="button" title="Bỏ dòng" className="text-faint hover:text-bad"
                        onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="mt-3 vl-btn vl-btn-sm vl-btn-secondary flex items-center gap-1.5"
            onClick={() => setLines(ls => [...ls, draft()])}>
            <Plus className="h-4 w-4" /> Thêm dòng
          </button>
          <p className="mt-2 text-[11px] text-faint">
            Dòng "dành cho" một điểm đo làm điểm đo đó chuyển sang "Chờ hàng về" và được hỏi phân bổ luôn khi hàng về.
          </p>
        </div>
      </FormModal>

      {/* ------------------------------ nhận hàng ------------------------------ */}
      <AddStockModal open={!!receiving} onClose={() => setReceiving(null)} devices={d?.devices ?? []}
        preset={receiving?.preset} onSaved={afterReceive}
        title={receiving
          ? `Nhận hàng ${receiving.po.code} — ${needText({ ...receiving.line, qty: 0 }, false)}`
            + (receiving.line.for_point ? ` cho ${codeOf(receiving.line.for_point)}` : '')
          : ''} />
    </div>
  );
}
