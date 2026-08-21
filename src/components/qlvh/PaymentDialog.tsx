/**
 * Hộp thoại ghi nhận một khoản thu của hợp đồng.
 *
 * Người dùng nhập MỘT số tiền, hệ thống tự rải vào các đợt chưa thu đủ theo thứ
 * tự (allocatePayment) — vì thực tế khách hay chuyển một cục cho nhiều đợt.
 * Bảng "sẽ ghi vào" hiện trước khi bấm lưu: không ai phải đoán tiền chạy đi đâu.
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, RefreshCw, Wallet, X } from 'lucide-react';
import { DatePicker } from '../ui/DateTimePickers';
import { toast as notify } from '../../lib/toast';
import {
  allocatePayment, recordPayment, remainingOf, todayStr,
  type ContractWithSchedule,
} from '../../lib/qlvh';

const INPUT =
  'w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm ' +
  'focus:ring-2 focus:ring-accent outline-none';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
const parseMoney = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const dateVN = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return dd ? `${dd}/${m}/${y}` : d;
};

export default function PaymentDialog({
  open, row, onClose, onSaved,
}: {
  open: boolean;
  row: ContractWithSchedule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [paidDate, setPaidDate] = useState(todayStr());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [saving, setSaving] = useState(false);

  /* Mở lại hộp thoại thì điền sẵn đúng số còn phải thu — thao tác hay gặp nhất. */
  useEffect(() => {
    if (!open || !row) return;
    setAmount(row.totals.remaining);
    setPaidDate(todayStr());
    setInvoiceNo('');
  }, [open, row]);

  /* Xem trước bằng CHÍNH hàm sẽ chạy khi lưu — không viết lại logic lần hai. */
  const preview = useMemo(
    () => (row ? allocatePayment(row.payments, amount, paidDate) : { changes: [], leftover: 0 }),
    [row, amount, paidDate],
  );

  if (!row) return null;

  const unpaid = row.payments.filter(p => remainingOf(p) > 0);

  const save = async () => {
    if (amount <= 0) { notify.error('Số tiền phải lớn hơn 0.'); return; }
    if (!paidDate) { notify.error('Chưa chọn ngày thu.'); return; }
    setSaving(true);
    try {
      const res = await recordPayment(row.contract.id, amount, paidDate, invoiceNo.trim() || undefined);
      notify.success(
        res.leftover > 0
          ? `Đã ghi nhận ${money(amount - res.leftover)}đ vào ${res.changes.length} đợt; thừa ${money(res.leftover)}đ chưa phân bổ.`
          : `Đã ghi nhận ${money(amount)}đ vào ${res.changes.length} đợt.`,
      );
      onSaved();
      onClose();
    } catch (err: any) {
      notify.error(err?.message || 'Ghi nhận thu tiền thất bại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start md:items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-2xl max-h-[90vh] my-4 flex flex-col bg-surface rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)] bg-subtle/60 shrink-0">
              <div className="p-2 bg-accent-soft rounded-xl text-accent">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-ink tracking-tight truncate">Ghi nhận thu tiền</h3>
                <p className="text-[11px] text-faint truncate">
                  {row.contract.contract_no} · {row.customerName}
                </p>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg text-faint hover:bg-subtle hover:text-dim transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">

              <div className="grid grid-cols-2 gap-3">
                <div className="vl-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Giá trị hợp đồng</p>
                  <p className="text-lg font-bold text-ink tabular-nums mt-1">{money(row.contract.value_total)}đ</p>
                </div>
                <div className="vl-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Còn phải thu</p>
                  <p className="text-lg font-bold text-ink tabular-nums mt-1">{money(row.totals.remaining)}đ</p>
                </div>
              </div>

              {unpaid.length === 0 ? (
                <p className="vl-alert vl-alert-light-success text-sm">
                  Hợp đồng này đã thu đủ toàn bộ các đợt.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                        Số tiền thu (đ)
                      </label>
                      <input value={amount ? money(amount) : ''} inputMode="numeric"
                        onChange={e => setAmount(parseMoney(e.target.value))}
                        placeholder="0" className={`${INPUT} text-right tabular-nums font-bold`} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                        Ngày thu
                      </label>
                      <DatePicker value={paidDate} onChange={setPaidDate} usePortal />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
                        Số hoá đơn
                      </label>
                      <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
                        placeholder="không bắt buộc" className={INPUT} />
                    </div>
                  </div>

                  {/* Xem trước phân bổ */}
                  <div className="vl-card overflow-hidden">
                    <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-faint border-b border-[var(--border)] bg-subtle/40">
                      Sẽ ghi vào các đợt
                    </p>
                    {preview.changes.length === 0 ? (
                      <p className="px-4 py-5 text-center text-sm text-faint">
                        Nhập số tiền để xem tiền được rải vào đợt nào.
                      </p>
                    ) : (
                      <table className="vl-table w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider">
                            <th className="py-2 px-4 w-[70px] text-center">Đợt</th>
                            <th className="py-2 px-4 w-[120px] text-center">Đến hạn</th>
                            <th className="py-2 px-4 text-right">Đã thu → sau khi ghi</th>
                            <th className="py-2 px-4 text-right w-[130px]">Còn lại</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.changes.map(ch => {
                            const p = row.payments.find(x => x.seq === ch.seq)!;
                            const after = Math.max(0, p.amount_due - ch.amount_paid);
                            return (
                              <tr key={ch.seq} className="border-b border-[var(--border)] last:border-0">
                                <td className="py-2 px-4 text-center font-bold tabular-nums text-ink">{ch.seq}</td>
                                <td className="py-2 px-4 text-center tabular-nums text-soft">{dateVN(p.due_date)}</td>
                                <td className="py-2 px-4 text-right tabular-nums">
                                  <span className="text-faint">{money(p.amount_paid || 0)}</span>
                                  <ArrowRight className="w-3 h-3 inline mx-1.5 text-faint" />
                                  <span className="font-semibold text-ink">{money(ch.amount_paid)}</span>
                                  <span className="text-faint"> / {money(p.amount_due)}</span>
                                </td>
                                <td className="py-2 px-4 text-right tabular-nums font-semibold text-ink">
                                  {after > 0 ? money(after) : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {preview.leftover > 0 && (
                    <p className="vl-alert vl-alert-light-warning flex items-start gap-2 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        Thừa <b>{money(preview.leftover)}đ</b> so với tổng các đợt còn phải thu —
                        khoản này sẽ KHÔNG được ghi vào đâu cả. Kiểm tra lại số tiền, hoặc thêm đợt
                        mới trong phần sửa hợp đồng trước khi ghi nhận.
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)] bg-subtle/40 shrink-0">
              <button onClick={onClose} className="vl-btn vl-btn-secondary" type="button">Huỷ</button>
              <button onClick={save} disabled={saving || unpaid.length === 0 || preview.changes.length === 0}
                className="vl-btn vl-btn-primary" type="button">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                Ghi nhận thu tiền
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
