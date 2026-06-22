/**
 * DatePicker & TimePicker — Pure React + Tailwind
 * Không dùng flatpickr để tránh dialog thừa, kiểm soát layout hoàn toàn.
 */
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

/* ============================================================
   HELPERS / CONSTANTS
============================================================ */
const p2 = (n: number) => String(n).padStart(2, '0');

const VN_MONTHS = [
  'Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
  'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12',
];

// Tuần bắt đầu Thứ Hai
const VN_WEEKDAYS = ['T2','T3','T4','T5','T6','T7','CN'];

function getDaysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

/** Vị trí ngày đầu tháng (0 = Thứ Hai, …, 6 = Chủ Nhật) */
function firstDayOffset(y: number, m: number) {
  const d = new Date(y, m, 1).getDay(); // 0=Sun
  return d === 0 ? 6 : d - 1;
}

/* ============================================================
   DATE PICKER
   value = "YYYY-MM-DD" | onChange(val: "YYYY-MM-DD")
   Hiển thị: dd/mm/yyyy
============================================================ */
interface DatePickerProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  className?: string;
  /** Render dropdown qua portal (document.body) với position: fixed — dùng khi
   *  picker nằm trong card/bảng có overflow-hidden/overflow-auto khiến dropdown bị che. */
  usePortal?: boolean;
}

export function DatePicker({ value, onChange, label, className = '', usePortal = false }: DatePickerProps) {
  const today = new Date();

  const parse = (v: string) => {
    if (!v) return null;
    const [y, mo, d] = v.split('-').map(Number);
    return { y, mo: mo - 1, d };
  };

  const parsed = parse(value);

  const [open,      setOpen]      = useState(false);
  const [viewYear,  setViewYear]  = useState(parsed?.y  ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.mo ?? today.getMonth());
  // null = chưa đo được vị trí → chưa render dropdown (tránh "nhảy" từ góc 0,0)
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // Giá trị gõ tay trong ô (dd/mm/yyyy)
  const [text, setText] = useState('');

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  /* Tính vị trí khi mở (chế độ portal): bám theo trigger, lật lên nếu không đủ chỗ dưới.
     Đo ngay trong useLayoutEffect (trước khi browser paint) nên dropdown xuất hiện
     thẳng đúng chỗ, không bị bay nhảy. Theo dõi scroll/resize để bám trigger. */
  useLayoutEffect(() => {
    if (!usePortal || !open) { setPortalPos(null); return; }
    const measure = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownH = 360;
      const openUp = rect.bottom + dropdownH > window.innerHeight && rect.top > dropdownH;
      setPortalPos({
        top: openUp ? rect.top - dropdownH - 6 : rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [usePortal, open]);

  /* Đóng khi click ngoài */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (usePortal && portalRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, usePortal]);

  /* Đồng bộ view + ô gõ tay khi value thay đổi từ ngoài */
  useEffect(() => {
    const p = parse(value);
    if (p) { setViewYear(p.y); setViewMonth(p.mo); }
    setText(p ? `${p2(p.d)}/${p2(p.mo + 1)}/${p.y}` : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /* Tự chèn dấu "/" khi gõ: ddmmyyyy → dd/mm/yyyy */
  const formatTyped = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return d;
  };

  /* Kiểm tra & commit chuỗi dd/mm/yyyy hợp lệ → trả về YYYY-MM-DD; false nếu sai */
  const tryCommitTyped = (str: string) => {
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return false;
    const d = +m[1], mo = +m[2], y = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > getDaysInMonth(y, mo - 1)) return false;
    onChange(`${y}-${p2(mo)}-${p2(d)}`);
    setViewYear(y);
    setViewMonth(mo - 1);
    return true;
  };

  const onTypedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = formatTyped(e.target.value);
    setText(f);
    if (f.length === 10) tryCommitTyped(f);
  };

  const onTypedBlur = () => {
    if (text.trim() === '') { onChange(''); return; }
    if (!tryCommitTyped(text)) setText(displayVal); // sai định dạng → khôi phục
  };

  const selectDay = (d: number) => {
    onChange(`${viewYear}-${p2(viewMonth + 1)}-${p2(d)}`);
    setOpen(false);
  };

  const goToday = () => {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    onChange(`${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`);
    setOpen(false);
  };

  const prevYear  = (e: React.MouseEvent) => { e.stopPropagation(); setViewYear(y => y - 1); };
  const nextYear  = (e: React.MouseEvent) => { e.stopPropagation(); setViewYear(y => y + 1); };
  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  /* Xây dựng grid ngày */
  const totalDays   = getDaysInMonth(viewYear, viewMonth);
  const offset      = firstDayOffset(viewYear, viewMonth);
  const prevDays    = getDaysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1);

  type Cell = { day: number; kind: 'prev' | 'cur' | 'next' };
  const cells: Cell[] = [];
  for (let i = offset - 1; i >= 0; i--)     cells.push({ day: prevDays - i, kind: 'prev' });
  for (let d = 1; d <= totalDays; d++)       cells.push({ day: d,           kind: 'cur'  });
  while (cells.length % 7 !== 0)             cells.push({ day: cells.length - totalDays - offset + 1, kind: 'next' });

  const isSel = (d: number) =>
    parsed && parsed.y === viewYear && parsed.mo === viewMonth && parsed.d === d;
  const isTd  = (d: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;

  const displayVal = parsed ? `${p2(parsed.d)}/${p2(parsed.mo + 1)}/${parsed.y}` : '';

  return (
    <div ref={wrapperRef} className={`space-y-1 relative ${className}`}>
      {label && (
        <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 select-none pointer-events-none">
          <Calendar className="w-3 h-3" /> {label}
        </label>
      )}

      {/* Trigger input — cho phép gõ tay dd/mm/yyyy */}
      <div
        ref={triggerRef}
        className={`relative flex items-center gap-2 w-full pl-2.5 pr-3 py-2 bg-white border rounded-lg
                    text-sm font-bold transition-all
                    ${open
                      ? 'ring-2 ring-[#5a8dee] border-[#5a8dee]'
                      : 'border-slate-200 hover:border-[#5a8dee]/50 focus-within:ring-2 focus-within:ring-[#5a8dee] focus-within:border-[#5a8dee]'}`}
      >
        <Calendar
          onClick={() => setOpen(o => !o)}
          className={`w-4 h-4 shrink-0 cursor-pointer ${open ? 'text-[#5a8dee]' : 'text-slate-400'}`}
        />
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={onTypedChange}
          onFocus={() => setOpen(true)}
          onBlur={onTypedBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (tryCommitTyped(text)) setOpen(false); }
            else if (e.key === 'Escape') { setText(displayVal); setOpen(false); }
          }}
          placeholder="dd/mm/yyyy"
          className="flex-1 min-w-0 bg-transparent outline-none text-slate-700 placeholder:text-slate-300 placeholder:font-normal"
        />
      </div>

      {/* Dropdown calendar — ở chế độ portal phải đo xong vị trí (portalPos) mới render */}
      {open && (!usePortal || portalPos) && (() => {
        const dropdown = (
          <div
            ref={portalRef}
            className={usePortal
              ? 'fixed z-[200] bg-white rounded-2xl overflow-hidden animate-in fade-in duration-150'
              : 'absolute top-full mt-1.5 left-0 z-[200] bg-white rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150'}
            style={usePortal
              ? { boxShadow: '-8px 12px 28px 0 rgba(25,42,70,0.2)', minWidth: 270, top: portalPos!.top, left: portalPos!.left }
              : { boxShadow: '-8px 12px 28px 0 rgba(25,42,70,0.2)', minWidth: 270 }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── Hàng Năm ── */}
            <div className="flex items-center justify-between bg-[#5a8dee] px-3 py-2">
              <button
                onClick={prevYear}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-white font-extrabold text-sm tracking-wide">{viewYear}</span>
              <button
                onClick={nextYear}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* ── Hàng Tháng ── */}
            <div className="flex items-center justify-between bg-[#4880e8] px-3 py-2">
              <button
                onClick={prevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-white font-semibold text-sm">{VN_MONTHS[viewMonth]}</span>
              <button
                onClick={nextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* ── Header ngày trong tuần ── */}
            <div className="grid grid-cols-7 bg-[#e8f3ff] px-3 py-1.5">
              {VN_WEEKDAYS.map(wd => (
                <div key={wd} className="text-center text-[10px] font-extrabold text-[#5a8dee]">{wd}</div>
              ))}
            </div>

            {/* ── Grid ngày ── */}
            <div className="grid grid-cols-7 gap-y-0.5 px-3 py-2">
              {cells.map((cell, i) => {
                const sel = cell.kind === 'cur' && isSel(cell.day);
                const td  = cell.kind === 'cur' && isTd(cell.day);
                return (
                  <button
                    key={i}
                    onClick={() => cell.kind === 'cur' && selectDay(cell.day)}
                    disabled={cell.kind !== 'cur'}
                    className={[
                      'mx-auto w-8 h-8 rounded-full text-xs flex items-center justify-center transition-all',
                      cell.kind !== 'cur'
                        ? 'text-slate-300 cursor-default'
                        : 'cursor-pointer',
                      sel
                        ? 'bg-[#5a8dee] text-white font-bold shadow-md shadow-[#5a8dee]/40'
                        : td
                          ? 'border-2 border-[#5a8dee] text-[#5a8dee] font-bold'
                          : cell.kind === 'cur'
                            ? 'text-slate-600 font-medium hover:bg-[#e8f3ff] hover:text-[#5a8dee]'
                            : '',
                    ].join(' ')}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {/* ── Nút Hôm Nay ── */}
            <div className="px-3 pb-3 pt-1">
              <button
                onClick={goToday}
                className="w-full py-1.5 bg-[#5a8dee] text-white text-xs font-bold rounded-lg
                           hover:bg-[#4a7de2] active:scale-[0.98] transition-all"
              >
                Hôm Nay
              </button>
            </div>
          </div>
        );
        return usePortal ? createPortal(dropdown, document.body) : dropdown;
      })()}
    </div>
  );
}

/* ============================================================
   MONTH PICKER — đồng bộ phong cách với DatePicker
   value = "YYYY-MM"  | onChange(val: "YYYY-MM")
   Hỗ trợ tuỳ chọn "Tất cả" (allowAll) → value = "all"
   Hiển thị: Tháng MM/YYYY
============================================================ */
const MONTHS_SHORT = [
  'Th1','Th2','Th3','Th4','Th5','Th6',
  'Th7','Th8','Th9','Th10','Th11','Th12',
];

interface MonthPickerProps {
  value: string;                 // "YYYY-MM" | "all"
  onChange: (val: string) => void;
  label?: string;
  className?: string;
  allowAll?: boolean;            // hiển thị nút "Tất cả các tháng" → value "all"
  allLabel?: string;
}

export function MonthPicker({
  value, onChange, label, className = '',
  allowAll = false, allLabel = 'Tất cả các tháng',
}: MonthPickerProps) {
  const today = new Date();

  const isAll = allowAll && (value === 'all' || value === '');
  const parse = (v: string) => {
    if (!v || v === 'all') return null;
    const [y, mo] = v.split('-').map(Number);
    return { y, mo: mo - 1 };
  };
  const parsed = parse(value);

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.y ?? today.getFullYear());
  const wrapperRef = useRef<HTMLDivElement>(null);

  /* Đóng khi click ngoài */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* Đồng bộ view khi value đổi từ ngoài */
  useEffect(() => {
    const p = parse(value);
    if (p) setViewYear(p.y);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const selectMonth = (mo: number) => {
    onChange(`${viewYear}-${p2(mo + 1)}`);
    setOpen(false);
  };
  const goThisMonth = () => {
    const t = new Date();
    setViewYear(t.getFullYear());
    onChange(`${t.getFullYear()}-${p2(t.getMonth() + 1)}`);
    setOpen(false);
  };
  const selectAll = () => { onChange('all'); setOpen(false); };

  const prevYear = (e: React.MouseEvent) => { e.stopPropagation(); setViewYear(y => y - 1); };
  const nextYear = (e: React.MouseEvent) => { e.stopPropagation(); setViewYear(y => y + 1); };

  const isSel = (mo: number) => parsed && parsed.y === viewYear && parsed.mo === mo;
  const isCur = (mo: number) => today.getFullYear() === viewYear && today.getMonth() === mo;

  const displayVal = isAll
    ? allLabel
    : parsed ? `Tháng ${p2(parsed.mo + 1)}/${parsed.y}` : '';

  return (
    <div ref={wrapperRef} className={`space-y-1 relative ${className}`}>
      {label && (
        <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 select-none pointer-events-none">
          <Calendar className="w-3 h-3" /> {label}
        </label>
      )}

      {/* Trigger input */}
      <div
        onClick={() => setOpen(o => !o)}
        className={`relative flex items-center gap-2 w-full pl-2.5 pr-3 py-2 bg-white border rounded-lg
                    text-sm font-bold cursor-pointer select-none transition-all
                    ${open
                      ? 'ring-2 ring-[#5a8dee] border-[#5a8dee]'
                      : 'border-slate-200 hover:border-[#5a8dee]/50'}`}
      >
        <Calendar className={`w-4 h-4 shrink-0 ${open ? 'text-[#5a8dee]' : 'text-slate-400'}`} />
        <span className={displayVal ? 'text-slate-700' : 'text-slate-300 font-normal'}>
          {displayVal || 'Chọn tháng'}
        </span>
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full mt-1.5 left-0 z-[200] bg-white rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
          style={{ boxShadow: '-8px 12px 28px 0 rgba(25,42,70,0.2)', minWidth: 240 }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Hàng Năm ── */}
          <div className="flex items-center justify-between bg-[#5a8dee] px-3 py-2">
            <button
              onClick={prevYear}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white hover:bg-white/20 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-white font-extrabold text-sm tracking-wide">{viewYear}</span>
            <button
              onClick={nextYear}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white hover:bg-white/20 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* ── Grid 12 tháng ── */}
          <div className="grid grid-cols-3 gap-1.5 px-3 py-3">
            {MONTHS_SHORT.map((m, idx) => {
              const sel = isSel(idx);
              const cur = isCur(idx);
              return (
                <button
                  key={m}
                  onClick={() => selectMonth(idx)}
                  className={[
                    'h-9 rounded-lg text-xs font-bold flex items-center justify-center transition-all',
                    sel
                      ? 'bg-[#5a8dee] text-white shadow-md shadow-[#5a8dee]/40'
                      : cur
                        ? 'border-2 border-[#5a8dee] text-[#5a8dee]'
                        : 'text-slate-600 hover:bg-[#e8f3ff] hover:text-[#5a8dee]',
                  ].join(' ')}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* ── Footer ── */}
          <div className="px-3 pb-3 pt-1 flex gap-2">
            {allowAll && (
              <button
                onClick={selectAll}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-[0.98]
                           ${isAll
                             ? 'bg-[#5a8dee] text-white'
                             : 'bg-[#e8f3ff] text-[#5a8dee] hover:bg-[#d8ebff]'}`}
              >
                Tất cả
              </button>
            )}
            <button
              onClick={goThisMonth}
              className="flex-1 py-1.5 bg-[#5a8dee] text-white text-xs font-bold rounded-lg
                         hover:bg-[#4a7de2] active:scale-[0.98] transition-all"
            >
              Tháng này
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TIME PICKER — nhập trực tiếp từ bàn phím, không popup
   value = "HH:mm"  |  onChange(val: "HH:mm")
   UX: focus → chọn hết → gõ đè | Tab/Enter chuyển sang phút
============================================================ */
interface TimePickerProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  className?: string;
}

export function TimePicker({ value, onChange, label, className = '' }: TimePickerProps) {
  const [h, setH] = useState('00');
  const [m, setM] = useState('00');
  const minRef = useRef<HTMLInputElement>(null);

  /* Đồng bộ khi value thay đổi từ ngoài */
  useEffect(() => {
    const parts = (value || '00:00').split(':');
    setH(p2(Math.max(0, Math.min(23, parseInt(parts[0] ?? '0', 10) || 0))));
    setM(p2(Math.max(0, Math.min(59, parseInt(parts[1] ?? '0', 10) || 0))));
  }, [value]);

  /* Commit giờ: chuẩn hoá rồi gọi onChange */
  const commitH = (raw: string) => {
    const n  = Math.max(0, Math.min(23, parseInt(raw, 10) || 0));
    const hh = p2(n);
    setH(hh);
    onChange(`${hh}:${m}`);
    return hh;
  };

  /* Commit phút */
  const commitM = (raw: string) => {
    const n  = Math.max(0, Math.min(59, parseInt(raw, 10) || 0));
    const mm = p2(n);
    setM(mm);
    onChange(`${h}:${mm}`);
    return mm;
  };

  /* Xử lý gõ giờ: tự chuyển sang phút khi gõ đủ 2 chữ số hợp lệ */
  const onHChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 2);
    setH(v);
    if (v.length === 2 && parseInt(v, 10) <= 23) {
      minRef.current?.focus();
      minRef.current?.select();
    }
  };

  const onMChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 2);
    setM(v);
  };

  /* Phím mũi tên tăng/giảm nhanh */
  const onHKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp')   { e.preventDefault(); const n = p2(Math.min(23, (parseInt(h,10)||0)+1)); setH(n); onChange(`${n}:${m}`); }
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = p2(Math.max(0,  (parseInt(h,10)||0)-1)); setH(n); onChange(`${n}:${m}`); }
    if (e.key === 'Tab' || e.key === 'Enter') { commitH(h); }
  };

  const onMKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp')   { e.preventDefault(); const n = p2(Math.min(59, (parseInt(m,10)||0)+1)); setM(n); onChange(`${h}:${n}`); }
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = p2(Math.max(0,  (parseInt(m,10)||0)-1)); setM(n); onChange(`${h}:${n}`); }
    if (e.key === 'Enter') { commitM(m); }
  };

  const inputCls = `w-7 text-center text-sm font-bold text-[#5a8dee] bg-transparent outline-none
                    focus:bg-[#e8f3ff] focus:rounded transition-colors tabular-nums`;

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 select-none">
          <Clock className="w-3 h-3" /> {label}
        </label>
      )}

      {/* Container giống input thường, chứa 2 ô nhập bên trong */}
      <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded-lg
                      px-2.5 py-2 transition-colors
                      focus-within:ring-2 focus-within:ring-[#5a8dee] focus-within:border-[#5a8dee]
                      hover:border-[#5a8dee]/50">
        <Clock className="w-4 h-4 text-slate-400 shrink-0 mr-1" />

        {/* Giờ */}
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={h}
          onFocus={e => e.target.select()}
          onChange={onHChange}
          onBlur={e => commitH(e.target.value)}
          onKeyDown={onHKey}
          className={inputCls}
          aria-label="Giờ (0–23)"
        />

        <span className="text-[#5a8dee] font-extrabold text-sm select-none leading-none">:</span>

        {/* Phút */}
        <input
          ref={minRef}
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={m}
          onFocus={e => e.target.select()}
          onChange={onMChange}
          onBlur={e => commitM(e.target.value)}
          onKeyDown={onMKey}
          className={inputCls}
          aria-label="Phút (0–59)"
        />
      </div>
    </div>
  );
}
