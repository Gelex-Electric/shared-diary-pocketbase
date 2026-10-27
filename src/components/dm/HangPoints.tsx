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
 * Nhận `scope` (nguyên tắc 17): 'doi' = chỉ KCN của tài khoản (Vận Hành),
 * 'vanphong' = mọi KCN (Kinh Doanh).
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle2, Wrench, Plus, Trash2 } from 'lucide-react';
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
import { runAttach } from '../../lib/dm/attachRun';
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

  const rowsOf = (p: Point): HangRow[] => edits[p.id] ?? allocatedAssets(d!.assets, p.id).filter(isPlan)
    .map(a => ({ key: a.id, asset: a, type: a.type, deviceId: devOfAsset(a)?.id ?? '', on: true }));
  const setRows = (p: Point, fn: (rs: HangRow[]) => HangRow[]) =>
    setEdits(e => ({ ...e, [p.id]: fn(rowsOf(p)) }));

  /** Số No chọn được cho một dòng: thiết bị rảnh cùng loại + chính thiết bị nhu cầu của dòng. */
  const optsFor = (r: HangRow, all: HangRow[]) => {
    const own = r.asset ? devOfAsset(r.asset) : undefined;
    const used = new Set(all.filter(x => x.key !== r.key).map(x => x.deviceId));
    const list = [...(own ? [own] : []), ...spare.filter(x => x.type === r.type && x.id !== own?.id)]
      .filter(x => !used.has(x.id));
    // Tỷ số chỉ có nghĩa với TI/TU — công tơ, GP-03 trong kho hay mang "0/0".
    const ratioOf = (x: Device) => ((x.type === 'TI' || x.type === 'TU') && x.ratio_primary
      ? ` · ${formatRatio(x.ratio_primary, x.ratio_secondary)}` : '');
    return list.map(x => ({
      value: x.id,
      label: `${x.serial}${ratioOf(x)}${x.id === own?.id ? ' (nhu cầu)' : ''}`,
    }));
  };

  const hang = async (p: Point) => {
    if (!d) return;
    const date = dates[p.id] || today();
    const rs = rowsOf(p).filter(r => r.on && r.deviceId);
    if (!rs.length) return toast.warning('Chưa có gì để treo', 'Tích ít nhất một dòng và chọn số No.');
    const keep = rs.filter(r => r.asset && devOfAsset(r.asset)?.id === r.deviceId);
    const fresh = rs.filter(r => !keep.includes(r)).map(r => devById.get(r.deviceId)!).filter(Boolean);
    const ok = await confirm({
      title: 'Ghi treo',
      message: `Ghi ngày treo ${dmy(date)} cho ${rs.length} thiết bị của ${p.code}`
        + (fresh.length ? ` (${fresh.length} thiết bị khác nhu cầu — nhu cầu bị thay sẽ tự về kho)` : '') + '?',
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
      // Treo thiết bị KHÁC nhu cầu / ngoài nhu cầu: thiết bị rảnh ⇒ tạo lần lắp có ngày treo.
      if (fresh.length) await runAttach(fresh, p.id, date, [], '', k => { n = keep.length + k; });

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
        <button onClick={() => void load()} disabled={loading}
          className="vl-btn vl-btn-secondary flex items-center gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Nạp lại
        </button>
      </div>

      {!loading && rows.length === 0 && (
        <div className="vl-card p-5">
          <EmptyState icon={CheckCircle2} title="Không có điểm đo nào chờ treo"
            hint="Điểm đo hiện ở đây khi Nhóm Vật Tư đã gắn số No vào phần nhu cầu." />
        </div>
      )}

      {rows.map(({ p, s }) => {
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
                        <td className="min-w-[240px]">
                          <Select value={r.deviceId} variant="bare" searchable options={optsFor(r, rs)}
                            placeholder="Chọn số No"
                            onChange={v => setRows(p, xs => xs.map(x => (x.key === r.key ? { ...x, deviceId: v } : x)))} />
                          {changed && (
                            <span className="text-[11px] text-warn">
                              khác nhu cầu ({own!.serial}) — {own!.serial} sẽ về kho
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
