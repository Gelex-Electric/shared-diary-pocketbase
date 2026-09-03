/**
 * Thanh gạt 2 trạng thái — cả hai nhãn luôn hiện, viên nền trượt sang bên đang
 * chọn (cùng ngôn ngữ chuyển động với `ui/Tabs`, dùng `layoutId` của motion).
 *
 * Dùng cho các cặp lựa chọn loại trừ nhau mà người dùng cần thấy ngay cả hai
 * phương án: Trực tiếp/Gián tiếp, Chính/Phụ.
 *
 * Vì sao không dùng công tắc bật/tắt thường: cả hai phía đều là giá trị nghiệp
 * vụ có tên, không phải bật/tắt — giấu một nhãn đi sẽ phải đoán.
 */
import { useId } from 'react';
import { motion } from 'motion/react';

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** Màu nhấn khi được chọn; bỏ trống thì dùng màu accent của app. */
  hex?: string;
}

interface ToggleProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: [ToggleOption<T>, ToggleOption<T>];
  disabled?: boolean;
  className?: string;
}

export function Toggle<T extends string>({
  value, onChange, options, disabled = false, className = '',
}: ToggleProps<T>) {
  const layoutId = useId();

  return (
    <div
      role="radiogroup"
      className={`inline-flex w-full gap-1 rounded-lg border border-[var(--border)] bg-subtle p-1 ${
        disabled ? 'pointer-events-none opacity-50' : ''
      } ${className}`}
    >
      {options.map(o => {
        const active = o.value === value;
        const hex = o.hex;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="relative flex-1 rounded-md px-3 py-2 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md bg-surface"
                style={{ boxShadow: 'var(--shadow-card)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span
              className={`relative z-10 ${active ? '' : 'text-soft'}`}
              style={active ? { color: hex ?? 'var(--accent)' } : undefined}
            >
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
