/**
 * Toast notifications — control-room styled.
 *
 * Cảm hứng API từ SnapAlert (success/error/warning/info/alert, vị trí,
 * progress bar, confirm/cancel, tự đóng) nhưng dựng lại bằng React + token
 * design system của app: tự đổi sáng/tối, icon lucide, màu status theo token.
 *
 * Dùng ở bất cứ đâu (kể cả ngoài component):
 *   import { toast } from '../lib/toast';
 *   toast.success('Đã lưu', 'Biên bản đã được cập nhật.');
 *   toast.error('Lỗi', 'Không kết nối được máy chủ.', { duration: 5000 });
 *   toast.alert('Xác nhận xoá?', 'Hành động không thể hoàn tác.', {
 *     confirm: { text: 'Xoá', onConfirm: () => remove() },
 *     cancel:  { text: 'Huỷ' },
 *     autoClose: false,
 *   });
 *
 * Gắn <Toaster /> một lần ở App.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, AlertTriangle, Info, Bell, X,
  type LucideIcon,
} from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'alert';
export type ToastPosition =
  | 'top left' | 'top right' | 'top center'
  | 'bottom left' | 'bottom right' | 'bottom center';

export interface ToastOptions {
  duration?: number;          // ms, mặc định 3500
  autoClose?: boolean;        // mặc định true
  position?: ToastPosition;   // mặc định 'top right'
  clickToClose?: boolean;     // bấm vào toast để đóng
  /** Khoá chống trùng: chỉ giữ một toast cho mỗi key (lần sau thay lần trước). */
  key?: string;
  confirm?: { text: string; onConfirm?: () => void };
  cancel?: { text: string; onCancel?: () => void };
  onClose?: () => void;
}

interface ToastData extends Required<Pick<ToastOptions, 'duration' | 'autoClose' | 'position' | 'clickToClose'>> {
  id: number;
  type: ToastType;
  title?: string;
  message?: string;
  key?: string;
  confirm?: ToastOptions['confirm'];
  cancel?: ToastOptions['cancel'];
  onClose?: () => void;
}

/* ----------------------------- store ----------------------------- */

let seq = 0;
let toasts: ToastData[] = [];
const listeners = new Set<(t: ToastData[]) => void>();

function emit() {
  const snapshot = [...toasts];
  listeners.forEach(l => l(snapshot));
}

function dismiss(id: number) {
  const t = toasts.find(x => x.id === id);
  toasts = toasts.filter(x => x.id !== id);
  emit();
  t?.onClose?.();
}

function push(type: ToastType, title?: string, message?: string, opts: ToastOptions = {}): number {
  const id = ++seq;
  // Chống trùng: nếu có key, bỏ toast cũ cùng key trước khi thêm mới.
  const base = opts.key ? toasts.filter(t => t.key !== opts.key) : toasts;
  toasts = [
    ...base,
    {
      id,
      type,
      title,
      message,
      key: opts.key,
      duration: opts.duration ?? 3500,
      autoClose: opts.autoClose ?? true,
      position: opts.position ?? 'top right',
      clickToClose: opts.clickToClose ?? false,
      confirm: opts.confirm,
      cancel: opts.cancel,
      onClose: opts.onClose,
    },
  ];
  emit();
  return id;
}

export const toast = {
  success: (title?: string, message?: string, opts?: ToastOptions) => push('success', title, message, opts),
  error:   (title?: string, message?: string, opts?: ToastOptions) => push('error', title, message, opts),
  warning: (title?: string, message?: string, opts?: ToastOptions) => push('warning', title, message, opts),
  info:    (title?: string, message?: string, opts?: ToastOptions) => push('info', title, message, opts),
  alert:   (title?: string, message?: string, opts?: ToastOptions) => push('alert', title, message, opts),
  show:    (type: ToastType, title?: string, message?: string, opts?: ToastOptions) => push(type, title, message, opts),
  dismiss,
  /** Đóng toast theo key (nếu có). */
  dismissKey: (key: string) => { toasts = toasts.filter(t => t.key !== key); emit(); },
  clearAll: () => { toasts = []; emit(); },
};

/* ------------------------- visual config ------------------------- */

const ICONS: Record<ToastType, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  alert: Bell,
};

// Nền đặc kín cho mỗi loại — dùng chung token với .vl-alert (xem index.css).
const SOLID: Record<ToastType, string> = {
  success: 'var(--toast-success)',
  info: 'var(--toast-info)',
  warning: 'var(--toast-warning)',
  error: 'var(--toast-danger)',
  alert: 'var(--toast-alert)',
};

const POSITION_CLASS: Record<ToastPosition, string> = {
  'top left': 'top-0 left-0 items-start',
  'top right': 'top-0 right-0 items-end',
  'top center': 'top-0 left-1/2 -translate-x-1/2 items-center',
  'bottom left': 'bottom-0 left-0 items-start',
  'bottom right': 'bottom-0 right-0 items-end',
  'bottom center': 'bottom-0 left-1/2 -translate-x-1/2 items-center',
};

function enterOffset(pos: ToastPosition) {
  if (pos.includes('left')) return { x: -28, y: 0 };
  if (pos.includes('right')) return { x: 28, y: 0 };
  return { x: 0, y: pos.startsWith('top') ? -24 : 24 };
}

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/* --------------------------- one toast --------------------------- */

function ToastItem({ data }: { data: ToastData }) {
  const Icon = ICONS[data.type];
  const solid = SOLID[data.type];
  const off = enterOffset(data.position);

  // Tự đóng, tạm dừng khi rê chuột (không có thanh tiến trình hiển thị).
  const remaining = useRef(data.duration);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const start = () => {
    if (!data.autoClose) return;
    clear();
    startedAt.current = Date.now();
    timer.current = setTimeout(() => dismiss(data.id), remaining.current);
  };

  useEffect(() => {
    start();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEnter = () => {
    if (!data.autoClose) return;
    clear();
    remaining.current -= Date.now() - startedAt.current;
  };
  const onLeave = () => start();

  const hasActions = !!(data.confirm || data.cancel);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96, ...off }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, ...off }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={data.clickToClose ? () => dismiss(data.id) : undefined}
      role={data.type === 'error' || data.type === 'alert' ? 'alert' : 'status'}
      className={`pointer-events-auto relative flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-xl px-3.5 py-3 pr-10 text-white ${
        data.clickToClose ? 'cursor-pointer' : ''
      }`}
      style={{ background: solid, boxShadow: 'var(--shadow-pop)' }}
    >
      {/* Icon — chip tròn mềm */}
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-content-center rounded-full bg-white/20">
        <Icon className="h-[18px] w-[18px] text-white" strokeWidth={2.4} />
      </span>

      {/* Nội dung */}
      <div className="min-w-0 flex-1 pt-0.5">
        {data.title && (
          <p className="text-[13px] font-bold leading-snug text-white">{data.title}</p>
        )}
        {data.message && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-white/85">{data.message}</p>
        )}

        {hasActions && (
          <div className="mt-2.5 flex items-center gap-2">
            {data.confirm && (
              <button
                onClick={(e) => { e.stopPropagation(); data.confirm?.onConfirm?.(); dismiss(data.id); }}
                className="rounded-md bg-white px-2.5 py-1 text-[12px] font-bold transition-opacity hover:opacity-90 active:scale-[0.98]"
                style={{ color: solid }}
              >
                {data.confirm.text}
              </button>
            )}
            {data.cancel && (
              <button
                onClick={(e) => { e.stopPropagation(); data.cancel?.onCancel?.(); dismiss(data.id); }}
                className="rounded-md px-2.5 py-1 text-[12px] font-semibold text-white/90 underline transition-colors hover:bg-white/15 active:scale-[0.98]"
              >
                {data.cancel.text}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(data.id); }}
        aria-label="Đóng thông báo"
        className="absolute right-2 top-2.5 grid h-6 w-6 place-content-center rounded-md text-white/70 transition-colors hover:bg-white/15 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

/* ----------------------------- host ----------------------------- */

/** Gắn một lần ở App. Render mọi toast theo cụm vị trí, qua portal lên <body>. */
export function Toaster() {
  const [items, setItems] = useState<ToastData[]>([]);

  useEffect(() => {
    const l = (t: ToastData[]) => setItems(t);
    listeners.add(l);
    setItems([...toasts]);
    return () => { listeners.delete(l); };
  }, []);

  if (typeof document === 'undefined') return null;

  const positions = Object.keys(POSITION_CLASS) as ToastPosition[];

  return createPortal(
    <>
      {positions.map(pos => {
        const group = items.filter(t => t.position === pos);
        if (group.length === 0) return null;
        const ordered = pos.startsWith('bottom') ? [...group].reverse() : group;
        return (
          <div
            key={pos}
            className={`pointer-events-none fixed z-[9999] flex flex-col gap-2.5 p-4 ${POSITION_CLASS[pos]}`}
          >
            <AnimatePresence initial={false}>
              {ordered.map(t => <ToastItem key={t.id} data={t} />)}
            </AnimatePresence>
          </div>
        );
      })}
    </>,
    document.body,
  );
}
