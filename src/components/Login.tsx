import React, { useState } from 'react';
import { pb } from '../lib/pocketbase';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, User, Lock, Eye, EyeOff, AlertCircle, LogIn } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center p-4">
      {/* Main card */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/80 p-8 sm:p-10 border border-slate-100">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-center mb-8"
          >
            <div className="flex justify-center mb-5">
              <div className="relative">
                <div
                  className="absolute inset-0 rounded-2xl blur-xl opacity-60"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}
                />
                <div
                  className="relative p-4 rounded-2xl"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #0891b2)' }}
                >
                  <Zap className="w-10 h-10 text-white" strokeWidth={2} />
                </div>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
              Ứng dụng quản lý vận hành
            </h1>
            <p className="text-slate-500 mt-1.5 text-sm">
              Quản lý ca trực, nhật ký, chỉ số & khách hàng điện
            </p>
          </motion.div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            onSubmit={handleLogin}
            className="space-y-4"
          >
            {/* Username field */}
            <div className="group relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <User className="w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
              </div>
              <input
                type="text"
                placeholder="Tên đăng nhập"
                required
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                className="w-full pl-11 pr-4 py-3.5 rounded-xl text-slate-800 placeholder-slate-400 text-sm transition-all outline-none"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.border = '1px solid rgba(59, 130, 246, 0.6)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.08)';
                  e.currentTarget.style.background = '#fff';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.border = '1px solid #e2e8f0';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.background = '#f8fafc';
                }}
              />
            </div>

            {/* Password field */}
            <div className="group relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Lock className="w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Mật khẩu"
                required
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                className="w-full pl-11 pr-12 py-3.5 rounded-xl text-slate-800 placeholder-slate-400 text-sm transition-all outline-none"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.border = '1px solid rgba(59, 130, 246, 0.6)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.08)';
                  e.currentTarget.style.background = '#fff';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.border = '1px solid #e2e8f0';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.background = '#f8fafc';
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-4 flex items-center text-slate-400 hover:text-slate-700 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Error message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-600"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit button */}
            <motion.button
              type="submit"
              disabled={isLoading}
              whileHover={{ scale: isLoading ? 1 : 1.01 }}
              whileTap={{ scale: isLoading ? 1 : 0.98 }}
              className="relative w-full py-3.5 rounded-xl font-semibold text-white text-sm overflow-hidden transition-opacity disabled:opacity-60 mt-2"
              style={{
                background: 'linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)',
                boxShadow: '0 4px 24px rgba(29, 78, 216, 0.4)',
              }}
            >
              {/* Shimmer effect */}
              {!isLoading && (
                <motion.div
                  className="absolute inset-0 opacity-0 hover:opacity-100"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(255,255,255,0.05) 100%)',
                  }}
                />
              )}
              <span className="relative flex items-center justify-center gap-2">
                {isLoading ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
                    />
                    Đang đăng nhập...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Đăng nhập
                  </>
                )}
              </span>
            </motion.button>
          </motion.form>

          {/* Footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-center text-slate-400 text-xs mt-8"
          >
            Chỉ dành cho thành viên nhóm vận hành
          </motion.p>
        </div>
      </motion.div>
    </div>
  );
}
