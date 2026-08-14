import { RefreshCw, Info } from 'lucide-react';
import type { Consumption } from '../../lib/hesIndex';
import { fmt, fmtTime, type MeterRow } from './useHesConsumption';

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
  consumptions: Map<string, Consumption | null>;
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

/** Khối thông báo nhỏ dùng chung ở đầu 2 màn HES (chưa có dữ liệu / khoảng ngày sai). */
export function HesRangeNotices({
  isLoading, hasDates, validRange, rounded = false,
}: {
  isLoading: boolean;
  /** `hesData` đã tải xong và có ít nhất một ngày. `null` khi chưa tải. */
  hasDates: boolean | null;
  validRange: boolean;
  /** Khối Văn phòng đặt notice ngoài card nên cần bo góc. */
  rounded?: boolean;
}) {
  if (isLoading || hasDates === null) return null;
  const r = rounded ? ' rounded-lg' : '';
  if (!hasDates) {
    return (
      <div className={`flex items-center gap-2 px-5 py-3 text-xs text-soft bg-subtle/50${r}`}>
        <Info className="w-3.5 h-3.5 shrink-0" />
        Chưa có dữ liệu chỉ số tự động — workflow “Fetch HES Index” cần chạy ít nhất một lần.
      </div>
    );
  }
  if (!validRange) {
    return (
      <div className={`flex items-center gap-2 px-5 py-3 text-xs text-warn bg-[var(--warning-soft)]${r}`}>
        <Info className="w-3.5 h-3.5 shrink-0" />
        Khoảng ngày không hợp lệ — ngày đầu kỳ phải nhỏ hơn hoặc bằng ngày cuối kỳ.
      </div>
    );
  }
  return null;
}
