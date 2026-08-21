/**
 * Bảng lịch đợt thanh toán của MỘT hợp đồng.
 *
 * Dùng lại ở cả màn danh sách (mở accordion) lẫn hộp thoại sửa hợp đồng, nên
 * không tự gọi dữ liệu — nhận `payments` từ ngoài.
 */

import { CheckCircle2, Clock } from 'lucide-react';
import {
  STATUS_BADGE, STATUS_LABEL, overdueDays, paymentStatus, remainingOf,
  type Payment,
} from '../../lib/qlvh';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
const dateVN = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return dd ? `${dd}/${m}/${y}` : d;
};

export default function PaymentScheduleTable({
  payments,
  emptyHint = 'Hợp đồng chưa có đợt thanh toán nào.',
}: {
  payments: Payment[];
  emptyHint?: string;
}) {
  if (payments.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-sm text-faint flex items-center justify-center gap-2">
        <Clock className="w-4 h-4" />{emptyHint}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="vl-table w-full text-left border-collapse min-w-[760px]">
        <thead>
          <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
            <th className="py-3 px-4 w-[70px] text-center">Đợt</th>
            <th className="py-3 px-4 w-[130px] text-center">Đến hạn</th>
            <th className="py-3 px-4 text-right">Phải thu</th>
            <th className="py-3 px-4 text-right">Đã thu</th>
            <th className="py-3 px-4 text-right">Còn lại</th>
            <th className="py-3 px-4 w-[130px] text-center">Ngày thu</th>
            <th className="py-3 px-4 w-[140px]">Số hoá đơn</th>
            <th className="py-3 px-4 w-[150px] text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {payments.map(p => {
            const st = paymentStatus(p);
            const late = overdueDays(p);
            const left = remainingOf(p);
            return (
              <tr key={p.id || p.seq} className="border-b border-[var(--border)] last:border-0">
                <td className="py-3 px-4 text-center font-bold text-ink tabular-nums">{p.seq}</td>
                <td className="py-3 px-4 text-center tabular-nums text-soft">{dateVN(p.due_date)}</td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold text-ink">{money(p.amount_due)}</td>
                <td className="py-3 px-4 text-right tabular-nums text-soft">{p.amount_paid ? money(p.amount_paid) : '—'}</td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold text-ink">{left ? money(left) : '—'}</td>
                <td className="py-3 px-4 text-center tabular-nums text-soft">{dateVN(p.paid_date)}</td>
                <td className="py-3 px-4 text-soft truncate">{p.invoice_no || '—'}</td>
                <td className="py-3 px-4 text-center">
                  <span className={STATUS_BADGE[st]}>
                    {st === 'da_thu' && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
                    {STATUS_LABEL[st]}
                    {late > 0 && ` ${late} ngày`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
