/**
 * Tab "Pmax theo lộ" của trang Đồ thị điện áp & công suất.
 *
 * Nguồn: `/pmax_line_daily.csv` do `scripts/pmax_line_daily.mjs` sinh mỗi đêm.
 *
 * CHỈ vẽ Pmax THÁNG (user chốt 22/09/2026) — không vẽ Pmax ngày. Pmax tháng của
 * một lộ = ngày có đỉnh cao nhất trong tháng; mỗi đỉnh ngày đã là đỉnh TRÙNG
 * THỜI ĐIỂM của cả lộ rồi.
 *
 * BA ĐIỀU MÀN NÀY PHẢI NÓI RA, không được giấu:
 *
 * 1. **Độ phủ.** Lộ có 9/13 công tơ báo số thì con số là phụ tải của 9 trạm đó,
 *    không phải của cả lộ. Không ghi ra thì hai lộ phủ khác nhau trông như so
 *    sánh được với nhau.
 * 2. **Đơn vị.** Đây là công suất TRUNG BÌNH 30 phút, khác công suất TỨC THỜI
 *    mà tab "Pmax khách hàng" dùng (lệch ~18%). Hai con số cùng một màn hình mà
 *    không nói rõ thì kiểu gì cũng bị đem so thẳng.
 * 3. **Không cộng được các lộ với nhau.** Đỉnh của các lộ rơi vào giờ khác nhau;
 *    cộng lại chính là cái sai mà cả tính năng này sinh ra để tránh.
 */
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Cell,
} from 'recharts';
import { Cable, TrendingUp, AlertTriangle, HelpCircle } from 'lucide-react';
import { usePmaxLineDaily, monthlyPeaks, monthsOf } from '../lib/pmaxLine';
import type { MonthlyLinePeak } from '../lib/pmaxLine';
import { MonthPicker } from './ui/DateTimePickers';
import { StatTile, EmptyState, CHART } from './ui/dashboard';

const p2 = (n: number) => String(n).padStart(2, '0');
const fmtKw = (n: number) => Math.round(n).toLocaleString('vi-VN');
const fmtDateVN = (k: string) => (k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : '—');

/**
 * Độ phủ thấp thì con số không đại diện cho cả lộ.
 * Ngưỡng 80%: dưới mức đó là thiếu hẳn một phần đáng kể phụ tải.
 */
const LOW_COVER = 0.8;
const isLow = (r: MonthlyLinePeak) => r.total > 0 && r.covered / r.total < LOW_COVER;

function LineTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r: MonthlyLinePeak = payload[0].payload;
  return (
    <div className="vl-chart-tooltip">
      <div className="vl-chart-tooltip-title">{r.line}</div>
      <div className="vl-chart-tooltip-group">
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Pmax</span>
          <span className="vl-val">{fmtKw(r.pmax)} kW</span>
        </div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Đạt lúc</span>
          <span className="vl-val">{fmtDateVN(r.date)} {r.at}</span>
        </div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Công tơ có số liệu</span>
          <span className="vl-val">{r.covered}/{r.total}</span>
        </div>
        <div className="vl-chart-tooltip-row">
          <span className="vl-lbl">Số ngày có số liệu</span>
          <span className="vl-val">{r.days}</span>
        </div>
      </div>
    </div>
  );
}

export default function LinePmaxTab() {
  const { rows, loading, error } = usePmaxLineDaily();

  const months = useMemo(() => monthsOf(rows), [rows]);
  const [month, setMonth] = useState('');
  /* Mặc định tháng mới nhất có số liệu — mở ra là thấy ngay, không phải chọn. */
  const current = month || (months[0] ? `${months[0].year}-${p2(months[0].monthIdx + 1)}` : '');

  const peaks = useMemo(() => {
    if (!current) return [];
    const [y, m] = current.split('-').map(Number);
    return monthlyPeaks(rows, y, m - 1);
  }, [rows, current]);

  const top = peaks[0];
  const lowCount = peaks.filter(isLow).length;

  if (error) {
    return <div className="vl-alert vl-alert-light-danger">Không đọc được số liệu Pmax lộ: {error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* ---- Đầu trang + chọn tháng ---- */}
      <div className="vl-card flex flex-col justify-between gap-4 p-5 md:flex-row md:items-end">
        <div>
          <h2 className="text-lg font-bold text-ink">Pmax theo lộ đường dây</h2>
          <p className="mt-1 max-w-3xl text-sm text-soft">
            Đỉnh phụ tải của cả lộ: cộng công suất các trạm theo <b>từng mốc 30 phút</b> rồi
            mới lấy giá trị lớn nhất. Không phải tổng các Pmax trạm — các trạm đạt đỉnh
            khác giờ nhau nên cộng như vậy sẽ vống lên tới 25%.
          </p>
          <p className="mt-1.5 text-[12px] text-faint">
            Đây là công suất <b>trung bình 30 phút</b>, khác công suất <b>tức thời</b> ở tab
            "Pmax khách hàng" (lệch khoảng 18%) — đừng so thẳng hai con số.
          </p>
        </div>
        <div className="shrink-0">
          <MonthPicker value={current} onChange={setMonth} label="Tháng" className="w-[200px]" />
          {months.length > 0 && (
            <p className="mt-1.5 text-[11px] font-medium text-faint">
              Có số liệu từ {p2(months[months.length - 1].monthIdx + 1)}/{months[months.length - 1].year}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="vl-card flex items-center justify-center py-20 text-faint">Đang tải…</div>
      ) : peaks.length === 0 ? (
        <EmptyState icon={HelpCircle} title="Chưa có số liệu cho tháng này"
          hint="Số liệu Pmax lộ bắt đầu được ghi từ 27/08/2026." />
      ) : (
        <>
          {/* ---- Thẻ tổng quan ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile label="Lộ có phụ tải lớn nhất" value={top.line} icon={Cable}
              sub={`${fmtKw(top.pmax)} kW · ${fmtDateVN(top.date)} lúc ${top.at}`} />
            <StatTile label="Số lộ có số liệu" value={peaks.length} icon={TrendingUp}
              sub={`trong tháng ${current.slice(5)}/${current.slice(0, 4)}`} />
            <StatTile
              label="Lộ thiếu số liệu"
              value={lowCount}
              icon={AlertTriangle}
              tone={lowCount ? 'warn' : 'neutral'}
              sub={lowCount
                ? `dưới ${LOW_COVER * 100}% công tơ báo số — con số chưa đại diện cả lộ`
                : 'mọi lộ đều đủ số liệu'}
            />
          </div>

          {/* ---- Biểu đồ ---- */}
          <div className="vl-card p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-bold text-ink">Pmax từng lộ trong tháng</h3>
              {/* Nói thẳng thay vì để người đọc tự cộng rồi tưởng ra tổng hệ thống. */}
              <span className="text-[11px] text-faint">Không cộng các lộ với nhau — đỉnh rơi vào giờ khác nhau</span>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={peaks} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="line" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={54} />
                <YAxis tick={{ fontSize: 11 }} width={62}
                  label={{ value: 'kW', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <Tooltip content={<LineTooltip />} cursor={{ fill: 'var(--subtle)' }} />
                <Bar dataKey="pmax" name="Pmax" radius={[3, 3, 0, 0]} maxBarSize={54}>
                  {peaks.map((r, i) => (
                    /* Lộ thiếu số liệu tô khác màu — nhìn biểu đồ là thấy ngay
                       cột nào chưa đáng tin, không phải rê chuột từng cột. */
                    <Cell key={i} fill={isLow(r) ? 'var(--warning)' : CHART.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ---- Bảng chi tiết ---- */}
          <div className="vl-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-subtle text-faint">
                    <th className="px-4 py-2.5 text-left font-bold">Lộ</th>
                    <th className="px-4 py-2.5 text-right font-bold">Pmax (kW)</th>
                    <th className="px-4 py-2.5 text-left font-bold">Đạt lúc</th>
                    <th className="px-4 py-2.5 text-left font-bold">Công tơ có số liệu</th>
                    <th className="px-4 py-2.5 text-right font-bold">Ngày có số liệu</th>
                  </tr>
                </thead>
                <tbody>
                  {peaks.map(r => (
                    <tr key={r.line} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2.5 font-mono font-bold text-ink">{r.line}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-ink">{fmtKw(r.pmax)}</td>
                      <td className="px-4 py-2.5 font-mono text-soft">{fmtDateVN(r.date)} {r.at}</td>
                      <td className="px-4 py-2.5">
                        <span className={isLow(r) ? 'font-bold text-[var(--warning)]' : 'text-soft'}>
                          {r.covered}/{r.total}
                        </span>
                        {isLow(r) && (
                          <span className="ml-2 text-[11px] text-[var(--warning)]">
                            chưa đại diện cả lộ
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-soft">{r.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
