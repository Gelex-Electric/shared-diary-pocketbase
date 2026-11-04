/**
 * TREO THÁO — phần thứ hai của điểm đo (điểm đo hai phần, user chốt 27/10/2026,
 * plan `plans/2026-10-27-diem-do-hai-phan-nhu-cau-treo-thao.md`). Kinh Doanh và
 * Vận Hành ghi vật tư THẬT SỰ treo ở hiện trường cho các điểm đo còn dòng nhu cầu
 * chưa treo:
 *   - mỗi dòng nhu cầu: tích "treo" + số No thực tế (mặc định = số No Vật Tư gắn;
 *     đổi sang thiết bị rảnh cùng loại nếu ngoài hiện trường treo cái khác);
 *   - thêm dòng treo ngoài nhu cầu;
 *   - một ngày treo cho cả lượt.
 * Lưu xong chạy ĐỐI CHIẾU (`runReconcile`): dòng nhu cầu bị thay ⇒ về kho; còn thiếu
 * ⇒ báo "cần treo bổ sung" (Vật Tư thấy ở Nhu cầu & phân bổ). Rồi ghi lại
 * `dm_point.status` theo `derivePointStatus` (mốc là ngày treo công tơ).
 *
 * Treo nhầm chỗ so với dự kiến (user báo 04/11/2026, YONGDING X1-T3.1 ↔ T3.2): ô số No thực tế chọn được
 * cả thiết bị đang DỰ KIẾN ở điểm đo khác. Cùng loại (TI/TU cùng tỷ số) ⇒ HOÁN ĐỔI: thiết bị đề xuất của dòng
 * chuyển sang làm dự kiến của điểm đo kia. Không có gì để đổi ⇒ MƯỢN, ghi sổ như `runAttach`.
 *
 * Nhận `scope` (nguyên tắc 17): 'doi' = chỉ KCN của tài khoản (Vận Hành),
 * 'vanphong' = mọi KCN (Kinh Doanh).
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle2, Wrench, Plus, Search, Trash2 } from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/dashboard';
import { toast } from '../../lib/toast';
import { isAbortError, loadCatalog, pbErrorMessage, points as pointRepo, assets as assetRepo, devices as deviceRepo, type CatalogData } from '../../lib/dm/repo';
import { SUPPLY_STATE_LABEL, allocatedAssets, pointSupply, spareDevices } from '../../lib/dm/supply';
import { countAssets, derivePointStatus } from '../../lib/dm/pointStatus';
import { formatRatio } from '../../lib/dm/hsn';
import { inAreas, isHeadPoint, pointZoneId } from '../../lib/dm/pointScope';
import { dmy } from '../../lib/dm/lifecycle';
import { planAttach } from '../../lib/dm/attach';
import { runAttach } from '../../lib/dm/attachRun';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import { runReconcile } from '../../lib/dm/reconcileRun';
import { useScopeAreas, type Scope } from '../../lib/scope';
import { ASSET_LABEL, type Asset, type AssetType, type Device, type Point } from '../../lib/dm/types';

const today = () => new Date().toISOString().slice(0, 10);
const ymd = (v?: string) => (v ?? '').slice(0, 10);
const isPlan = (a: Asset) => !ymd(a.date_on) && !ymd(a.date_off);

/** Một dòng treo đang khai: dòng nhu cầu (có `asset`) hoặc dòng thêm ngoài nhu cầu. */
interface HangRow { key: string; asset?: Asset; type: AssetType | ''; deviceId: string; on: boolean }
let seq = 0;

export default function HangPoints({ scope = 'doi', onChanged }: {
  scope?: Scope;
  /** Báo cho khung ngoài nạp lại badge sau khi ghi treo. */
  onChanged?: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const { areas } = useScopeAreas(scope);
  const [d, setD] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  /** Ngày treo theo từng điểm đo — mặc định hôm nay. */
  const [dates, setDates] = useState<Record<string, string>>({});
  /** Bảng treo đang khai theo điểm đo; chưa sửa thì dựng mặc định từ dòng nhu cầu. */
  const [edits, setEdits] = useState<Record<string, HangRow[]>>({});

  const [search, setSearch] = useState('');
  const [zone, setZone] = useState('');

  const load = async () => {
    setLoading(true);
    try { setD(await loadCatalog()); setEdits({}); } catch (e) {
      if (!isAbortError(e)) toast.error('Không đọc được dữ liệu', pbErrorMessage(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const devById = useMemo(() => new Map((d?.devices ?? []).map(x => [x.id, x])), [d]);
  const devOfAsset = (a: Asset): Device | undefined =>
    (a.device && devById.get(a.device)) || d?.devices.find(x => x.serial.trim() === (a.serial ?? '').trim());
  const spare = useMemo(() => (d ? spareDevices(d) : []), [d]);

  const zoneName = (p: Point) => {
    const z = d ? pointZoneId(p, d.stations, d.lines) : undefined;
    return d?.zones.find(x => x.id === z)?.name ?? '';
  };
  /** Điểm đo trong phạm vi còn dòng nhu cầu chưa treo — đủ hay chưa đủ đều treo được phần đã có. */
  const rows = useMemo(() => (d ? d.points
    .filter(p => scope === 'vanphong' || inAreas(zoneName(p), areas))
    .filter(p => allocatedAssets(d.assets, p.id).some(isPlan))
    .map(p => ({ p, s: pointSupply(p, d) }))
    .sort((a, b) => Number(b.s.state === 'cho_treo') - Number(a.s.state === 'cho_treo')
      || (a.p.code ?? '').localeCompare(b.p.code ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    : []), [d, areas, scope]);

  const terms = useMemo(() => buildTerms(search), [search]);
  const planOf = (p: Point) => allocatedAssets(d!.assets, p.id).filter(isPlan);
  /** Tìm theo mã điểm đo, KCN, khách hàng, số No dự kiến. */
  const shown = rows.filter(({ p }) => (!zone || zoneName(p) === zone) && matchesTerms([
    p.code, p.note, zoneName(p),
    ...(() => { const c = d!.customers.find(x => x.id === p.customer); return [c?.mkh, c?.name]; })(),
    ...planOf(p).map(a => a.serial),
  ], terms));
  const zoneOpts = [
    { value: '', label: `Tất cả KCN (${rows.length})` },
    ...[...new Set(rows.map(r => zoneName(r.p)))].filter(Boolean).sort()
      .map(z => ({ value: z, label: `${z} (${rows.filter(r => zoneName(r.p) === z).length})` })),
  ];

  /** Thiết bị đang dự kiến ở điểm đo KHÁC trong phạm vi — hiện trường có thể treo nhầm chỗ so với dự kiến. */
  const plannedElsewhere = (p: Point, type: AssetType | '') => rows
    .filter(x => x.p.id !== p.id)
    .sort((a, b) => Number(b.p.station === p.station) - Number(a.p.station === p.station))
    .flatMap(x => planOf(x.p).filter(a => a.type === type).map(a => ({ from: x.p, dev: devOfAsset(a) })))
    .filter((x): x is { from: Point; dev: Device } => !!x.dev && !x.dev.liquidated_at);
  const fromPointOf = (p: Point, r: HangRow) => plannedElsewhere(p, r.type).find(x => x.dev.id === r.deviceId)?.from;

  const rowsOf = (p: Point): HangRow[] => edits[p.id] ?? allocatedAssets(d!.assets, p.id).filter(isPlan)
    .map(a => ({ key: a.id, asset: a, type: a.type, deviceId: devOfAsset(a)?.id ?? '', on: true }));
  const setRows = (p: Point, fn: (rs: HangRow[]) => HangRow[]) =>
    setEdits(e => ({ ...e, [p.id]: fn(rowsOf(p)) }));

  /** Tỷ số chỉ có nghĩa với TI/TU — công tơ, GP-03 trong kho hay mang "0/0". */
  const ratioOf = (x: Device) => ((x.type === 'TI' || x.type === 'TU') && x.ratio_primary
    ? ` · ${formatRatio(x.ratio_primary, x.ratio_secondary)}` : '');

  /** Số No chọn được cho một dòng: chính thiết bị nhu cầu của dòng + thiết bị rảnh cùng loại + dự kiến ở điểm đo khác. */
  const optsFor = (p: Point, r: HangRow, all: HangRow[]) => {
    const own = r.asset ? devOfAsset(r.asset) : undefined;
    const used = new Set(all.filter(x => x.key !== r.key).map(x => x.deviceId));
    const list = [...(own ? [own] : []), ...spare.filter(x => x.type === r.type && x.id !== own?.id)]
      .filter(x => !used.has(x.id));
    return [
      ...list.map(x => ({
        value: x.id,
        label: `${x.serial}${ratioOf(x)}${x.id === own?.id ? ' (đề xuất)' : ''}`,
      })),
      ...plannedElsewhere(p, r.type).filter(x => !used.has(x.dev.id)).map(x => ({
        value: x.dev.id,
        label: `${x.dev.serial}${ratioOf(x.dev)} (dự kiến của ${x.from.code})`,
      })),
    ];
  };

  const hang = async (p: Point) => {
    if (!d) return;
    const date = dates[p.id] || today();
    const rs = rowsOf(p).filter(r => r.on && r.deviceId);
    if (!rs.length) return toast.warning('Chưa có gì để treo', 'Tích ít nhất một dòng và chọn số No.');
    const keep = rs.filter(r => r.asset && devOfAsset(r.asset)?.id === r.deviceId);
    const fresh = rs.filter(r => !keep.includes(r)).map(r => devById.get(r.deviceId)!).filter(Boolean);
    // Đọc lại dữ liệu mới nhất: thiết bị của điểm đo khác có thể vừa bị người khác treo / gỡ.
    const cur = await loadCatalog();
    const plan = planAttach(fresh, p.id, cur);
    const blocked = plan.blocks.filter(b => fresh.some(x => b.startsWith(x.serial)));
    if (blocked.length) { toast.error('Chưa ghi được', `${blocked.join('. ')}. Bấm Nạp lại.`); return; }
    /** Hoán đổi: dòng đổi sang thiết bị dự kiến của điểm đo kia, cùng loại và cùng tỷ số ⇒ thiết bị đề xuất sang bên đó. */
    const swaps = rs.flatMap(r => {
      const own = r.asset ? devOfAsset(r.asset) : undefined;
      const dev = devById.get(r.deviceId);
      const move = plan.moves.find(m => m.device === r.deviceId);
      if (!own || !dev || !move || own.id === dev.id || own.type !== dev.type) return [];
      if ((own.type === 'TI' || own.type === 'TU')
        && (own.ratio_primary !== dev.ratio_primary || own.ratio_secondary !== dev.ratio_secondary)) return [];
      return [{ asset: r.asset!, own, move }];
    });
    const borrows = plan.moves.filter(m => !swaps.some(x => x.move === m));
    const ok = await confirm({
      title: 'Ghi treo',
      message: `Ghi ngày treo ${dmy(date)} cho ${rs.length} thiết bị của ${p.code}`
        + (fresh.length ? ` (${fresh.length} thiết bị khác nhu cầu)` : '') + '?'
        + swaps.map(x => ` Đổi chỗ: ${x.own.serial} chuyển thành dự kiến của ${x.move.fromCode}.`).join('')
        + borrows.map(m => ` Mượn: ${m.serial} từ ${m.fromCode}, điểm đó sẽ thiếu vật tư.`).join(''),
    });
    if (!ok) return;
    setSaving(p.id);
    let n = 0;
    try {
      // Tuần tự — lỗi giữa chừng thì biết đã ghi tới đâu.
      for (const r of keep) {
        await assetRepo.update(r.asset!.id, { date_on: date, status: 'dang_treo', active: true });
        const dev = devOfAsset(r.asset!);
        if (dev?.hold_point) await deviceRepo.update(dev.id, { hold_point: '' });
        n++;
      }
      // Hoán đổi: dòng dự kiến của thiết bị bên kia gỡ đi, dòng đề xuất ở đây chuyển sang điểm đo kia (vẫn chưa treo).
      for (const x of swaps) {
        await assetRepo.remove(x.move.assetId);
        await assetRepo.update(x.asset.id, { point: x.move.fromPoint });
        await deviceRepo.update(x.own.id, { hold_point: x.move.fromPoint });
      }
      // Treo thiết bị KHÁC nhu cầu / ngoài nhu cầu ⇒ tạo lần lắp có ngày treo; lấy của điểm đo khác mà không đổi được thì ghi sổ mượn.
      if (fresh.length) await runAttach(fresh, p.id, date, borrows, `Treo thực tế cho điểm đo ${p.code ?? ''}`.trim(), k => { n = keep.length + k; });

      // Đối chiếu tự động: nhu cầu bị thay về kho, còn thiếu thì nhắc treo bổ sung.
      const rc = await runReconcile(p.id);
      const fresh2 = await loadCatalog();
      const mine = allocatedAssets(fresh2.assets, p.id);
      const status = derivePointStatus({
        ...countAssets(mine.map(a => ({ ...a, active: a.active !== false && !ymd(a.date_off) }))),
        hasRecentInvoice: false,
        isHead: isHeadPoint(p),
      });
      await pointRepo.update(p.id, { status });
      const notes = [
        rc.release.length ? `trả kho ${rc.release.map(a => a.serial).join(', ')}` : '',
        rc.shortages.length ? `cần treo bổ sung ${rc.shortages.map(l => `${l.missing} × ${ASSET_LABEL[l.line.type]}`).join(', ')}` : '',
      ].filter(Boolean);
      toast.success('Đã ghi treo', `${p.code} · ${n} thiết bị${notes.length ? ` — ${notes.join('; ')}` : ''}.`);
      onChanged?.();
      setD(fresh2); setEdits({});
    } catch (e) {
      toast.error(`Dừng sau ${n} thiết bị`, pbErrorMessage(e));
      await load();
    } finally { setSaving(null); }
  };

  const TYPE_OPTS = (Object.keys(ASSET_LABEL) as AssetType[]).map(t => ({ value: t, label: ASSET_LABEL[t] }));

  return (
    <div className="space-y-6">
      {dialog}
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">Treo tháo — điểm đo chờ treo</h2>
          <p className="mt-1 text-sm text-soft">
            Ghi vật tư thật sự treo ở hiện trường. Treo khác nhu cầu thì đổi số No — nhu cầu bị thay tự về kho
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 md:w-auto">
          <div className="w-full sm:w-[220px]">
            <Select value={zone} onChange={setZone} options={zoneOpts} />
          </div>
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Tìm điểm đo, khách hàng, số No..."
              className="w-full rounded-lg border border-[var(--border)] bg-surface py-2 pl-10 pr-4
                text-sm text-dim focus:outline-none focus:ring-1 focus:ring-accent sm:w-[260px]" />
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Nạp lại
          </button>
        </div>
      </div>

      {!loading && shown.length === 0 && (
        <div className="vl-card p-5">
          <EmptyState icon={CheckCircle2} title={rows.length ? 'Không có điểm đo nào khớp tìm kiếm' : 'Không có điểm đo nào chờ treo'}
            hint={rows.length ? 'Đổi từ khoá hoặc KCN.' : 'Điểm đo hiện ở đây khi Nhóm Vật Tư đã gắn số No vào phần nhu cầu.'} />
        </div>
      )}

      {shown.map(({ p, s }) => {
        const rs = rowsOf(p);
        const nOn = rs.filter(r => r.on && r.deviceId).length;
        return (
          <div key={p.id} className="vl-card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className="h-4 w-4 text-faint" />
              <span className="font-mono text-[15px] font-bold text-ink">{p.code}</span>
              <span className="text-[12px] text-soft">{zoneName(p)}</span>
              <span className={s.state === 'cho_treo' ? 'vl-badge-primary' : 'vl-badge-warning'}>
                {SUPPLY_STATE_LABEL[s.state]}{s.missing ? ` · thiếu ${s.missing}` : ''}
              </span>
              {s.hung && <span className="vl-badge-info">Treo bổ sung</span>}
              {p.hsn != null && <span className="vl-badge-info">HSN {p.hsn}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="vl-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-10 text-center">Treo</th>
                    <th className="text-left">Thiết bị</th>
                    <th className="text-left" title="Số No Nhóm Vật Tư đã gắn dự kiến cho điểm đo">Số No đề xuất</th>
                    <th className="text-left">Số No treo thực tế</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rs.map(r => {
                    const own = r.asset ? devOfAsset(r.asset) : undefined;
                    const changed = !!own && r.deviceId !== own.id;
                    return (
                      <tr key={r.key} className={r.on ? '' : 'opacity-60'}>
                        <td className="text-center">
                          <input type="checkbox" checked={r.on} aria-label="Treo dòng này"
                            onChange={() => setRows(p, xs => xs.map(x => (x.key === r.key ? { ...x, on: !x.on } : x)))} />
                        </td>
                        <td>
                          {r.asset ? ASSET_LABEL[r.type as AssetType] : (
                            <Select value={r.type} variant="bare" options={TYPE_OPTS} placeholder="Chọn loại"
                              onChange={v => setRows(p, xs => xs.map(x => (x.key === r.key ? { ...x, type: v as AssetType, deviceId: '' } : x)))} />
                          )}
                          {!r.asset && <span className="ml-1 text-[11px] text-faint">ngoài nhu cầu</span>}
                        </td>
                        {/* Số No ĐỀ XUẤT = thiết bị Vật Tư đã gắn dự kiến; dòng treo ngoài nhu cầu thì không có. */}
                        <td className="font-mono font-semibold text-soft">
                          {own ? `${own.serial}${ratioOf(own)}` : <span className="font-sans font-normal text-faint">—</span>}
                        </td>
                        <td className="min-w-[240px]">
                          <Select value={r.deviceId} variant="bare" searchable options={optsFor(p, r, rs)}
                            placeholder="Chọn số No"
                            onChange={v => setRows(p, xs => xs.map(x => (x.key === r.key ? { ...x, deviceId: v } : x)))} />
                          {changed && (
                            <span className="text-[11px] text-warn">
                              khác đề xuất — {own!.serial} {fromPointOf(p, r) ? `đổi sang ${fromPointOf(p, r)!.code} nếu cùng quy cách` : 'sẽ về kho'}
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          {!r.asset && (
                            <button type="button" title="Bỏ dòng" className="text-faint hover:text-bad"
                              onClick={() => setRows(p, xs => xs.filter(x => x.key !== r.key))}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <button type="button" className="vl-btn vl-btn-sm vl-btn-secondary flex items-center gap-1.5"
                onClick={() => setRows(p, xs => [...xs, { key: `x${++seq}`, type: '', deviceId: '', on: true }])}>
                <Plus className="h-4 w-4" /> Treo thêm ngoài nhu cầu
              </button>
              <div className="w-[190px]">
                <DatePicker label="Ngày treo" value={dates[p.id] || today()}
                  onChange={v => setDates(x => ({ ...x, [p.id]: v }))} />
              </div>
              <button className="vl-btn vl-btn-success flex items-center gap-2"
                disabled={saving === p.id || !nOn} onClick={() => void hang(p)}>
                <CheckCircle2 className="h-4 w-4" />
                {saving === p.id ? 'Đang ghi…' : `Ghi treo ${nOn} thiết bị`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
