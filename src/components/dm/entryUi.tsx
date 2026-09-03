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
import { useState } from 'react';
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

/** Chấm ngăn ngàn kiểu Việt Nam: 1963 → "1.963". Chỉ để NHÌN, không để lưu. */
export const groupThousands = (digits: string) =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Ô nhập SỐ NGUYÊN (kVA, W…).
 *
 * KHÔNG dùng `<input type="number">`: trên locale Việt, gõ "1.963" được trình
 * duyệt hiểu là 1,963 (dấu chấm = thập phân) chứ không phải 1963. Đã có 2 trạm
 * lưu tổn hao ngắn mạch bằng ~2 W vì lỗi này (sửa ngày 20/08/2026, xem
 * `scripts/dm_fix_pk_w.mjs`).
 *
 * Cách chặn: ô là `type="text"`, mọi ký tự không phải chữ số bị LỌC BỎ ngay khi
 * gõ — "1.963", "1,963", "1 963 W" đều thành "1963". Dấu ngăn cách không còn
 * đường nào lọt xuống cơ sở dữ liệu.
 *
 * `min`/`max` chỉ để CẢNH BÁO, không chặn lưu — đúng luật đã chốt cho màn danh
 * mục: nhắc màu vàng, người dùng vẫn tự quyết.
 */
export function NumberInput({ value, onChange, placeholder, suffix, min, max }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; suffix?: string;
  /** Ngoài khoảng [min, max] thì nhắc màu vàng, KHÔNG cấm lưu. */
  min?: number; max?: number;
}) {
  const [focused, setFocused] = useState(false);

  const n = value === '' ? undefined : Number(value);
  const outOfRange = n !== undefined &&
    ((min !== undefined && n < min) || (max !== undefined && n > max));

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={focused || !value ? value : groupThousands(value)}
          onChange={e => onChange(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className={`${INPUT_CLS} ${suffix ? 'pr-14' : ''} ${
            outOfRange ? 'border-[var(--warning)] focus:ring-[var(--warning)]' : ''
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-faint">
            {suffix}
          </span>
        )}
      </div>
      {outOfRange && (
        <p className="ml-1 text-[11px] font-semibold leading-snug text-warn">
          Giá trị {groupThousands(value)} nằm ngoài khoảng thường gặp
          {min !== undefined && max !== undefined
            ? ` ${groupThousands(String(min))}–${groupThousands(String(max))}`
            : min !== undefined ? ` từ ${groupThousands(String(min))}` : ` tới ${groupThousands(String(max))}`}
          {suffix ? ` ${suffix}` : ''}. Kiểm tra lại — vẫn lưu được nếu đúng.
        </p>
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
export function FormModal({ open, title, onClose, onSubmit, saving, wide, submitLabel, children }: {
  open: boolean; title: string; onClose: () => void;
  onSubmit: () => void; saving?: boolean;
  /** Chữ trên nút xác nhận; mặc định "Lưu lại". */
  submitLabel?: string;
  /**
   * Form có bảng bên trong thì cần rộng hơn, kẻo các cột teo lại. Nở dần theo
   * bề ngang màn hình: laptop giữ nguyên 4xl như cũ, màn lớn mới rộng thêm.
   */
  wide?: boolean;
  children: ReactNode;
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
            className={`relative max-h-[90vh] w-full overflow-y-auto rounded-lg bg-surface p-8 shadow-2xl ${
              wide ? 'max-w-4xl xl:max-w-5xl 2xl:max-w-7xl' : 'max-w-2xl'
            }`}
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
                  {saving ? 'Đang lưu…' : (submitLabel ?? 'Lưu lại')}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Ô nhập NẰM TRONG BẢNG — trong suốt, không viền riêng, lấp đầy ô.
 * Khuôn lấy từ bảng "tình hình vận hành" ở sổ nhật ký (`HandoverManager`):
 * viền là của ô bảng, nên chữ được trọn bề ngang thay vì bị bóp trong hộp con.
 */
export function CellInput({ value, onChange, placeholder, mono, align = 'left', type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  mono?: boolean; align?: 'left' | 'center'; type?: 'text' | 'number';
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg bg-transparent p-2 text-sm outline-none transition-colors focus:bg-subtle placeholder:font-normal placeholder:text-faint ${
        mono ? 'font-mono font-semibold' : ''
      } ${align === 'center' ? 'text-center' : ''}`}
    />
  );
}

/**
 * Khung bảng: thẻ bo góc, cuộn ngang, kèm trạng thái đang tải / rỗng.
 *
 * `fixed` bật `table-fixed`: bề rộng cột lấy đúng theo `w-[..%]` khai ở `<th>`
 * thay vì để trình duyệt tự chia theo nội dung. Không có nó thì ở màn rộng mấy
 * cột đầu (nội dung dài) nuốt hết khoảng dư, đẩy các cột sau dồn về mép phải.
 * Chỉ bật cho bảng đã khai đủ % cho MỌI cột, cộng lại bằng 100.
 */
export function TableCard({ columns, loading, empty, isEmpty, fixed, children }: {
  columns: ReactNode; loading: boolean; empty: string; isEmpty: boolean;
  fixed?: boolean; children: ReactNode;
}) {
  const colSpan = 99;
  return (
    <div className="vl-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`vl-table w-full border-collapse text-left ${fixed ? 'table-fixed' : ''}`}>
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
