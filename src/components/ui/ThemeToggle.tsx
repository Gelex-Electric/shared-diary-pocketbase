import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../lib/theme';

/** Light/dark switch for the control-room UI. Sits in the top navbar. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
      aria-label={isDark ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'}
      className={`p-2 rounded-full transition-colors text-soft hover:text-ink hover:bg-subtle active:scale-95 ${className}`}
    >
      {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
    </button>
  );
}
