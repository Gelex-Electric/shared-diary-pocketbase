import React, { useState } from 'react';
import { pb } from '../lib/pocketbase';
import { toast } from '../lib/toast';
import { motion, AnimatePresence } from 'motion/react';
import { User, Lock, Eye, EyeOff, AlertCircle, Zap, Activity, Briefcase, ArrowRight } from 'lucide-react';
import { Tabs, type TabItem } from './ui/Tabs';
import ThemeToggle from './ui/ThemeToggle';

type LoginMode = 'operation' | 'business';

const APP_NAME = 'Phần mềm Kỹ thuật - Kinh Doanh';

const MODE_CONFIG: Record<LoginMode, { label: string; subtitle: string; footer: string }> = {
  operation: {
    label: 'Nhóm Vận Hành',
    subtitle: 'Khu vực dành cho nhóm vận hành kỹ thuật',
    footer: 'Chỉ dành cho thành viên nhóm vận hành',
  },
  business: {
    label: 'Nhóm Văn Phòng',
    subtitle: 'Khu vực dành cho nhóm văn phòng / kinh doanh',
    footer: 'Chỉ dành cho tài khoản nhóm văn phòng',
  },
};

const MODE_TABS: TabItem<LoginMode>[] = [
  { id: 'operation', label: 'Nhóm Vận Hành', icon: Activity },
  { id: 'business',  label: 'Nhóm Văn Phòng', icon: Briefcase },
];

export default function Login() {
  const [mode, setMode] = useState<LoginMode>('operation');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const cfg = MODE_CONFIG[mode];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Vui lòng nhập đầy đủ thông tin!');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      await pb.collection('users').authWithPassword(username, password);

      // Phân loại khối theo field 'area': có area = Vận hành, trống = Văn phòng.
      const rawArea = pb.authStore.model?.area;
      const accountIsBusiness = !rawArea || (typeof rawArea === 'string' && !rawArea.trim());
      const accountMode: LoginMode = accountIsBusiness ? 'business' : 'operation';

      // Chặn đăng nhập nếu khối tài khoản không khớp tab đang chọn.
      if (accountMode !== mode) {
        pb.authStore.clear();
        setError(
          mode === 'business'
            ? 'Tài khoản này thuộc Nhóm Vận Hành. Vui lòng đăng nhập ở tab "Nhóm Vận Hành".'
            : 'Tài khoản này thuộc Nhóm Văn Phòng. Vui lòng đăng nhập ở tab "Nhóm Văn Phòng".'
        );
        return;
      }

      try { localStorage.setItem('loginMode', mode); } catch { /* ignore */ }

      const who = pb.authStore.model?.name || username;
      toast.success('Đăng nhập thành công', `Xin chào, ${who}.`, { position: 'top right' });
    } catch (err: any) {
      setError(
        err?.message?.includes('Invalid')
          ? 'Tên đăng nhập hoặc mật khẩu không đúng!'
          : 'Có lỗi xảy ra, vui lòng thử lại.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const inputCls =
    'w-full h-11 pl-10 pr-4 rounded-lg bg-inset border border-[var(--border)] text-ink text-sm outline-none transition ' +
    'focus:border-accent focus:ring-2 focus:ring-[var(--focus-ring)] placeholder:text-faint';

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        background:
          'radial-gradient(1100px 520px at 50% -8%, var(--accent-soft), transparent 60%), var(--bg)',
      }}
    >
      {/* Theme toggle ở góc */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-[440px]"
      >
        {/* Card */}
        <div
          className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          {/* Header band — accent */}
          <div
            className="px-8 py-7"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[17px] font-bold leading-tight text-white">{APP_NAME}</h1>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-white/80">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
                  Hệ thống trực tuyến · GETC
                </p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 pt-6 pb-7">
            <div className="mb-5 text-center">
              <h2 className="text-lg font-bold text-ink">Đăng nhập hệ thống</h2>
              <p className="mt-1 text-sm text-soft">{cfg.subtitle}</p>
            </div>

            {/* Tabs: Nhóm Vận Hành / Nhóm Văn Phòng */}
            <Tabs
              tabs={MODE_TABS}
              value={mode}
              onChange={(m) => { setMode(m); setError(''); }}
              fluid
              className="mb-6"
            />

            <form onSubmit={handleLogin} className="space-y-4">
              {/* Username */}
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-soft">
                  Tên đăng nhập
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <input
                    type="text"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setError(''); }}
                    required
                    placeholder="Nhập tên đăng nhập"
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-soft">
                  Mật khẩu
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    required
                    placeholder="Nhập mật khẩu"
                    className={inputCls + ' pr-10'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint transition-colors hover:text-dim"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -4, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--border)' }}
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[var(--on-accent)] text-sm font-semibold transition-all hover:bg-[var(--accent-hover)] active:scale-[0.99] disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                      className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                    />
                    Đang đăng nhập...
                  </>
                ) : (
                  <>
                    Đăng nhập
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-faint">{cfg.footer}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
