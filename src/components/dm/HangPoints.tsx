/**
 * CHỜ TREO — Vận Hành khai ngày treo cho điểm đo đã đủ vật tư (bước B5 luồng
 * cấp vật tư, đợt 4, 26/10/2026, plan `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md`).
 *
 * Trước đây Nhóm Vận Hành không có màn danh mục nào nên không tự khai được
 * ngày treo — chỉ khối Kinh Doanh làm ở form điểm đo. Màn này chỉ làm đúng một
 * việc: ghi `date_on` cho các dòng DỰ KIẾN của điểm đo, bỏ giữ chỗ, rồi ghi lại
 * `dm_point.status` theo `derivePointStatus` (luật cũ, mốc là ngày treo công tơ).
 *
 * Nhận `scope` (nguyên tắc 17): 'doi' = chỉ KCN của tài khoản.
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle2, Wrench } from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/dashboard';
import { toast } from '../../lib/toast';
import {
  assets as assetRepo, devices as deviceRepo, isAbortError, loadCatalog, pbErrorMessage,
  points as pointRepo, type CatalogData,
} from '../../lib/dm/repo';
import { allocatedAssets, pointSupply } from '../../lib/dm/supply';
import { countAssets, derivePointStatus } from '../../lib/dm/pointStatus';
import { formatRatio } from '../../lib/dm/hsn';
import { inAreas, isHeadPoint, pointZoneId } from '../../lib/dm/pointScope';
import { dmy } from '../../lib/dm/lifecycle';
import { useScopeAreas, type Scope } from '../../lib/scope';
import { ASSET_LABEL, type Asset, type Point } from '../../lib/dm/types';

const today = () => new Date().toISOString().slice(0, 10);
const isPlan = (a: Asset) => !(a.date_on ?? '').slice(0, 10) && !(a.date_off ?? '').slice(0, 10);

export default function HangPoints({ scope = 'doi', onChanged }: {
  scope?: Scope;
  /** Báo cho khung ngoài nạp lại badge sau khi khai treo. */
  onChanged?: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const { areas } = useScopeAreas(scope);
  const [d, setD] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  /** Ngày treo đang chọn theo từng điểm đo — mặc định hôm nay. */
  const [dates, setDates] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try { setD(await loadCatalog()); } catch (e) {
      if (!isAbortError(e)) toast.error('Không đọc được dữ liệu', pbErrorMessage(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const zoneName = (p: Point) => {
    const z = d ? pointZoneId(p, d.stations, d.lines) : undefined;
    return d?.zones.find(x => x.id === z)?.name ?? '';
  };
  const rows = useMemo(() => (d ? d.points
    .filter(p => inAreas(zoneName(p), areas))
    .filter(p => pointSupply(p, d).state === 'du_cho_treo')
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || (a.code ?? '').localeCompare(b.code ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    : []), [d, areas]);

  const hang = async (p: Point) => {
    if (!d) return;
    const date = dates[p.id] || today();
    const plan = allocatedAssets(d.assets, p.id).filter(isPlan);
    const ok = await confirm({
      title: 'Khai treo',
      message: `Ghi ngày treo ${dmy(date)} cho ${plan.length} thiết bị của ${p.code}? Điểm đo sẽ thôi là "dự kiến".`,
    });
    if (!ok) return;
    setSaving(p.id);
    let n = 0;
    try {
      // Tuần tự — lỗi giữa chừng thì biết đã ghi tới đâu.
      for (const a of plan) {
        await assetRepo.update(a.id, { date_on: date, status: 'dang_treo', active: true });
        if (a.device) await deviceRepo.update(a.device, { hold_point: '' });
        n++;
      }
      // Trạng thái điểm đo theo đúng luật form điểm đo; chưa có hóa đơn ⇒ "chưa vận hành".
      const after = allocatedAssets(d.assets, p.id).map(a => (isPlan(a) ? { ...a, date_on: date, active: true } : a));
      const status = derivePointStatus({
        ...countAssets(after.map(a => ({ ...a, active: a.active !== false && !(a.date_off ?? '').slice(0, 10) }))),
        hasRecentInvoice: false,
        isHead: isHeadPoint(p),
      });
      await pointRepo.update(p.id, { status });
      toast.success('Đã khai treo', `${p.code} · ${n} thiết bị.`);
      onChanged?.();
      await load();
    } catch (e) {
      toast.error(`Dừng sau ${n} thiết bị`, pbErrorMessage(e));
      await load();
    } finally { setSaving(null); }
  };

  return (
    <div className="space-y-6">
      {dialog}
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">Điểm đo chờ treo</h2>
          <p className="mt-1 text-sm text-soft">
            Đã đủ vật tư theo nhu cầu — lắp xong thì khai ngày treo để điểm đo đi vào vận hành
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
            hint="Điểm đo hiện ở đây khi Nhóm Vật Tư đã phân bổ đủ vật tư." />
        </div>
      )}

      {rows.map(p => {
        const plan = allocatedAssets(d!.assets, p.id).filter(isPlan);
        return (
          <div key={p.id} className="vl-card space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className="h-4 w-4 text-faint" />
              <span className="font-mono text-[15px] font-bold text-ink">{p.code}</span>
              <span className="text-[12px] text-soft">{zoneName(p)}</span>
              {p.urgent && (
                <span className="vl-badge-danger">Cần gấp{p.needed_by ? ` · ${dmy(p.needed_by)}` : ''}</span>
              )}
              {p.hsn != null && <span className="vl-badge-info">HSN {p.hsn}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="vl-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Thiết bị</th>
                    <th className="text-left">Số No</th>
                    <th className="text-left">Tỷ số</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map(a => (
                    <tr key={a.id}>
                      <td>{ASSET_LABEL[a.type]}</td>
                      <td className="font-mono font-semibold">{a.serial}</td>
                      <td className="font-mono">{formatRatio(a.ratio_primary, a.ratio_secondary) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[190px]">
                <DatePicker label="Ngày treo" value={dates[p.id] || today()}
                  onChange={v => setDates(s => ({ ...s, [p.id]: v }))} />
              </div>
              <button className="vl-btn vl-btn-success flex items-center gap-2"
                disabled={saving === p.id || !plan.length} onClick={() => void hang(p)}>
                <CheckCircle2 className="h-4 w-4" />
                {saving === p.id ? 'Đang ghi…' : `Khai treo ${plan.length} thiết bị`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
