import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Trash2, X, CheckCircle2 } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_CFG = {
  danger: {
    ring:    'bg-red-100',
    icon:    <Trash2 className="w-8 h-8 text-red-500" />,
    btnCls:  'bg-red-500 hover:bg-red-600 shadow-red-300/40',
  },
  warning: {
    ring:    'bg-amber-100',
    icon:    <AlertTriangle className="w-8 h-8 text-amber-500" />,
    btnCls:  'bg-amber-500 hover:bg-amber-600 shadow-amber-300/40',
  },
  info: {
    ring:    'bg-blue-100',
    icon:    <CheckCircle2 className="w-8 h-8 text-blue-500" />,
    btnCls:  'bg-[#5a8dee] hover:bg-blue-600 shadow-blue-300/40',
  },
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Xác nhận',
  cancelLabel  = 'Hủy bỏ',
  variant      = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cfg = VARIANT_CFG[variant];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
          >
            {/* Close */}
            <button
              onClick={onCancel}
              className="absolute top-3 right-3 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Body */}
            <div className="px-8 pt-10 pb-8 flex flex-col items-center text-center gap-4">
              {/* Icon circle */}
              <div className={`w-20 h-20 rounded-full ${cfg.ring} flex items-center justify-center`}>
                {cfg.icon}
              </div>

              <div className="space-y-1.5">
                <h3 className="text-lg font-extrabold text-slate-800 leading-snug">{title}</h3>
                {message && (
                  <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="px-8 pb-8 flex items-center gap-3">
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 py-2.5 rounded-xl text-white font-bold text-sm shadow-lg transition-all active:scale-95 ${cfg.btnCls}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ── Hook tiện lợi ── */
export function useConfirm() {
  const [state, setState] = React.useState<{
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    variant?: ConfirmVariant;
    resolve?: (v: boolean) => void;
  }>({ open: false, title: '' });

  const confirm = React.useCallback(
    (opts: { title: string; message?: string; confirmLabel?: string; variant?: ConfirmVariant }) =>
      new Promise<boolean>(resolve => {
        setState({ ...opts, open: true, resolve });
      }),
    [],
  );

  const handleConfirm = () => {
    state.resolve?.(true);
    setState(s => ({ ...s, open: false }));
  };
  const handleCancel = () => {
    state.resolve?.(false);
    setState(s => ({ ...s, open: false }));
  };

  const dialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      variant={state.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, dialog };
}
