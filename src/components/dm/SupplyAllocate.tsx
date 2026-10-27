/**
 * GẮN VẬT TƯ DỰ KIẾN — màn của Nhóm Vật Tư (luồng cấp vật tư; điểm đo HAI PHẦN từ
 * 27/10/2026, plan `plans/2026-10-27-diem-do-hai-phan-nhu-cau-treo-thao.md`).
 *
 * Phân việc (user chốt lại 27/10/2026): Kinh Doanh KHAI quy cách cần ở form điểm
 * đo; Vật Tư chỉ GẮN số No dự kiến từ kho vào quy cách đó; KD + VH ghi treo tháo.
 * Bảng mỗi điểm đo tách "Đang treo" (treo tháo) với "Đã gắn" (dự kiến chưa treo).
 * Điểm đo đã treo mà còn thiếu ⇒ "Treo bổ sung". Mượn vật tư nhu cầu chưa treo
 * của điểm đo khác: điểm nào cũng mượn được (bỏ "Cần gấp" 27/10/2026), có ghi sổ.
 *
 * Gắn số No = tạo dòng `dm_asset` CHƯA ngày treo + giữ chỗ — cùng luật và cùng hàm
 * ghi với "Gắn vào điểm đo" ở Kho vật tư (`lib/dm/attach.ts`, `attachRun.ts`).
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, PackageCheck, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { Select } from '../ui/Select';
import { EmptyState } from '../ui/dashboard';
import { toast } from '../../lib/toast';
import { FormModal } from './entryUi';
import {
  borrows as borrowRepo, isAbortError, loadCatalog, pbErrorMessage, type CatalogData,
} from '../../lib/dm/repo';
import {
  SUPPLY_STATE_LABEL, allocCandidates, borrowCandidates, borrowsToSettle, openBorrowsByPoint,
  pointSupply, type BorrowCandidate, type Candidate, type PointSupply, type SupplyState,
} from '../../lib/dm/supply';
import { planAttach } from '../../lib/dm/attach';
import { runAttach } from '../../lib/dm/attachRun';
import { formatRatio } from '../../lib/dm/hsn';
import { pointZoneId } from '../../lib/dm/pointScope';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import { ASSET_LABEL, CONNECTION_LABEL, SHAPE_LABEL, type Device, type NeedLine, type Point } from '../../lib/dm/types';

const today = () => new Date().toISOString().slice(0, 10);

/** "3 × TI (biến dòng) 1000/5 · Vuông", "1 × Công tơ · Trực tiếp" */
export function needText(n: NeedLine, withQty = true): string {
  const ratio = formatRatio(n.ratio_primary, n.ratio_secondary);
  return `${withQty ? `${n.qty} × ` : ''}${ASSET_LABEL[n.type]}${ratio ? ` ${ratio}` : ''}`
    + `${n.type === 'TI' && n.shape ? ` · ${SHAPE_LABEL[n.shape]}` : ''}`
    + `${n.type === 'CONGTO' && n.meter_kind ? ` · ${CONNECTION_LABEL[n.meter_kind]}` : ''}`;
}

interface Row { p: Point; s: PointSupply; zone?: string; borrowed: number }

type View = 'can' | 'cho_treo' | 'all';
const VIEW_STATES: Record<View, SupplyState[]> = {
  can: ['thieu'],
  cho_treo: ['cho_treo'],
  all: ['thieu', 'cho_treo', 'du'],
};
const STATE_CLS: Partial<Record<SupplyState, string>> = {
  chua_khai: 'vl-badge-danger', thieu: 'vl-badge-warning',
  cho_treo: 'vl-badge-primary', du: 'vl-badge-success',
};
const isHungRow = (a: { date_on?: string; date_off?: string }) =>
  !!(a.date_on ?? '').slice(0, 10) && !(a.date_off ?? '').slice(0, 10);

export default function SupplyAllocate() {
  const [d, setD] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zone, setZone] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('can');

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

  /** Điểm đo theo bộ lọc trạng thái. Bị mượn lên đầu (ưu tiên bù), rồi theo mã. */
  const rows = useMemo<Row[]>(() => {
    if (!d) return [];
    return d.points
      .map(p => ({ p, s: pointSupply(p, d), zone: pointZoneId(p, d.stations, d.lines), borrowed: borrowed.get(p.id) ?? 0 }))
      .filter(r => VIEW_STATES[view].includes(r.s.state))
      .sort((a, b) =>
        Number(b.borrowed > 0) - Number(a.borrowed > 0)
        || (a.p.code ?? '').localeCompare(b.p.code ?? ''));
  }, [d, borrowed, view]);
  const viewOpts = [
    { value: 'can', label: 'Cần gắn (thiếu vật tư)' },
    { value: 'cho_treo', label: 'Đã gắn đủ — chờ treo' },
    { value: 'all', label: 'Tất cả điểm đo có nhu cầu' },
  ];


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
    () => (target && d ? borrowCandidates(target.p.id, target.line, d.points, d) : []), [target, d]);

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
        `Mượn cho điểm đo ${target.p.code ?? ''}`.trim(), k => { n = k; });
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
          <h2 className="text-2xl font-bold text-ink">Gắn vật tư dự kiến</h2>
          <p className="mt-1 text-sm text-soft">
            Gắn số No từ kho vào nhu cầu Kinh Doanh đã khai — điểm đo bị mượn xếp trước
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 md:w-auto">
          <div className="w-full sm:w-[280px]">
            <Select value={view} onChange={v => setView(v as View)} options={viewOpts} />
          </div>
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
        <div className="vl-card p-5">
          <EmptyState icon={PackageCheck} title="Không có điểm đo nào ở mục này"
            hint="Đổi bộ lọc trạng thái phía trên để xem điểm đo khác." />
        </div>
      )}

      {shown.map(({ p, s, borrowed: nBorrowed }) => (
        <div key={p.id} className="vl-card space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[15px] font-bold text-ink">{p.code}</span>
            <span className={STATE_CLS[s.state] ?? 'vl-badge-info'}>
              {SUPPLY_STATE_LABEL[s.state]}{s.missing ? ` · thiếu ${s.missing}` : ''}
            </span>
            {s.hung && s.missing > 0 && <span className="vl-badge-warning">Treo bổ sung</span>}
            {nBorrowed > 0 && <span className="vl-badge-primary">Bị mượn {nBorrowed}</span>}
          </div>
          {s.lines.length > 0 && <div className="overflow-x-auto">
            <table className="vl-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Quy cách</th>
                  <th className="text-center">Cần</th>
                  <th className="text-left" title="Phần treo tháo — thật sự đang ở điểm đo">Đang treo</th>
                  <th className="text-left" title="Phần nhu cầu — Vật Tư đã gắn dự kiến, chưa treo">Đã gắn dự kiến</th>
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
                        <span className="ml-2 text-[11px] text-faint">({l.unsureShape} chưa rõ kiểu)</span>
                      )}
                    </td>
                    <td className="text-center">{l.line.qty}</td>
                    <td><SerialList rows={l.have.filter(isHungRow)} /></td>
                    <td><SerialList rows={l.have.filter(a => !isHungRow(a))} /></td>
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
          </div>}
        </div>
      ))}

      <FormModal open={!!target} wide onClose={() => setTarget(null)} onSubmit={() => void save()} saving={saving}
        title={target ? `Phân bổ ${needText(target.line, false)} cho ${target.p.code}` : ''}
        submitLabel={pickedDevices.length ? `Phân bổ ${pickedDevices.length} thiết bị` : 'Chưa chọn thiết bị'}>
        {target && (<>
          <p className="text-sm text-soft">
            Còn thiếu <b className="text-ink">{target.missing}</b>. Đã chọn <b className="text-ink">{pickedDevices.length}</b>
            {over > 0 && <span className="text-bad"> — thừa {over} so với số thiếu</span>}.
            Thiết bị được gắn vào phần <b>nhu cầu</b> (chưa ngày treo) — Kinh Doanh / Vận Hành khai ngày treo khi lắp.
          </p>

          <PickTable title={`Trong kho (${fromStock.length})`} picked={picked} onToggle={toggle}
            empty="Kho không còn thiết bị rảnh khớp quy cách này — nhập thêm ở Kho vật tư."
            rows={fromStock.map(c => ({ device: c.device, match: c.match }))} />

          <PickTable title={`Mượn từ điểm đo khác (${fromBorrow.length})`} picked={picked} onToggle={toggle}
            icon={ArrowRightLeft}
            empty="Không có vật tư nhu cầu chưa treo nào ở điểm đo khác khớp quy cách này."
            rows={fromBorrow.map(c => ({
              device: c.device, match: c.match,
              note: `đang gắn cho ${c.from.code}${c.fromReady ? ' — điểm đó đã đủ, đang chờ treo' : ''}`,
              warn: c.fromReady,
            }))} />

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

/** Danh sách số No của một ô (đang treo / đã gắn dự kiến) — trống thì "—". */
function SerialList({ rows }: { rows: { id: string; serial: string }[] }) {
  if (!rows.length) return <span className="text-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map(a => (
        <span key={a.id} className="rounded-md border border-[var(--border)] bg-subtle px-1.5 py-0.5 font-mono text-[12px] font-semibold text-ink">
          {a.serial}
        </span>
      ))}
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
                        <AlertTriangle className="h-3.5 w-3.5" /> {r.device.type === 'CONGTO' ? 'chưa rõ loại công tơ' : 'chưa rõ hình dạng'}
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
