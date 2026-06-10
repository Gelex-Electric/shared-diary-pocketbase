/**
 * Select — dropdown tùy biến đồng bộ design system (thay cho <select> native).
 * Cùng "ngôn ngữ" với DatePicker: panel bo tròn, accent #5a8dee, outside-click,
 * shadow mềm. Hỗ trợ biến thể 'bare' (nhúng vào container có sẵn) và tìm kiếm.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);

  /* Đóng khi click ngoài */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* Đóng bằng Escape */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

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
    : `px-3 py-2 bg-white border rounded-lg ${
        open ? 'ring-2 ring-[#5a8dee] border-[#5a8dee]' : 'border-slate-200 hover:border-[#5a8dee]/50'
      }`;

  return (
    <div ref={wrapperRef} className={`relative ${variant === 'bare' ? '' : 'space-y-1'} ${className}`}>
      {label && (
        <label className="text-[10px] font-bold text-slate-400 uppercase select-none pointer-events-none">
          {label}
        </label>
      )}

      {/* Trigger */}
      <div
        onClick={() => !disabled && setOpen(o => !o)}
        className={`${triggerBase} ${triggerSkin} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${open ? 'text-[#5a8dee]' : 'text-slate-400'}`} />}
        <span className={`flex-1 min-w-0 truncate ${selected ? 'text-slate-700' : 'text-slate-400 font-normal'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-[#5a8dee]' : ''}`}
        />
      </div>

      {/* Panel */}
      {open && (
        <div
          className="absolute top-full mt-1.5 left-0 right-0 z-[200] bg-white rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
          style={{ boxShadow: 'var(--vl-card-shadow)', minWidth: 200 }}
          onClick={e => e.stopPropagation()}
        >
          {searchable && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Tìm kiếm..."
                className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-300"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400 italic">Không có kết quả</div>
            ) : (
              filtered.map(o => {
                const isSel = o.value === value;
                return (
                  <button
                    key={o.value}
                    onClick={() => pick(o.value)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isSel
                        ? 'bg-[#5a8dee] text-white font-bold'
                        : 'text-slate-600 font-medium hover:bg-[#e8f3ff] hover:text-[#5a8dee]'
                    }`}
                  >
                    <span className="flex-1 min-w-0 truncate">{o.label}</span>
                    {isSel && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
