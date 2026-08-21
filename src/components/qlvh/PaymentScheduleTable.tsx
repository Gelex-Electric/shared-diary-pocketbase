/**
 * Bảng lịch đợt thanh toán của MỘT hợp đồng.
 *
 * Dùng lại ở cả màn danh sách (mở accordion) lẫn hộp thoại sửa hợp đồng, nên
 * không tự gọi dữ liệu — nhận `payments` từ ngoài.
 *
 * Ở màn danh sách, ba ô **Đã thu**, **Ngày thu** và **Ngày xuất hoá đơn** sửa
 * được ngay tại chỗ
 * (`editable`): sửa xong bấm Lưu ở hàng nút phía dưới thẻ. Component này chỉ
 * giữ bản nháp qua `edits`/`onEdit`, việc ghi do nơi gọi quyết định — bảng
 * không tự ý ghi xuống PocketBase.
 */

import { CheckCircle2, Clock } from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import {
  STATUS_BADGE, STATUS_LABEL, overdueDays, paymentStatus, remainingOf,
  withVat, withoutVat,
  type Payment,
} from '../../lib/qlvh';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
const parseMoney = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const dateVN = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return dd ? `${dd}/${m}/${y}` : d;
};

/** Bản nháp đang sửa của một đợt. */
export interface PaymentEdit {
  amount_paid?: number;
  paid_date?: string;
  invoice_date?: string;
}

const CELL_INPUT =
  'w-full px-2 py-1 bg-surface border border-[var(--border)] rounded text-sm ' +
  'focus:ring-2 focus:ring-accent outline-none';

export default function PaymentScheduleTable({
  payments,
  vatRate = 0,
  emptyHint = 'Hợp đồng chưa có đợt thanh toán nào.',
  editable = false,
  edits = {},
  onEdit,
}: {
  payments: Payment[];
  /**
   * Thuế suất của hợp đồng. Các đợt LƯU theo trước thuế (khớp hợp đồng và bảng
   * theo dõi), còn bảng này HIỆN SAU THUẾ — đúng số khách hàng thực trả. Ô sửa
   * cũng nhận số sau thuế rồi quy ngược về trước thuế lúc ghi.
   */
  vatRate?: number;
  emptyHint?: string;
  /** Cho sửa tại chỗ 3 ô: Đã thu / Ngày thu / Ngày xuất hoá đơn. */
  editable?: boolean;
  /** Bản nháp theo id đợt — nơi gọi giữ, để còn biết có gì chưa lưu. */
  edits?: Record<string, PaymentEdit>;
  onEdit?: (id: string, patch: PaymentEdit) => void;
}) {
  if (payments.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-sm text-faint flex items-center justify-center gap-2">
        <Clock className="w-4 h-4" />{emptyHint}
      </div>
    );
  }

  /** Giá trị đang hiện = bản nháp nếu có, không thì lấy từ dữ liệu gốc. */
  const view = (p: Payment): Payment => ({ ...p, ...(edits[p.id] || {}) });

  /** Số lưu (trước thuế) → số hiện lên màn hình (sau thuế). */
  const gross = (v: number) => withVat(v, vatRate);

  return (
    <div className="overflow-x-auto">
      {/*
        `table-fixed` + đặt bề rộng cho MỌI cột: một thẻ khách hàng có nhiều hợp
        đồng nghĩa là nhiều bảng xếp chồng nhau. Để cột tự co theo nội dung thì
        mỗi bảng rộng một kiểu và các cột không thẳng hàng giữa các hợp đồng.
      */}
      <table className="vl-table w-full text-left border-collapse table-fixed min-w-[1040px]">
        <thead>
          <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
            <th className="py-3 px-4 w-[64px] text-center">Đợt</th>
            <th className="py-3 px-4 w-[120px] text-center">Đến hạn</th>
            <th className="py-3 px-4 w-[150px] text-right">Phải thu</th>
            <th className="py-3 px-4 w-[170px] text-right">Đã thu</th>
            <th className="py-3 px-4 w-[150px] text-right">Còn lại</th>
            <th className="py-3 px-4 w-[170px] text-center">Ngày thu</th>
            <th className="py-3 px-4 w-[170px] text-center">Ngày xuất hoá đơn</th>
            <th className="py-3 px-4 w-[146px] text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {payments.map(orig => {
            const p = view(orig);
            const st = paymentStatus(p);
            const late = overdueDays(p);
            const left = remainingOf(p);
            const touched = Boolean(edits[orig.id]);
            return (
              <tr key={orig.id || orig.seq}
                className={`border-b border-[var(--border)] last:border-0 ${touched ? 'bg-accent-soft/40' : ''}`}>
                <td className="py-3 px-4 text-center font-bold text-ink tabular-nums">{p.seq}</td>
                <td className="py-3 px-4 text-center tabular-nums text-soft">{dateVN(p.due_date)}</td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold text-ink">{money(gross(p.amount_due))}</td>

                <td className="py-2 px-4 text-right">
                  {editable && onEdit ? (
                    <input
                      value={p.amount_paid ? money(gross(p.amount_paid || 0)) : ''}
                      inputMode="numeric" placeholder="0"
                      onChange={e => onEdit(orig.id, {
                        // người dùng gõ số SAU thuế → quy về trước thuế để lưu
                        amount_paid: withoutVat(parseMoney(e.target.value), vatRate),
                      })}
                      className={`${CELL_INPUT} text-right tabular-nums`}
                    />
                  ) : (
                    <span className="tabular-nums text-soft">{p.amount_paid ? money(gross(p.amount_paid || 0)) : '—'}</span>
                  )}
                </td>

                <td className="py-3 px-4 text-right tabular-nums font-semibold text-ink">{left ? money(gross(left)) : '—'}</td>

                <td className="py-2 px-4 text-center">
                  {editable && onEdit ? (
                    <DatePicker
                      value={String(p.paid_date || '').slice(0, 10)}
                      onChange={v => onEdit(orig.id, { paid_date: v })}
                      usePortal
                    />
                  ) : (
                    <span className="tabular-nums text-soft">{dateVN(p.paid_date)}</span>
                  )}
                </td>

                <td className="py-2 px-4 text-center">
                  {editable && onEdit ? (
                    <DatePicker
                      value={String(p.invoice_date || '').slice(0, 10)}
                      onChange={v => onEdit(orig.id, { invoice_date: v })}
                      usePortal
                    />
                  ) : (
                    <span className="tabular-nums text-soft">{dateVN(p.invoice_date)}</span>
                  )}
                </td>

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
