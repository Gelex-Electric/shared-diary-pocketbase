/**
 * Mảnh ghép dùng chung cho các màn nhập danh mục `dm_*`.
 *
 * Vì sao có file này: bản đầu xếp ô nhập sát viền thẻ nên nhìn rối. Ở đây tách
 * hẳn hai khối — KHU NHẬP (nền chìm, bo góc, có khoảng thở) và DANH SÁCH (thẻ
 * riêng) — để mắt phân biệt được "đang khai" với "đã khai".
 *
 * Vẫn dùng token/lớp có sẵn của app (`vl-card`, `vl-btn*`, `vl-table`, biến
 * theme), không đẻ ngôn ngữ thiết kế mới.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/* Ô nhập: nền nổi trên nền chìm của khu nhập, viền mảnh, focus ring accent. */
const INPUT_CLS =
  'w-full px-3.5 py-2.5 bg-surface border border-[var(--border)] rounded-lg text-sm ' +
  'outline-none transition-all focus:ring-2 focus:ring-accent focus:border-accent ' +
  'placeholder:text-faint placeholder:font-normal';

export function Field({ label, required, hint, children, className = '' }: {
  label: string; required?: boolean; hint?: string;
  children: ReactNode; className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint">
        {label} {required && <span className="text-bad">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, disabled, mono }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`${INPUT_CLS} ${mono ? 'font-mono font-semibold' : ''} ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
    />
  );
}

export function NumberInput({ value, onChange, placeholder, disabled, suffix }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${INPUT_CLS} ${suffix ? 'pr-14' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-faint">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Ô chỉ đọc — dùng cho giá trị suy ra từ lựa chọn khác (vd KCN suy từ trạm). */
export function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-subtle px-3.5 py-2.5 text-sm text-soft">
      {children}
    </div>
  );
}

/**
 * Khu nhập liệu: dải màu mảnh trên đầu + tiêu đề + lưới ô nhập trên nền chìm,
 * nút lưu tách xuống chân bởi một đường kẻ.
 */
export function FormPanel({ icon: Icon, hex, title, subtitle, children, footer }: {
  icon: LucideIcon; hex: string; title: string; subtitle: string;
  children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="vl-card overflow-hidden p-0">
      {/* Dải màu nhận diện bảng */}
      <div className="h-1" style={{ backgroundColor: hex }} />

      <div className="flex items-center gap-3 px-6 pt-5">
        <span
          className="grid h-10 w-10 shrink-0 place-content-center rounded-xl"
          style={{ backgroundColor: `${hex}1f`, color: hex }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[1rem] font-bold leading-tight text-ink">{title}</p>
          <p className="text-[12px] leading-snug text-faint">{subtitle}</p>
        </div>
      </div>

      {/* Nền chìm để ô nhập không dính viền thẻ */}
      <div className="px-6 pb-1 pt-5">
        <div className="rounded-xl border border-[var(--border)] bg-subtle p-5">
          {children}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4">{footer}</div>
    </div>
  );
}

/** Lưới ô nhập — khoảng cách rộng, tự xuống dòng theo bề ngang. */
export function FormGrid({ cols = 3, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={`grid gap-x-5 gap-y-4 ${cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
      {children}
    </div>
  );
}

/** Thẻ danh sách bản ghi đã khai, tách hẳn khỏi khu nhập. */
export function ListPanel({ title, count, empty, children }: {
  title: string; count: number; empty: string; children: ReactNode;
}) {
  return (
    <div className="vl-card">
      <div className="mb-4 flex items-center gap-2.5">
        <p className="text-[13px] font-bold uppercase tracking-wide text-dim">{title}</p>
        <span className="rounded-md bg-subtle px-2 py-0.5 text-[11px] font-bold text-soft">{count}</span>
      </div>
      {count === 0 ? (
        <p className="py-10 text-center text-[13px] italic text-faint">{empty}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}
