import React, { useState } from 'react';
import { pb } from '../lib/pocketbase';
import { motion } from 'motion/react';
import { ClipboardList } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      alert('Vui lòng nhập đầy đủ thông tin!');
      return;
    }

    setIsLoading(true);
    try {
      await pb.collection('users').authWithPassword(username, password);
      // App.tsx will handle the redirect based on auth state
    } catch (err: any) {
      alert(err?.message?.includes('Invalid') ? 'Tên đăng nhập hoặc mật khẩu không đúng!' : 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-100 to-blue-100 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl p-10"
      >
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <div className="bg-emerald-100 p-4 rounded-2xl">
              <ClipboardList className="w-12 h-12 text-emerald-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-800">Sổ nhật ký vận hành</h1>
          <p className="text-gray-500 mt-2">Hệ thống bàn giao ca trực điện tử</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <input 
              type="text" 
              placeholder="Tên đăng nhập" 
              required 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 px-5 py-4 rounded-2xl text-lg focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
          </div>

          <div>
            <input 
              type="password" 
              placeholder="Mật khẩu" 
              required 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 px-5 py-4 rounded-2xl text-lg focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
          </div>

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium text-lg py-4 rounded-2xl transition-all shadow-md active:scale-[0.98]"
          >
            {isLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>

        <p className="text-center text-slate-400 text-sm mt-8">
          Chỉ dành cho thành viên nhóm vận hành
        </p>
      </motion.div>
    </div>
  );
}
