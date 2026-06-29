import React, { useState } from 'react';
import { pb } from '../lib/pocketbase';
import { toast } from '../lib/toast';
import { motion, AnimatePresence } from 'motion/react';
import { User, Lock, Eye, EyeOff, AlertCircle, Zap, Activity, Briefcase } from 'lucide-react';

type LoginMode = 'operation' | 'business';

const MODE_CONFIG: Record<LoginMode, { label: string; icon: typeof Activity; subtitle: string; footer: string }> = {
  operation: {
    label: 'Vận Hành',
    icon: Activity,
    subtitle: 'Ứng dụng quản lý vận hành GETC',
    footer: 'Chỉ dành cho thành viên nhóm vận hành',
  },
  business: {
    label: 'Kinh Doanh',
    icon: Briefcase,
    subtitle: 'Cổng dành cho khối văn phòng / kinh doanh',
    footer: 'Chỉ dành cho tài khoản khối văn phòng',
  },
};

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

      // Phân loại khối theo field 'area': có area = Vận hành, trống = Kinh doanh.
      const rawArea = pb.authStore.model?.area;
      const accountIsBusiness = !rawArea || (typeof rawArea === 'string' && !rawArea.trim());
      const accountMode: LoginMode = accountIsBusiness ? 'business' : 'operation';

      // Chặn đăng nhập nếu khối tài khoản không khớp tab đang chọn.
      if (accountMode !== mode) {
        pb.authStore.clear();
        setError(
          mode === 'business'
            ? 'Tài khoản này thuộc khối Vận hành. Vui lòng đăng nhập ở tab "Vận Hành".'
            : 'Tài khoản này thuộc khối Kinh doanh. Vui lòng đăng nhập ở tab "Kinh Doanh".'
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

  return (
    <div
      className="min-h-screen flex items-start justify-center pt-20 px-4 pb-10"
      style={{
        background: 'var(--bg)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-[420px]"
      >
        {/* Card */}
        <div
          className="bg-surface rounded-xl pt-8 pb-6 px-8 border border-[var(--border)]"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          {/* Header */}
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4" style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent))' }}>
              <Zap className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Đăng nhập</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--text-4)' }}>{cfg.subtitle}</p>
          </div>

          {/* Tabs: Vận Hành / Kinh Doanh */}
          <div className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-xl" style={{ background: 'var(--surface-inset)' }}>
            {(Object.keys(MODE_CONFIG) as LoginMode[]).map(m => {
              const Icon = MODE_CONFIG[m].icon;
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(''); }}
                  className="relative flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: active ? 'var(--surface-2)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-4)',
                    boxShadow: active ? '0 2px 6px rgba(25,42,70,.12)' : 'none',
                  }}
                >
                  <Icon className="w-4 h-4" />
                  {MODE_CONFIG[m].label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>
                Tên đăng nhập
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <User className="w-4 h-4" style={{ color: 'var(--text-4)' }} />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError(''); }}
                  required
                  placeholder="Nhập tên đăng nhập"
                  className="w-full pl-9 pr-4 py-2.5 rounded-md text-sm outline-none transition-all"
                  style={{
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    background: 'var(--surface-1)',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.boxShadow = '0 3px 8px 0 rgba(0,0,0,.1)';
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>
                Mật khẩu
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <Lock className="w-4 h-4" style={{ color: 'var(--text-4)' }} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  required
                  placeholder="Nhập mật khẩu"
                  className="w-full pl-9 pr-10 py-2.5 rounded-md text-sm outline-none transition-all"
                  style={{
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    background: 'var(--surface-1)',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.boxShadow = '0 3px 8px 0 rgba(0,0,0,.1)';
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute inset-y-0 right-3 flex items-center transition-colors"
                  style={{ color: 'var(--text-4)' }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium"
                  style={{ background: 'rgba(255,91,92,.1)', color: '#ff5b5c', border: '1px solid rgba(255,91,92,.2)' }}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-md font-semibold text-sm text-white transition-opacity disabled:opacity-60 flex items-center justify-center gap-2 mt-1"
              style={{
                background: 'var(--accent)',
                boxShadow: '0 2px 8px rgba(90,141,238,.4)',
              }}
              onMouseEnter={e => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
            >
              {isLoading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                  />
                  Đang đăng nhập...
                </>
              ) : (
                'Đăng nhập'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ borderTop: '1px solid var(--border)' }} />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface px-3 text-xs font-medium" style={{ color: 'var(--text-4)' }}>GETC</span>
            </div>
          </div>

          <p className="text-center text-xs" style={{ color: 'var(--text-4)' }}>
            {cfg.footer}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
