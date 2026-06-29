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

interface ToastAction {
  text: string;
  onClick?: () => void;
}

export interface ToastOptions {
  duration?: number;          // ms, mặc định 3500
  autoClose?: boolean;        // mặc định true
  position?: ToastPosition;   // mặc định 'top right'
  progressBar?: boolean;      // mặc định true
  clickToClose?: boolean;     // bấm vào toast để đóng
  confirm?: { text: string; onConfirm?: () => void };
  cancel?: { text: string; onCancel?: () => void };
  onClose?: () => void;
}

interface ToastData extends Required<Pick<ToastOptions, 'duration' | 'autoClose' | 'position' | 'progressBar' | 'clickToClose'>> {
  id: number;
  type: ToastType;
  title?: string;
  message?: string;
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
  toasts = [
    ...toasts,
    {
      id,
      type,
      title,
      message,
      duration: opts.duration ?? 3500,
      autoClose: opts.autoClose ?? true,
      position: opts.position ?? 'top right',
      progressBar: opts.progressBar ?? true,
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

// Mỗi loại: biến màu (token) cho thanh accent / icon / progress.
const ACCENT: Record<ToastType, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  alert: 'var(--accent)',
};
const TINT: Record<ToastType, string> = {
  success: 'var(--success-soft)',
  error: 'var(--danger-soft)',
  warning: 'var(--warning-soft)',
  info: 'var(--info-soft)',
  alert: 'var(--accent-soft)',
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
  const accent = ACCENT[data.type];
  const off = enterOffset(data.position);

  // Tự đóng + tạm dừng khi rê chuột (đóng băng cả progress bar lẫn timer).
  const [paused, setPaused] = useState(false);
  const remaining = useRef(data.duration);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!data.autoClose) return;
    const run = () => {
      startedAt.current = Date.now();
      timer.current = setTimeout(() => dismiss(data.id), remaining.current);
    };
    if (!paused) run();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [paused, data.autoClose, data.id]);

  const onEnter = () => {
    if (!data.autoClose) return;
    if (timer.current) clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
    setPaused(true);
  };
  const onLeave = () => { if (data.autoClose) setPaused(false); };

  const hasActions = !!(data.confirm || data.cancel);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96, ...off }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, ...off }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={data.clickToClose ? () => dismiss(data.id) : undefined}
      role={data.type === 'error' || data.type === 'alert' ? 'alert' : 'status'}
      className={`pointer-events-auto relative w-[340px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[10px] bg-raised border border-[var(--border)] ${
        data.clickToClose ? 'cursor-pointer' : ''
      }`}
      style={{ boxShadow: 'var(--shadow-pop)', borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-start gap-3 p-3.5 pr-9">
        {/* Icon */}
        <span
          className="mt-0.5 grid h-7 w-7 shrink-0 place-content-center rounded-lg"
          style={{ background: TINT[data.type], color: accent }}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </span>

        {/* Nội dung */}
        <div className="min-w-0 flex-1 pt-0.5">
          {data.title && (
            <p className="text-[13px] font-bold leading-snug text-ink">{data.title}</p>
          )}
          {data.message && (
            <p className="mt-0.5 text-[12px] leading-snug text-soft">{data.message}</p>
          )}

          {hasActions && (
            <div className="mt-2.5 flex items-center gap-2">
              {data.confirm && (
                <button
                  onClick={(e) => { e.stopPropagation(); data.confirm?.onConfirm?.(); dismiss(data.id); }}
                  className="rounded-md px-2.5 py-1 text-[12px] font-bold text-[var(--on-accent)] transition-opacity hover:opacity-90 active:scale-[0.98]"
                  style={{ background: accent }}
                >
                  {data.confirm.text}
                </button>
              )}
              {data.cancel && (
                <button
                  onClick={(e) => { e.stopPropagation(); data.cancel?.onCancel?.(); dismiss(data.id); }}
                  className="rounded-md px-2.5 py-1 text-[12px] font-semibold text-soft transition-colors hover:bg-subtle hover:text-dim active:scale-[0.98]"
                >
                  {data.cancel.text}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(data.id); }}
        aria-label="Đóng thông báo"
        className="absolute right-2 top-2 grid h-6 w-6 place-content-center rounded-md text-faint transition-colors hover:bg-subtle hover:text-dim"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Progress bar */}
      {data.autoClose && data.progressBar && (
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: 'var(--border)' }}>
          <div
            className="h-full origin-left"
            style={{
              background: accent,
              animation: `toast-progress ${data.duration}ms linear forwards`,
              animationPlayState: paused ? 'paused' : 'running',
            }}
          />
        </div>
      )}
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
