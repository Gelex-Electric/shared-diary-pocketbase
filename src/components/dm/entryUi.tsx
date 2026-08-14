/**
 * Mảnh ghép dùng chung cho các màn danh mục `dm_*`.
 *
 * Bám đúng khuôn đang dùng trong app (mẫu: `ElectricShiftManager`):
 *   - Đầu trang: tiêu đề + mô tả bên trái, nút "Thêm …" bên phải.
 *   - Bảng full-width trong `vl-card overflow-hidden`, ô `px-6 py-4`,
 *     cột đầu thụt `pl-10`, cột thao tác canh phải `pr-10`.
 *   - Form nằm trong MODAL nổi, không đặt cố định đầu trang.
 *
 * Ô nhập dùng lại nguyên chuỗi class của `ElectricShiftManager` để 3 màn danh
 * mục nhìn y hệt các màn cũ.
 */
import type { FormEvent, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check } from 'lucide-react';

export const INPUT_CLS =
  'w-full bg-subtle border border-[var(--border)] px-4 py-3 rounded focus:outline-none ' +
  'focus:ring-2 focus:ring-accent focus:bg-surface transition-all text-sm font-bold';

/** Ô tiêu đề cột — dùng chung cho cả 3 bảng. */
export const TH_CLS =
  'px-6 py-4 text-[10px] font-bold text-faint uppercase tracking-widest';

export function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="ml-1 block text-[10px] font-bold uppercase text-faint">
        {label} {required && <span className="text-bad">*</span>}
      </label>
      {children}
      {hint && <p className="ml-1 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, disabled, mono }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`${INPUT_CLS} ${mono ? 'font-mono' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    />
  );
}

export function NumberInput({ value, onChange, placeholder, suffix }: {
  value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLS} ${suffix ? 'pr-14' : ''}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-faint">
          {suffix}
        </span>
      )}
    </div>
  );
}

/**
 * Ô chỉ đọc — dùng cho giá trị do hệ thống sinh (vd mã trạm ghép từ 4 mảnh).
 * Nền chìm + viền đứt để người dùng thấy ngay là không gõ vào đây được.
 */
export function DerivedValue({ value, placeholder }: { value: string; placeholder?: string }) {
  return (
    <div className="w-full rounded border border-dashed border-[var(--border)] bg-subtle px-4 py-3 font-mono text-sm font-bold">
      {value ? <span className="text-ink">{value}</span> : <span className="text-faint">{placeholder}</span>}
    </div>
  );
}

/**
 * Modal nhập liệu — bấm "Thêm …" mới hiện, dùng lại cho cả thêm mới lẫn sửa.
 * Nền mờ bấm ra ngoài để đóng, hệt các modal sẵn có trong app.
 */
export function FormModal({ open, title, onClose, onSubmit, saving, children }: {
  open: boolean; title: string; onClose: () => void;
  onSubmit: () => void; saving?: boolean; children: ReactNode;
}) {
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-8 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between border-b border-[var(--border)] pb-4">
              <h3 className="text-xl font-bold text-ink">{title}</h3>
              <button onClick={onClose} className="rounded-lg p-1 transition-colors hover:bg-subtle">
                <X className="h-6 w-6 text-faint" />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-6">
              {children}
              <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-4">
                <button type="button" onClick={onClose} className="vl-btn vl-btn-secondary">Hủy</button>
                <button type="submit" disabled={saving} className="vl-btn vl-btn-primary flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  {saving ? 'Đang lưu…' : 'Lưu lại'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Khung bảng: thẻ bo góc, cuộn ngang, kèm trạng thái đang tải / rỗng. */
export function TableCard({ columns, loading, empty, isEmpty, children }: {
  columns: ReactNode; loading: boolean; empty: string; isEmpty: boolean; children: ReactNode;
}) {
  const colSpan = 99;
  return (
    <div className="vl-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="vl-table w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">{columns}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="px-6 py-12 text-center text-faint">
                  <div className="flex items-center justify-center gap-3">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <span>Đang tải danh sách...</span>
                  </div>
                </td>
              </tr>
            ) : isEmpty ? (
              <tr>
                <td colSpan={colSpan} className="px-6 py-12 text-center italic text-faint">{empty}</td>
              </tr>
            ) : children}
          </tbody>
        </table>
      </div>
    </div>
  );
}
