/**
 * Thanh trượt BẬT/TẮT — viên tròn trượt sang phải khi bật.
 *
 * Khác `ui/Toggle`: Toggle dành cho cặp giá trị nghiệp vụ đều có tên và cần
 * thấy cả hai (Trực tiếp/Gián tiếp, Chính/Phụ) nên luôn hiện 2 nhãn. Switch
 * này dành cho đúng nghĩa bật/tắt một thuộc tính — nhãn phụ nằm ngoài, gọn đủ
 * để đặt vừa một ô trong bảng.
 *
 * Dùng chung ngôn ngữ chuyển động (motion spring) với Toggle và Tabs.
 */
import { motion } from 'motion/react';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Nhãn hiện bên phải; bỏ trống thì chỉ có thanh trượt. */
  label?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function Switch({
  checked, onChange, label, disabled = false, title, className = '',
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-full ${
        disabled ? 'pointer-events-none opacity-50' : ''
      } ${className}`}
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-[var(--border)] transition-colors ${
          checked ? '' : 'bg-subtle'
        }`}
        style={checked ? { backgroundColor: 'var(--accent)' } : undefined}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className="absolute h-3.5 w-3.5 rounded-full bg-surface"
          style={{ boxShadow: 'var(--shadow-card)', left: checked ? 'calc(100% - 1.125rem)' : '0.125rem' }}
        />
      </span>
      {label && (
        <span className={`text-xs font-bold ${checked ? 'text-ink' : 'text-faint'}`}>{label}</span>
      )}
    </button>
  );
}
