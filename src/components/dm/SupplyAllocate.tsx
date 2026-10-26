/**
 * PHÂN BỔ VẬT TƯ — màn của Nhóm Vật Tư (luồng cấp vật tư, đợt 2, 26/10/2026,
 * plan `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md` mục 3.2–3.3, 5).
 *
 * Mỗi điểm đo CÒN THIẾU vật tư so với nhu cầu Kinh Doanh khai một thẻ. Bấm
 * "Phân bổ" ở dòng thiếu ⇒ chọn thiết bị rảnh trong kho khớp quy cách; điểm đo
 * CẦN GẤP còn được MƯỢN vật tư dự kiến của điểm đo khác (ghi sổ `dm_borrow`).
 *
 * Phân bổ = tạo dòng `dm_asset` DỰ KIẾN + giữ chỗ — cùng luật và cùng hàm ghi
 * với "Gắn vào điểm đo" ở Kho vật tư (`lib/dm/attach.ts`, `attachRun.ts`).
 * Đủ/thiếu, gợi ý, đóng sổ mượn: `lib/dm/supply.ts` (thuần, có test).
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, PackageCheck, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { Select } from '../ui/Select';
import { EmptyState } from '../ui/dashboard';
import { toast } from '../../lib/toast';
import { FormModal } from './entryUi';
import { borrows as borrowRepo, isAbortError, loadCatalog, pbErrorMessage, type CatalogData } from '../../lib/dm/repo';
import {
  SUPPLY_STATE_LABEL, allocCandidates, borrowCandidates, borrowsToSettle, openBorrowsByPoint,
  pointSupply, type BorrowCandidate, type Candidate, type PointSupply,
} from '../../lib/dm/supply';
import { planAttach } from '../../lib/dm/attach';
import { runAttach } from '../../lib/dm/attachRun';
import { formatRatio } from '../../lib/dm/hsn';
import { pointZoneId } from '../../lib/dm/pointScope';
import { dmy } from '../../lib/dm/lifecycle';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import { ASSET_LABEL, SHAPE_LABEL, type Device, type NeedLine, type Point } from '../../lib/dm/types';

const today = () => new Date().toISOString().slice(0, 10);

/** "3 × TI (biến dòng) 1000/5 · Vuông" */
export function needText(n: NeedLine, withQty = true): string {
  const ratio = formatRatio(n.ratio_primary, n.ratio_secondary);
  return `${withQty ? `${n.qty} × ` : ''}${ASSET_LABEL[n.type]}${ratio ? ` ${ratio}` : ''}`
    + `${n.type === 'TI' && n.shape ? ` · ${SHAPE_LABEL[n.shape]}` : ''}`;
}

interface Row { p: Point; s: PointSupply; zone?: string; borrowed: number }

export default function SupplyAllocate() {
  const [d, setD] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zone, setZone] = useState('');
  const [search, setSearch] = useState('');

  /** Đang phân bổ cho điểm đo nào, dòng nhu cầu nào (chỉ số trong `need`). */
  const [target, setTarget] = useState<{ p: Point; line: NeedLine; missing: number } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const data = await loadCatalog();
      // Đóng sổ mượn của điểm đo đã được bù đủ — không cần ai bấm "trả".
      const settle = borrowsToSettle(data.borrows, data.points, data);
      for (const b of settle) await borrowRepo.update(b.id, { settled_at: today() });
      if (settle.length) {
        data.borrows = data.borrows.map(b => (settle.some(x => x.id === b.id) ? { ...b, settled_at: today() } : b));
        toast.info('Đã đóng sổ mượn', `${settle.length} thiết bị — điểm đo bị mượn đã được bù đủ.`);
      }
      setD(data);
    } catch (e) {
      if (!isAbortError(e)) toast.error('Không đọc được dữ liệu', pbErrorMessage(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const borrowed = useMemo(() => openBorrowsByPoint(d?.borrows ?? []), [d]);

  /** Điểm đo còn thiếu (② thiếu, ③ chờ hàng). Gấp lên đầu, rồi bị mượn, rồi theo mã. */
  const rows = useMemo<Row[]>(() => {
    if (!d) return [];
    return d.points
      .map(p => ({ p, s: pointSupply(p, d), zone: pointZoneId(p, d.stations, d.lines), borrowed: borrowed.get(p.id) ?? 0 }))
      .filter(r => r.s.state === 'thieu' || r.s.state === 'cho_hang')
      .sort((a, b) =>
        Number(!!b.p.urgent) - Number(!!a.p.urgent)
        || (a.p.urgent ? (a.p.needed_by || '9').localeCompare(b.p.needed_by || '9') : 0)
        || Number(b.borrowed > 0) - Number(a.borrowed > 0)
        || (a.p.code ?? '').localeCompare(b.p.code ?? ''));
  }, [d, borrowed]);

  const terms = useMemo(() => buildTerms(search), [search]);
  const shown = rows.filter(r => (!zone || r.zone === zone) && matchesTerms([r.p.code, r.p.note], terms));
  const zoneOpts = [
    { value: '', label: `Tất cả KCN (${rows.length})` },
    ...(d?.zones ?? [])
      .map(z => ({ z, n: rows.filter(r => r.zone === z.id).length }))
      .filter(x => x.n > 0)
      .map(({ z, n }) => ({ value: z.id, label: `${z.name} (${n})` })),
  ];

  /* ------------------------------ hộp phân bổ ------------------------------ */
  const fromStock: Candidate[] = useMemo(
    () => (target && d ? allocCandidates(target.p.id, target.line, d) : []), [target, d]);
  const fromBorrow: BorrowCandidate[] = useMemo(
    () => (target?.p.urgent && d ? borrowCandidates(target.p.id, target.line, d.points, d) : []), [target, d]);

  const open = (p: Point, line: NeedLine, missing: number) => {
    setTarget({ p, line, missing });
    // Chọn sẵn đủ số thiếu từ KHO (khớp chắc chắn trước) — không chọn sẵn hàng mượn.
    const pre = d ? allocCandidates(p.id, line, d).slice(0, missing).map(c => c.device.id) : [];
    setPicked(new Set(pre));
  };
  const toggle = (id: string) => setPicked(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const pickedDevices: Device[] = useMemo(() => {
    const all = [...fromStock.map(c => c.device), ...fromBorrow.map(c => c.device)];
    return all.filter((x, i) => picked.has(x.id) && all.findIndex(y => y.id === x.id) === i);
  }, [picked, fromStock, fromBorrow]);
  const plan = useMemo(
    () => (target && d ? planAttach(pickedDevices, target.p.id, d) : { blocks: [], moves: [] }),
    [pickedDevices, target, d]);
  const over = target ? pickedDevices.length - target.missing : 0;

  const save = async () => {
    if (!target) return;
    if (!pickedDevices.length) return toast.warning('Chưa chọn thiết bị', 'Tích ít nhất một thiết bị.');
    if (plan.blocks.length) return toast.error('Chưa phân bổ được', `${plan.blocks.join('. ')}.`);
    setSaving(true);
    let n = 0;
    try {
      await runAttach(pickedDevices, target.p.id, '', plan.moves,
        `Mượn cho điểm đo cần gấp ${target.p.code ?? ''}`.trim(), k => { n = k; });
      toast.success('Đã phân bổ', `${n} thiết bị cho ${target.p.code}`
        + (plan.moves.length ? ` (mượn ${plan.moves.length})` : '') + '.');
      setTarget(null);
      await load();
    } catch (e) {
      toast.error(`Dừng sau ${n} thiết bị`, pbErrorMessage(e));
      await load();
    } finally { setSaving(false); }
  };

  /* --------------------------------- giao diện --------------------------------- */
  return (
    <div className="space-y-6">
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">Phân bổ vật tư</h2>
          <p className="mt-1 text-sm text-soft">
            Điểm đo còn thiếu so với nhu cầu Kinh Doanh khai — cần gấp và bị mượn xếp trước
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 md:w-auto">
          <div className="w-full sm:w-[220px]">
            <Select value={zone} onChange={setZone} options={zoneOpts} />
          </div>
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Tìm mã điểm đo..."
              className="w-full rounded-lg border border-[var(--border)] bg-surface py-2 pl-10 pr-4
                text-sm text-dim focus:outline-none focus:ring-1 focus:ring-accent sm:w-[220px]" />
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Nạp lại
          </button>
        </div>
      </div>

      {!loading && shown.length === 0 && (
        <div className="vl-card">
          <EmptyState icon={PackageCheck} title="Không có điểm đo nào thiếu vật tư"
            hint="Điểm đo chưa khai nhu cầu không hiện ở đây — Kinh Doanh khai ở form điểm đo." />
        </div>
      )}

      {shown.map(({ p, s, borrowed: nBorrowed }) => (
        <div key={p.id} className="vl-card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[15px] font-bold text-ink">{p.code}</span>
            <span className={s.state === 'cho_hang' ? 'vl-badge-info' : 'vl-badge-warning'}>
              {SUPPLY_STATE_LABEL[s.state]} · thiếu {s.missing}
            </span>
            {p.urgent && (
              <span className="vl-badge-danger">Cần gấp{p.needed_by ? ` · ${dmy(p.needed_by)}` : ''}</span>
            )}
            {nBorrowed > 0 && <span className="vl-badge-primary">Bị mượn {nBorrowed}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="vl-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Quy cách</th>
                  <th className="text-center">Cần</th>
                  <th className="text-center">Đã có</th>
                  <th className="text-center">Thiếu</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {needText(l.line, false)}
                      {l.unsureShape > 0 && (
                        <span className="ml-2 text-[11px] text-faint">({l.unsureShape} TI chưa rõ hình dạng)</span>
                      )}
                    </td>
                    <td className="text-center">{l.line.qty}</td>
                    <td className="text-center">{l.have.length}</td>
                    <td className={`text-center font-bold ${l.missing ? 'text-bad' : 'text-faint'}`}>{l.missing || '—'}</td>
                    <td className="text-right">
                      {l.missing > 0 && (
                        <button className="vl-btn vl-btn-sm vl-btn-primary" onClick={() => open(p, l.line, l.missing)}>
                          Phân bổ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <FormModal open={!!target} wide onClose={() => setTarget(null)} onSubmit={() => void save()} saving={saving}
        title={target ? `Phân bổ ${needText(target.line, false)} cho ${target.p.code}` : ''}
        submitLabel={pickedDevices.length ? `Phân bổ ${pickedDevices.length} thiết bị` : 'Chưa chọn thiết bị'}>
        {target && (<>
          <p className="text-sm text-soft">
            Còn thiếu <b className="text-ink">{target.missing}</b>. Đã chọn <b className="text-ink">{pickedDevices.length}</b>
            {over > 0 && <span className="text-bad"> — thừa {over} so với số thiếu</span>}.
            Thiết bị được ghi dạng <b>dự kiến</b> (chưa ngày treo) — Vận Hành khai ngày treo khi lắp.
          </p>

          <PickTable title={`Trong kho (${fromStock.length})`} picked={picked} onToggle={toggle}
            empty="Kho không còn thiết bị rảnh khớp quy cách này — cần đặt mua."
            rows={fromStock.map(c => ({ device: c.device, match: c.match }))} />

          {target.p.urgent ? (
            <PickTable title={`Mượn từ điểm đo khác (${fromBorrow.length})`} picked={picked} onToggle={toggle}
              icon={ArrowRightLeft}
              empty="Không có vật tư dự kiến nào ở điểm đo không gấp, chưa treo khớp quy cách này."
              rows={fromBorrow.map(c => ({
                device: c.device, match: c.match,
                note: `đang dự kiến ở ${c.from.code}${c.fromReady ? ' — điểm đó đã đủ, đang chờ treo' : ''}`,
                warn: c.fromReady,
              }))} />
          ) : (
            <p className="text-[12px] text-faint">
              Muốn mượn vật tư của điểm đo khác: Kinh Doanh bật <b>Cần gấp</b> ở form điểm đo này.
            </p>
          )}

          {plan.moves.length > 0 && (
            <div className="vl-alert vl-alert-light-warning text-[12px]">
              <b>Mượn</b> — gỡ khỏi điểm đo cũ và ghi sổ mượn; điểm đo đó sẽ quay về "Thiếu vật tư" và được ưu tiên bù:{' '}
              {plan.moves.map(m => `${m.serial} (từ ${m.fromCode})`).join('; ')}.
            </div>
          )}
          {plan.blocks.length > 0 && (
            <div className="vl-alert vl-alert-light-danger text-[12px]">
              <b>Chưa phân bổ được:</b> {plan.blocks.join('. ')}.
            </div>
          )}
        </>)}
      </FormModal>
    </div>
  );
}

function PickTable({ title, rows, picked, onToggle, empty, icon: Icon = PackageCheck }: {
  title: string;
  rows: { device: Device; match: 'yes' | 'unsure_shape'; note?: string; warn?: boolean }[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  empty: string;
  icon?: typeof PackageCheck;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
        <Icon className="h-4 w-4" /> {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[12px] italic text-faint">{empty}</p>
      ) : (
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-[var(--border)]">
          <table className="vl-table w-full text-sm">
            <tbody>
              {rows.map(r => (
                <tr key={r.device.id} className="cursor-pointer" onClick={() => onToggle(r.device.id)}>
                  <td className="w-8">
                    <input type="checkbox" checked={picked.has(r.device.id)} readOnly
                      aria-label={`Chọn ${r.device.serial}`} />
                  </td>
                  <td className="font-mono font-semibold">{r.device.serial}</td>
                  <td className="text-[12px] text-soft">
                    {r.match === 'unsure_shape' && (
                      <span className="mr-2 inline-flex items-center gap-1 text-[11px] text-faint">
                        <AlertTriangle className="h-3.5 w-3.5" /> chưa rõ hình dạng
                      </span>
                    )}
                    {r.note && <span className={r.warn ? 'text-bad' : ''}>{r.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
