/**
 * Tab "Đầu nguồn" của trang Đồ thị điện áp & công suất (plan 2026-09-24-diem-do-dau-nguon, T9).
 *
 * Mỗi điểm đo ĐẦU NGUỒN (role `dau_nguon` trong Danh mục) đo TỔNG một lộ. So nó với
 * tổng các điểm đo chính cùng lộ theo từng ngày:
 *   - sản lượng đầu nguồn vs tổng điểm đo ⇒ TỔN THẤT LƯỚI (trung thế + MBA);
 *   - Pmax đầu nguồn vs Pmax lộ (đỉnh trùng thời điểm).
 *
 * MỘT NGUỒN: `/head_balance_daily.csv` (bước 4c của pipeline, lưu vĩnh viễn) — tab không
 * tự tính gì, để số trên màn hình đúng bằng số mà cảnh báo `daunguon` dùng.
 *
 * Giao diện dựng lại từ LinePmaxTab (StatTile, Select, bảng) + ComposedChart cột + đường
 * như màn Tổn thất — không có kiểu vẽ mới.
 */
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Line, Legend,
} from 'recharts';
import { Zap, Percent, Gauge, HelpCircle, CheckCircle2, Info } from 'lucide-react';
import { useHeadBalance } from '../lib/headBalance';
import type { HeadBalanceRow } from '../lib/headBalance';
import { Select } from './ui/Select';
import { MonthPicker } from './ui/DateTimePickers';
import { StatTile, EmptyState, CHART } from './ui/dashboard';

const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtDay = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
const COLOR_HEAD = CHART.accent;
const COLOR_SUM = CHART.td;
const COLOR_PCT = CHART.cd;

/** Ngày đủ số: đầu nguồn ≥ 47 mốc (47 = thiếu file hôm sau) và đủ mọi điểm đo — cùng luật cảnh báo. */
const isFull = (r: HeadBalanceRow) => r.headSlots >= 47 && r.covered === r.total;

function DayTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r: HeadBalanceRow = payload[0].payload;
  return (
    <div className="vl-chart-tooltip">
      <div className="vl-chart-tooltip-title">Ngày {fmtDay(r.date)}</div>
      <div className="vl-chart-tooltip-group">
        <div className="vl-chart-tooltip-row"><span className="vl-lbl">Đầu nguồn</span><span className="vl-val">{fmt(r.eHead)} kWh</span></div>
        <div className="vl-chart-tooltip-row"><span className="vl-lbl">Tổng điểm đo</span><span className="vl-val">{fmt(r.eSum)} kWh</span></div>
        <div className="vl-chart-tooltip-row"><span className="vl-lbl">Tổn thất</span><span className="vl-val">{fmt(r.loss)} kWh · {fmt(r.lossPct, 2)} %</span></div>
        <div className="vl-chart-tooltip-row"><span className="vl-lbl">Pmax lộ / đầu nguồn</span><span className="vl-val">{fmt(r.pmaxRatio, 1)} %</span></div>
        <div className="vl-chart-tooltip-row"><span className="vl-lbl">Điểm đo đủ số</span><span className="vl-val">{r.covered}/{r.total}{isFull(r) ? '' : ' ⚠'}</span></div>
      </div>
    </div>
  );
}

interface Props {
  /**
   * KCN được xem — cùng luật với các tab khác của trang (bộ chọn KCN của khối Văn
   * phòng, hoặc KCN của tài khoản). `null` = mọi KCN.
   */
  allowedZones: Set<string> | null;
}

const normArea = (s: string) => (s || '').normalize('NFC').trim();

export default function HeadBalanceTab({ allowedZones }: Props) {
  const { rows: allRows, loading, error } = useHeadBalance();
  /* Lọc theo KCN trước mọi thứ khác: danh sách điểm đầu nguồn, tháng, số liệu đều theo KCN. */
  const rows = useMemo(
    () => (allowedZones ? allRows.filter(r => allowedZones.has(normArea(r.zone))) : allRows),
    [allRows, allowedZones]);

  const heads = useMemo(() => [...new Set(rows.map(r => r.head))].sort(), [rows]);
  const [pickedHead, setPickedHead] = useState('');
  const head = pickedHead || heads[0] || '';

  const months = useMemo(
    () => [...new Set(rows.filter(r => r.head === head).map(r => r.date.slice(0, 7)))].sort(),
    [rows, head]);
  const [pickedMonth, setPickedMonth] = useState('');
  const month = pickedMonth || months[months.length - 1] || '';

  const days = useMemo(
    () => rows.filter(r => r.head === head && r.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)),
    [rows, head, month]);
  const line = days[0]?.line ?? rows.find(r => r.head === head)?.line ?? '';

  /* Tổng tháng CHỈ trên ngày đủ số — ngày thiếu làm phồng tổn thất vì thiếu, không phải vì lưới. */
  const full = days.filter(isFull);
  const sumHead = full.reduce((t, r) => t + r.eHead, 0);
  const sumLoss = full.reduce((t, r) => t + r.loss, 0);
  const monthPct = sumHead > 0 ? (sumLoss / sumHead) * 100 : null;
  const peak = days.reduce<HeadBalanceRow | null>((a, b) => ((b.pmaxHead ?? -1) > (a?.pmaxHead ?? -1) ? b : a), null);
  const ratios = full.map(r => r.pmaxRatio).filter((x): x is number => x != null);

  if (error) {
    return <div className="vl-alert vl-alert-light-danger">Không đọc được số liệu đối soát đầu nguồn: {error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* ---- Đầu trang + bộ chọn ---- */}
      <div className="vl-card flex flex-col justify-between gap-4 p-5 md:flex-row md:items-end">
        <div>
          <h2 className="text-lg font-bold text-ink">Đối soát điểm đo đầu nguồn</h2>
          <p className="mt-1 max-w-3xl text-sm text-soft">
            Điểm đo đầu nguồn đo <b>tổng cả lộ</b>. Lấy sản lượng của nó trừ tổng các điểm đo
            chính cùng lộ ra <b>tổn thất lưới</b> (đường dây trung thế + máy biến áp, vì điểm đo
            khách hàng đặt phía hạ thế). Số tính từ chỉ số 30 phút, cùng nguồn với cảnh báo.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-3">
          {heads.length > 1 && (
            <Select value={head} onChange={v => { setPickedHead(v); setPickedMonth(''); }}
              options={heads.map(h => ({ value: h, label: h }))}
              label="Điểm đầu nguồn" className="w-[220px]" />
          )}
          <MonthPicker value={month} onChange={setPickedMonth} label="Tháng" usePortal className="w-[180px]" />
        </div>
      </div>

      {loading ? (
        <div className="vl-card flex items-center justify-center py-20 text-faint">Đang tải…</div>
      ) : !head ? (
        <EmptyState icon={HelpCircle} title={allowedZones ? 'KCN này chưa có điểm đo đầu nguồn' : 'Chưa có điểm đo đầu nguồn nào'}
          hint="Khai điểm đo loại “Đầu nguồn” trong Danh mục (gắn vào lộ), pipeline đêm sẽ tự đối soát." />
      ) : days.length === 0 ? (
        <EmptyState icon={HelpCircle} title="Tháng này chưa có số đối soát"
          hint="Số bắt đầu từ ngày công tơ đầu nguồn có trong chỉ số 30 phút (30/08/2026)." />
      ) : (
        <>
          {/* ---- Thẻ tổng quan ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sản lượng đầu nguồn" value={fmt(sumHead)} unit="kWh" icon={Zap}
              sub={`${head} · lộ ${line} · ${full.length} ngày đủ số`} />
            <StatTile label="Tổn thất lưới tháng" value={fmt(monthPct, 2)} unit="%" icon={Percent}
              sub={`${fmt(sumLoss)} kWh · chỉ tính ngày đủ số`} />
            <StatTile label="Pmax đầu nguồn" value={fmt(peak?.pmaxHead)} unit="kW" icon={Gauge}
              sub={peak ? `${fmtDay(peak.date)} lúc ${peak.atHead} · Pmax lộ ${fmt(peak.pmaxLine)} kW` : undefined} />
            <StatTile label="Pmax lộ / đầu nguồn"
              value={!ratios.length ? '—' : Math.min(...ratios) === Math.max(...ratios)
                ? fmt(ratios[0], 1) : `${fmt(Math.min(...ratios), 1)}–${fmt(Math.max(...ratios), 1)}`} unit="%"
              icon={CheckCircle2} tone={days.length > full.length ? 'warn' : 'accent'}
              sub={days.length > full.length ? `${days.length - full.length} ngày thiếu số` : 'mọi ngày đủ số'} />
          </div>

          {/* ---- Biểu đồ ---- */}
          <div className="vl-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-bold text-ink">Đầu nguồn và tổng điểm đo theo ngày</h3>
              <span className="text-[11px] text-faint">Cột: kWh · Đường: tổn thất %</span>
            </div>
            <ResponsiveContainer width="100%" height={330}>
              <ComposedChart data={days.map(r => ({
                ...r, day: fmtDay(r.date),
                /* Đầu nguồn thiếu mốc ⇒ tổn thất là số rác (30/08: −57,8 %) — không vẽ, không thì
                   trục % kéo xuống −60 % và mọi ngày khác dẹt thành một đường thẳng. */
                lossPct: r.headSlots >= 47 ? r.lossPct : null,
              }))} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="kwh" tick={{ fontSize: 11 }} width={62}
                  tickFormatter={(v: number) => fmt(v)} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} width={46}
                  tickFormatter={(v: number) => `${fmt(v, 1)}%`} />
                <Tooltip content={<DayTooltip />} cursor={{ fill: 'var(--accent-soft)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="kwh" dataKey="eHead" name="Đầu nguồn" fill={COLOR_HEAD} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar yAxisId="kwh" dataKey="eSum" name="Tổng điểm đo" fill={COLOR_SUM} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="pct" type="monotone" dataKey="lossPct" name="Tổn thất %" stroke={COLOR_PCT}
                  strokeWidth={2.4} dot={{ r: 2.5 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ---- Bảng ngày ---- */}
          <div className="vl-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-subtle text-faint">
                    <th className="px-4 py-2.5 text-left font-bold">Ngày</th>
                    <th className="px-4 py-2.5 text-right font-bold">Đầu nguồn (kWh)</th>
                    <th className="px-4 py-2.5 text-right font-bold">Tổng điểm đo (kWh)</th>
                    <th className="px-4 py-2.5 text-right font-bold">Tổn thất (kWh)</th>
                    <th className="px-4 py-2.5 text-right font-bold">Tổn thất (%)</th>
                    <th className="px-4 py-2.5 text-right font-bold">Pmax đầu nguồn</th>
                    <th className="px-4 py-2.5 text-right font-bold">Pmax lộ</th>
                    <th className="px-4 py-2.5 text-left font-bold">Điểm đo đủ số</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().map(r => {
                    const ok = isFull(r);
                    return (
                      <tr key={r.date} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2.5 font-mono font-bold text-ink">{fmtDay(r.date)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-ink">{fmt(r.eHead)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-soft">{fmt(r.eSum)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-soft">{fmt(r.loss)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono font-bold ${ok ? 'text-ink' : 'text-faint'}`}>{fmt(r.lossPct, 2)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-soft">
                          {fmt(r.pmaxHead)} <span className="text-[11px] text-faint">{r.atHead}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-soft">
                          {fmt(r.pmaxLine)} <span className="text-[11px] text-faint">{fmt(r.pmaxRatio, 1)}%</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={ok ? 'text-soft' : 'font-bold text-[var(--warning)]'}>
                            {r.covered}/{r.total}
                            {r.headSlots < 47 && ` — đầu nguồn ${r.headSlots}/48 mốc`}
                            {r.partial && ' — thiếu mốc 23:30, tính lại đêm sau'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Chú thích phương pháp — cùng kiểu với màn Tổn thất tính toán, để hai con số
          "tổn thất" không bị đem so thẳng với nhau mà không biết mỗi cái đo cái gì. */}
      {!loading && (
        <div className="vl-card space-y-4 p-5 text-xs leading-relaxed text-soft">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-dim">
            <Info className="h-4 w-4 text-amber-500" /> Phương pháp tính tổn thất đầu nguồn
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-ink">Công thức — ĐO được, không phải tính từ thông số máy</p>
            <div className="space-y-1 rounded-lg bg-subtle px-3 py-2 font-mono text-[12px] text-ink">
              <div>A_đầu nguồn = Σ ΔPG · HSN&nbsp;&nbsp;(công tơ đầu nguồn, 48 mốc 30 phút)&nbsp;&nbsp;[kWh]</div>
              <div>A_điểm đo&nbsp;&nbsp;&nbsp;= Σ<sub>các điểm đo chính cùng lộ</sub> Σ ΔPG · HSN&nbsp;&nbsp;[kWh]</div>
              <div>ΔA = A_đầu nguồn − A_điểm đo&nbsp;&nbsp;[kWh]</div>
              <div>ΔA% = ΔA ÷ A_đầu nguồn × 100</div>
            </div>
            <ul className="list-disc space-y-0.5 pl-5">
              <li><strong>ΔPG</strong> — hiệu chỉ số hữu công chiều giao giữa hai mốc liên tiếp (chỉ số thô, chưa nhân);
                <strong> HSN</strong> — hệ số nhân của điểm đo (suy từ tỷ số TI × TU trong Danh mục).</li>
              <li><strong>Điểm đo chính cùng lộ</strong> — điểm đo vai trò <i>chính</i>, đang vận hành, công tơ đang treo,
                trạm gắn vào lộ của điểm đầu nguồn (cùng tập với Pmax lộ). KHÔNG cộng điểm đo <i>phụ</i> — đã nằm
                trong điểm chính, cộng vào là đếm hai lần.</li>
              <li>Tổn thất tháng = Σ ΔA ÷ Σ A_đầu nguồn của các ngày <strong>đủ số</strong> — không phải trung bình các tỷ lệ ngày.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-ink">Khác gì tổn thất trạm (màn "Tổn thất tính toán")</p>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-subtle text-faint">
                    <th className="px-3 py-2 text-left font-bold" />
                    <th className="px-3 py-2 text-left font-bold">Tổn thất trạm (MBA)</th>
                    <th className="px-3 py-2 text-left font-bold">Tổn thất đầu nguồn</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-bold text-ink">Cách có số</td>
                    <td className="px-3 py-2"><b>Tính</b> từ thông số máy: ΔA = P0·T + Pk·Σ(S/Sdm)²·Δt</td>
                    <td className="px-3 py-2"><b>Đo</b>: hiệu sản lượng giữa công tơ đầu nguồn và công tơ khách</td>
                  </tr>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-bold text-ink">Phạm vi</td>
                    <td className="px-3 py-2">Từng máy biến áp</td>
                    <td className="px-3 py-2">Cả lộ: đường dây trung thế + mọi MBA của lộ + sai số đo (+ câu trộm, nếu có)</td>
                  </tr>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-bold text-ink">Mẫu số của %</td>
                    <td className="px-3 py-2">sản lượng giao + tổn thất</td>
                    <td className="px-3 py-2">sản lượng đầu nguồn (chính là điện nhận vào lộ)</td>
                  </tr>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-bold text-ink">Cần</td>
                    <td className="px-3 py-2">P0, Pk, Sdm của từng trạm</td>
                    <td className="px-3 py-2">Một công tơ đo đầu lộ (vai trò "Đầu nguồn" trong Danh mục)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Hai con số bổ sung cho nhau: tổn thất đầu nguồn thường <b>lớn hơn</b> tổng tổn thất các trạm của lộ vì
              còn gồm đường dây, sai số đo, và các trạm chưa có P0/Pk nên không vào bảng tổn thất trạm. Ví dụ lộ
              473E27.4 ngày 23/09/2026: tổn thất MBA 9 trạm có thông số 488 kWh, tổn thất đầu nguồn 909,6 kWh (2,17 %).
              Phần chênh lớn bất thường ⇒ nghi công tơ đo thiếu, sai HSN hoặc mất điện năng.
            </p>
          </div>

          <p className="text-faint">
            Ngày <b>không đủ số</b> (có điểm đo thiếu mốc, hoặc đầu nguồn thiếu mốc) vẫn hiện trong bảng nhưng không
            vào tổng tháng và không xét cảnh báo — phần hụt lúc đó là do thiếu số, không phải tổn thất. Cảnh báo khi tổn
            thất ngày lệch hơn 1,5 điểm % so với trung vị 7 ngày đủ số liền trước, hoặc Pmax lộ / Pmax đầu nguồn ra
            ngoài 90–105 %.
          </p>
        </div>
      )}
    </div>
  );
}
