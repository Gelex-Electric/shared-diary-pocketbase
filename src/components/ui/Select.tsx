/**
 * Select — dropdown tùy biến đồng bộ design system (thay cho <select> native).
 * Cùng "ngôn ngữ" với DatePicker: panel bo tròn, accent var(--accent), outside-click,
 * shadow mềm. Hỗ trợ biến thể 'bare' (nhúng vào container có sẵn) và tìm kiếm.
 *
 * Menu render qua PORTAL (position: fixed) để không bị cắt bởi `overflow-hidden`
 * của card cha — luôn nổi trên cùng dù card nhỏ.
 */
import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  /** 'bare' = trigger trong suốt, không viền (lồng vào container tùy biến) */
  variant?: 'default' | 'bare';
  /** Hiện ô tìm kiếm ở đầu panel (danh sách dài) */
  searchable?: boolean;
  /** Icon trái tùy chọn */
  icon?: React.ElementType;
}

interface MenuPos { top: number; left: number; width: number; }

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Chọn...',
  label,
  className = '',
  disabled = false,
  variant = 'default',
  searchable = false,
  icon: Icon,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<MenuPos | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);

  /* Tính vị trí menu từ trigger — clamp trong viewport để không tràn phải/dưới */
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 200);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 6, left, width });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  /* Đóng khi click ngoài (cả trigger lẫn panel) */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onReflow = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true); // capture: theo mọi khung cuộn
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, place]);

  /* Focus ô tìm kiếm + reset query khi mở */
  useEffect(() => {
    if (open) { setQuery(''); if (searchable) setTimeout(() => searchRef.current?.focus(), 0); }
  }, [open, searchable]);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const pick = (val: string) => { onChange(val); setOpen(false); };

  const triggerBase =
    'relative flex items-center gap-2 w-full text-sm font-bold cursor-pointer select-none transition-all';
  const triggerSkin = variant === 'bare'
    ? 'bg-transparent'
    : `px-3 py-2 bg-surface border rounded-lg ${
        open ? 'ring-2 ring-accent border-accent' : 'border-[var(--border)] hover:border-accent/50'
      }`;

  return (
    <div className={`relative ${variant === 'bare' ? '' : 'space-y-1'} ${className}`}>
      {label && (
        <label className="text-[10px] font-bold text-faint uppercase select-none pointer-events-none block">
          {label}
        </label>
      )}

      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`${triggerBase} ${triggerSkin} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${open ? 'text-accent' : 'text-faint'}`} />}
        <span className={`flex-1 min-w-0 truncate ${selected ? 'text-dim' : 'text-faint font-normal'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180 text-accent' : ''}`}
        />
      </div>

      {/* Panel — portal ra body, position fixed, nổi trên card */}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] bg-raised rounded-xl overflow-hidden border border-[var(--border)] animate-in fade-in slide-in-from-top-2 duration-150"
          style={{ top: pos.top, left: pos.left, width: pos.width, boxShadow: 'var(--shadow-pop)' }}
          onClick={e => e.stopPropagation()}
        >
          {searchable && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
              <Search className="w-3.5 h-3.5 text-faint shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Tìm kiếm..."
                className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-faint"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-faint italic">Không có kết quả</div>
            ) : (
              filtered.map(o => {
                const isSel = o.value === value;
                return (
                  <button
                    key={o.value}
                    onClick={() => pick(o.value)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isSel
                        ? 'bg-accent text-white font-bold'
                        : 'text-dim font-medium hover:bg-accent-soft hover:text-accent'
                    }`}
                  >
                    <span className="flex-1 min-w-0 truncate">{o.label}</span>
                    {isSel && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
