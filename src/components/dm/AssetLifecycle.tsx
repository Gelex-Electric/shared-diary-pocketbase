/**
 * Màn "Vòng đời vật tư" (khối Văn phòng) — 4 tab tra cứu:
 *   1. Theo công tơ  — dòng thời gian các chặng của một số chế tạo
 *   2. Rà soát       — bảng vật tư khai tay đặt cạnh hóa đơn, tô chỗ lệch
 *   3. Chưa khai     — số công tơ có hóa đơn nhưng chưa có trong danh mục
 *   4. Theo điểm đo  — các đời công tơ nối tiếp nhau, kèm khoảng trống
 *
 * Toàn bộ màn này CHỈ ĐỌC: không sửa gì, chỉ đối chiếu `dm_*` với `invoice`.
 * Luật cắt chặng nằm ở `lib/dm/lifecycle.ts`, không nhân bản ở đây.
 *
 * ⚠️ Chặng hóa đơn KHÔNG phải ngày treo/tháo — công tơ treo TRƯỚC rồi mới dùng
 * điện, và tháo SAU khi ngừng dùng. Vì thế "ngày treo khai SAU hóa đơn đầu" là
 * lỗi, còn "ngày tháo khai SAU hóa đơn cuối" là bình thường.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gauge, History, ListChecks, RefreshCw, Search } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { toast } from '../../lib/toast';
import { loadCatalog, pbErrorMessage } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { loadAllInvoicesLite } from '../../lib/dm/invoiceRepo';
import { bySerial, overlaps, segmentOf, segmentsOf, ymd } from '../../lib/dm/lifecycle';
import type { InvoiceLite, Segment } from '../../lib/dm/lifecycle';
import type { Scope } from '../../lib/scope';
import { TableCard, TH_CLS } from './entryUi';

type LcTab = 'serial' | 'audit' | 'orphan' | 'point';

const TABS: TabItem<LcTab>[] = [
  { id: 'serial', label: 'Theo công tơ', icon: Search, sub: 'Dòng thời gian một số chế tạo' },
  { id: 'audit', label: 'Rà soát', icon: ListChecks, sub: 'Khai tay ↔ hóa đơn' },
  { id: 'orphan', label: 'Chưa khai', icon: AlertTriangle, sub: 'Có hóa đơn, chưa có trong danh mục' },
  { id: 'point', label: 'Theo điểm đo', icon: History, sub: 'Các đời công tơ nối tiếp' },
];

/** Ô hiển thị quãng thời gian của một chặng. */
function SegmentBar({ seg, dim }: { seg: Segment; dim?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${dim ? 'text-faint' : 'text-soft'}`}>
      <span className="font-mono text-xs font-bold text-ink">{seg.mkh}</span>
      <span className="font-mono text-xs">{seg.from} → {seg.to}</span>
      <span className="text-[11px]">({seg.count} HĐ)</span>
      {seg.hsn != null && (
        <span className="rounded bg-subtle px-2 py-0.5 text-[11px] font-bold">
          HSN {seg.hsnHistory.join(' → ')}
        </span>
      )}
      {seg.isCurrent && (
        <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-good">
          còn phát sinh
        </span>
      )}
    </span>
  );
}

/** Dòng nhắc màu vàng, dùng chung cho mọi tab. */
const Warn = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-warn">
    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
    <span>{children}</span>
  </div>
);

export default function AssetLifecycle({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  const [tab, setTab] = useState<LcTab>('audit');
  const [d, setD] = useState<CatalogData | null>(null);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickedSerial, setPickedSerial] = useState('');
  const [pickedPoint, setPickedPoint] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      // Màn này buộc phải quét hết hóa đơn (đối chiếu toàn bộ), khác form nhập
      // liệu chỉ tra một số công tơ.
      const [catalog, inv] = await Promise.all([loadCatalog(), loadAllInvoicesLite()]);
      setD(catalog);
      setInvoices(inv);
    } catch (e) {
      toast.error('Không nạp được dữ liệu', pbErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

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
  const meters = useMemo(
    () => (d?.assets ?? []).filter(a => a.type === 'CONGTO')
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
      if (on && on > mine.from) notes.push(`khai treo ${on} nhưng đã phát sinh tiền điện từ ${mine.from}`);
      if (off && off < mine.to) notes.push(`khai tháo ${off} nhưng còn phát sinh đến ${mine.to}`);
      if (mine.hsnHistory.length > 1) notes.push(`HSN từng đổi: ${mine.hsnHistory.join(' → ')}`);
      if (a.active && point?.hsn != null && mine.hsn != null && point.hsn !== mine.hsn) {
        notes.push(`HSN điểm đo ${point.hsn} ≠ HSN hóa đơn ${mine.hsn} — TI phải là ${mine.hsn * 5}/5`);
      }
    }
    for (const [x, y] of overlaps(segs)) {
      notes.push(`chồng lấn: ${x.mkh} (${x.from}→${x.to}) và ${y.mkh} (${y.from}→${y.to})`);
    }

    return { asset: a, point, mkh, segs, mine, on, off, notes };
  }), [meters, segsBySerial, pointById, d]);

  const lech = audit.filter(r => r.notes.length > 0);

  /** Số công tơ có hóa đơn nhưng chưa có bản ghi `dm_asset` nào. */
  const orphans = useMemo(() => {
    const known = new Set(meters.map(a => a.serial));
    return [...segsBySerial.entries()]
      .filter(([serial]) => !known.has(serial))
      .map(([serial, segs]) => ({ serial, segs }))
      .sort((a, b) => a.serial.localeCompare(b.serial, 'vi', { numeric: true }));
  }, [segsBySerial, meters]);

  const serialOpts = useMemo(() => {
    const all = new Set<string>([...meters.map(a => a.serial), ...segsBySerial.keys()]);
    return [...all].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))
      .map(s => ({ value: s, label: meters.some(m => m.serial === s) ? s : `${s} (chưa khai)` }));
  }, [meters, segsBySerial]);

  const pointOpts = useMemo(
    () => (d?.points ?? []).map(p => ({ value: p.id, label: p.code || p.line_name || p.id })),
    [d]);

  /** Các đời công tơ ở một điểm đo, xếp theo ngày treo, kèm khoảng trống giữa 2 đời. */
  const pointHistory = useMemo(() => {
    if (!pickedPoint) return [];
    const rows = meters.filter(a => a.point === pickedPoint)
      .sort((a, b) => (ymd(a.date_on) < ymd(b.date_on) ? -1 : 1));
    const mkh = mkhOfPoint(pickedPoint);
    return rows.map((a, i) => {
      const prev = rows[i - 1];
      const gap = prev && ymd(prev.date_off) && ymd(a.date_on) && ymd(prev.date_off) < ymd(a.date_on)
        ? `${ymd(prev.date_off)} → ${ymd(a.date_on)}`
        : '';
      return { asset: a, gap, seg: segmentOf(segsBySerial.get(a.serial) ?? [], mkh) };
    });
  }, [pickedPoint, meters, segsBySerial, d]);

  const pickedSegs = pickedSerial ? (segsBySerial.get(pickedSerial) ?? []) : [];
  const pickedAsset = meters.find(a => a.serial === pickedSerial);

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
          <span><b className={lech.length ? 'text-warn' : 'text-good'}>{lech.length}</b> có cảnh báo</span>
          <span>·</span>
          <span><b className={orphans.length ? 'text-warn' : 'text-good'}>{orphans.length}</b> chưa khai</span>
        </div>
      )}

      {/* ===================== 1. Theo công tơ ===================== */}
      {tab === 'serial' && (
        <>
          <div className="max-w-md">
            <Select value={pickedSerial} onChange={setPickedSerial} options={serialOpts}
              placeholder="Chọn số chế tạo công tơ" searchable icon={Gauge} />
          </div>

          {pickedSerial && (
            <div className="vl-card space-y-4 p-6">
              <div>
                <h3 className="font-mono text-lg font-bold text-ink">{pickedSerial}</h3>
                <p className="text-[12px] text-soft">
                  {pickedAsset
                    ? <>Đã khai tại <b className="text-ink">
                        {pointById.get(pickedAsset.point ?? '')?.code ?? '(chưa gắn điểm đo)'}</b>
                        {' '}· treo {ymd(pickedAsset.date_on) || '—'} · tháo {ymd(pickedAsset.date_off) || '—'}
                        {' '}· {pickedAsset.active ? 'đang hoạt động' : 'đã ngưng'}</>
                    : <span className="text-warn">Chưa có trong danh mục vật tư.</span>}
                </p>
              </div>

              {pickedSegs.length === 0 ? (
                <p className="italic text-faint">Số công tơ này không có hóa đơn nào.</p>
              ) : (
                <ol className="space-y-3 border-l-2 border-[var(--border)] pl-5">
                  {pickedSegs.map((s, i) => (
                    <li key={`${s.mkh}-${i}`} className="relative">
                      <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-accent" />
                      <SegmentBar seg={s} />
                    </li>
                  ))}
                </ol>
              )}

              {overlaps(pickedSegs).map(([x, y], i) => (
                <Warn key={i}>
                  Chồng lấn thời gian giữa {x.mkh} ({x.from}→{x.to}) và {y.mkh} ({y.from}→{y.to})
                  — một công tơ không thể cùng lúc đo cho hai khách.
                </Warn>
              ))}
            </div>
          )}
        </>
      )}

      {/* ======================= 2. Rà soát ======================= */}
      {tab === 'audit' && (
        <TableCard loading={loading} isEmpty={audit.length === 0}
          empty="Chưa khai công tơ nào."
          columns={<>
            <th className={`${TH_CLS} pl-10`}>Công tơ</th>
            <th className={TH_CLS}>Điểm đo</th>
            <th className={TH_CLS}>Khai tay (treo → tháo)</th>
            <th className={TH_CLS}>Hóa đơn</th>
            <th className={`${TH_CLS} pr-10`}>Nhắc</th>
          </>}>
          {audit.map(r => (
            <tr key={r.asset.id} className={`transition-colors hover:bg-subtle/50 ${r.notes.length ? '' : 'opacity-80'}`}>
              <td className="px-6 py-4 pl-10 font-mono text-sm font-bold text-ink">
                {r.asset.serial}
                {!r.asset.active && <span className="ml-2 text-[10px] font-bold uppercase text-faint">đã ngưng</span>}
              </td>
              <td className="px-6 py-4 font-mono text-xs text-soft">
                {r.point?.code ?? '—'}
                <div className="text-[11px] text-faint">{r.mkh ?? 'chưa gắn KH'}</div>
              </td>
              <td className="px-6 py-4 font-mono text-xs text-soft">
                {r.on || '—'} → {r.off || '—'}
              </td>
              <td className="px-6 py-4 text-xs">
                {r.mine ? <SegmentBar seg={r.mine} />
                  : <span className="italic text-faint">—</span>}
              </td>
              <td className="px-6 py-4 pr-10">
                {r.notes.length
                  ? <div className="space-y-1">{r.notes.map((n, i) => <Warn key={i}>{n}</Warn>)}</div>
                  : <span className="text-[11px] font-bold text-good">khớp</span>}
              </td>
            </tr>
          ))}
        </TableCard>
      )}

      {/* ====================== 3. Chưa khai ====================== */}
      {tab === 'orphan' && (
        <>
          <p className="text-[12px] text-soft">
            Số công tơ xuất hiện trong hóa đơn nhưng chưa có bản ghi vật tư nào trong danh mục.
            Khai bổ sung ở <b className="text-ink">Danh mục → Điểm đo</b>, phần bảng vật tư.
          </p>
          <TableCard loading={loading} isEmpty={orphans.length === 0}
            empty="Mọi số công tơ trong hóa đơn đều đã được khai."
            columns={<>
              <th className={`${TH_CLS} pl-10`}>Công tơ</th>
              <th className={TH_CLS}>Các chặng theo hóa đơn</th>
              <th className={`${TH_CLS} w-32 pr-10`}>Số HĐ</th>
            </>}>
            {orphans.map(o => (
              <tr key={o.serial} className="transition-colors hover:bg-subtle/50">
                <td className="px-6 py-4 pl-10 font-mono text-sm font-bold text-ink">{o.serial}</td>
                <td className="px-6 py-4">
                  <div className="space-y-1">
                    {o.segs.map((s, i) => <div key={i}><SegmentBar seg={s} /></div>)}
                  </div>
                </td>
                <td className="px-6 py-4 pr-10 text-sm font-semibold text-dim">
                  {o.segs.reduce((n, s) => n + s.count, 0)}
                </td>
              </tr>
            ))}
          </TableCard>
        </>
      )}

      {/* ===================== 4. Theo điểm đo ===================== */}
      {tab === 'point' && (
        <>
          <div className="max-w-md">
            <Select value={pickedPoint} onChange={setPickedPoint} options={pointOpts}
              placeholder="Chọn điểm đo" searchable icon={Gauge} />
          </div>

          {pickedPoint && (
            <TableCard loading={loading} isEmpty={pointHistory.length === 0}
              empty="Điểm đo này chưa khai công tơ nào."
              columns={<>
                <th className={`${TH_CLS} pl-10`}>Đời công tơ</th>
                <th className={TH_CLS}>Khai tay (treo → tháo)</th>
                <th className={`${TH_CLS} pr-10`}>Hóa đơn</th>
              </>}>
              {pointHistory.map(({ asset, gap, seg }) => (
                <tr key={asset.id} className={asset.active ? '' : 'opacity-70'}>
                  <td className="px-6 py-4 pl-10">
                    <span className="font-mono text-sm font-bold text-ink">{asset.serial}</span>
                    {asset.active && (
                      <span className="ml-2 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-good">
                        đang treo
                      </span>
                    )}
                    {gap && <Warn>Khoảng trống không có công tơ: {gap}</Warn>}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-soft">
                    {ymd(asset.date_on) || '—'} → {ymd(asset.date_off) || '—'}
                  </td>
                  <td className="px-6 py-4 pr-10 text-xs">
                    {seg ? <SegmentBar seg={seg} /> : <span className="italic text-faint">chưa có hóa đơn</span>}
                  </td>
                </tr>
              ))}
            </TableCard>
          )}
        </>
      )}
    </div>
  );
}
