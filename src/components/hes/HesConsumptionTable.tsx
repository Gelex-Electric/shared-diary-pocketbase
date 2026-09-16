import { RefreshCw } from 'lucide-react';
import { fmt, fmtTime, type MeterRow, type ConsumptionCell } from './hesShared';

const COLS = 10;

/**
 * Bảng sản lượng theo khoảng ngày. Dùng chung cho cả 2 khối:
 * khối Vận hành render MỘT bảng, khối Văn phòng render mỗi KCN một bảng.
 *
 * `status` chỉ để hiện dòng chờ/dòng trống ngay trong `<tbody>` — nơi gọi
 * nào tự lo trạng thái rỗng ở ngoài thì bỏ qua prop này.
 */
export function HesConsumptionTable({
  rows, consumptions, highlightId = '', status,
}: {
  rows: MeterRow[];
  consumptions: Map<string, ConsumptionCell | null>;
  /** Công tơ được tô nổi bật (thường là công tơ tiêu thụ lớn nhất). */
  highlightId?: string;
  status?: 'loading' | 'empty';
}) {
  return (
    <div className="overflow-x-auto">
      <table className="vl-table w-full text-left border-collapse">
        <thead>
          <tr>
            <th>Số công tơ</th>
            <th>Trạm</th>
            <th className="text-center">Hệ số nhân</th>
            <th className="text-center">Thời gian đầu kỳ</th>
            <th className="text-center">Thời gian cuối kỳ</th>
            <th className="text-center text-ink font-bold border-x border-[var(--border)]">Tổng (kWh)</th>
            <th className="text-center">Biểu 1 (kWh)</th>
            <th className="text-center">Biểu 2 (kWh)</th>
            <th className="text-center">Biểu 3 (kWh)</th>
            <th className="text-center">Vô công (kVarh)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {status === 'loading' ? (
            <tr><td colSpan={COLS} className="py-10 text-center"><RefreshCw className="w-5 h-5 animate-spin text-faint mx-auto" /></td></tr>
          ) : status === 'empty' ? (
            <tr><td colSpan={COLS} className="py-10 text-center text-faint text-sm italic">Không có dữ liệu công tơ</td></tr>
          ) : (
            rows.map(m => {
              const c = consumptions.get(m.MeterNo);
              const isMax = m.id === highlightId;
              return (
                <tr key={m.id} className={`transition-colors ${isMax ? 'bg-[var(--warning-soft)] hover:bg-[var(--warning-soft)]' : 'hover:bg-subtle'}`}>
                  <td>
                    <span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-1 rounded">{m.MeterNo}</span>
                  </td>
                  <td className="text-sm text-soft">{m.Line || '—'}</td>
                  <td className="text-center text-xs font-mono text-soft">{m.HSN || '1'}</td>
                  <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtTime(c?.startTime)}</td>
                  <td className="text-center text-[11px] font-mono text-faint whitespace-nowrap">{fmtTime(c?.endTime)}</td>
                  <td className="text-center text-sm font-extrabold text-ink border-x border-[var(--border)]">{fmt(c?.values.PG ?? null)}</td>
                  <td className="text-center text-xs font-bold text-accent">{fmt(c?.values.BT ?? null)}</td>
                  <td className="text-center text-xs font-bold text-orange-500">{fmt(c?.values.CD ?? null)}</td>
                  <td className="text-center text-xs font-bold text-purple-500">{fmt(c?.values.TD ?? null)}</td>
                  <td className="text-center text-xs font-bold text-soft">{fmt(c?.values.VC ?? null)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
