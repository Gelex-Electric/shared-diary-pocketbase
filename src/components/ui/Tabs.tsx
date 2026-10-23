import { useId } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Tooltip phụ (tuỳ chọn) */
  sub?: string;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  /** Trải đều full-width, mỗi tab chiếm phần bằng nhau (dùng cho form/đăng nhập). */
  fluid?: boolean;
  /** Màn nhỏ (< sm) chỉ hiện icon, nhãn chuyển vào tooltip/aria-label. Mặc định tắt. */
  iconOnlyOnMobile?: boolean;
}

/**
 * Thanh tab ngang dùng chung — kiểu segmented (control-room).
 * Chỉ báo (indicator) là một viên nền trượt mượt giữa các tab nhờ
 * `layoutId` của motion. Dùng thống nhất cho mọi trang có tab ngang.
 */
export function Tabs<T extends string>({ tabs, value, onChange, className = '', fluid = false, iconOnlyOnMobile = false }: TabsProps<T>) {
  // layoutId riêng cho mỗi instance để các thanh tab khác nhau không "trượt" vào nhau.
  const layoutId = useId();

  return (
    <div
      role="tablist"
      className={`${fluid ? 'flex w-full' : 'inline-flex flex-wrap'} gap-1 rounded-xl border border-[var(--border)] bg-subtle p-1 ${className}`}
    >
      {tabs.map(t => {
        const Icon = t.icon;
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.sub ?? (iconOnlyOnMobile ? t.label : undefined)}
            aria-label={iconOnlyOnMobile ? t.label : undefined}
            onClick={() => onChange(t.id)}
            className={`group relative flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
              fluid ? 'flex-1' : ''
            }`}
          >
            {/* Viên nền trượt cho tab đang chọn */}
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-surface"
                style={{ boxShadow: 'var(--shadow-card)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span
              className={`relative z-10 flex items-center gap-2 transition-colors ${
                active ? 'text-accent' : 'text-soft group-hover:text-dim'
              }`}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span className={iconOnlyOnMobile && Icon ? 'hidden sm:inline' : undefined}>{t.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
