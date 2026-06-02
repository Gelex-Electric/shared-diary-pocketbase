import React, { useState, useEffect } from 'react';
import { pb, AREAS } from '../lib/pocketbase';
import {
  RefreshCw, LogOut, ClipboardList, X, Menu, ChevronDown,
  Activity, FileText, ExternalLink, Sparkles, ArrowDownLeft, Check
} from 'lucide-react';
import { NewUpdate } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import SummaryDashboard from './SummaryDashboard';
import CustomerManager from './CustomerManager';
import JournalManager from './JournalManager';
import { LayoutDashboard } from 'lucide-react';

export default function Dashboard() {
  const [topTab, setTopTab] = useState<'summary' | 'journal' | 'operating' | 'later'>('summary');
  
  // User areas handling - stabilize with JSON stringification for dependency tracking
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    const areas = Array.isArray(raw) 
      ? raw 
      : (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
    return areas;
  }, [JSON.stringify(pb.authStore.model?.area)]);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isJournalExpanded, setIsJournalExpanded] = useState(true);
  const [isOperatingExpanded, setIsOperatingExpanded] = useState(false);

  // New update announcement
  const [showNewUpdate, setShowNewUpdate] = useState(false);
  const [newUpdateId, setNewUpdateId] = useState<string | null>(null);

  useEffect(() => {
    const checkNewUpdate = async () => {
      if (!pb.authStore.isValid) return;
      try {
        // API rule "area = @request.auth.area" already filters by user's area.
        // We only need to check status = true here.
        const record = await pb.collection('New_update').getFirstListItem<NewUpdate>(
          'status = true',
          { requestKey: null }
        );
        setNewUpdateId(record.id);
        setShowNewUpdate(true);
      } catch (err: any) {
        if (!err?.isAbort && err?.status !== 404) {
          console.warn('New_update check failed:', err?.message ?? err);
        }
        // 404 = no record with status=true → nothing to show
      }
    };
    checkNewUpdate();
  }, []);

  const dismissNewUpdate = async () => {
    setShowNewUpdate(false);
    if (newUpdateId) {
      try {
        await pb.collection('New_update').update(newUpdateId, { status: false });
      } catch (err) {
        console.error('Failed to dismiss new update:', err);
      }
    }
  };

  const handleLogout = () => {
    pb.authStore.clear();
    window.location.reload();
  };

  const newFeatures = [
    'Đổi tên mục "Sổ nhật ký điện tử" thành "Hồ sơ vận hành" cho rõ nghĩa hơn',
    'Gộp "Tạo lịch trực" và "Quản lý nhân sự trực" thành một mục duy nhất "Sổ nhật ký vận hành" với 2 tab tiện lợi',
    'Gộp "Lấy chỉ số từ HES" vào Thông số vận hành → Thông tin chung dưới dạng tab riêng',
    'Thông báo hệ thống chuyển sang dạng nổi (floating) góc phải — không còn che nội dung trang',
    'Sửa lỗi bộ lọc tháng trong Báo cáo tổng quan: mỗi tháng chỉ hiển thị đúng dữ liệu của tháng đó',
    'Bảng công nợ hiển thị thêm số khách còn nợ ở các tháng khác ngay trong thông báo cảnh báo',
    'Sửa lỗi đồng bộ HES: khách hàng có nhiều email hoặc email sai định dạng không còn gây lỗi lưu công tơ',
    'Hỗ trợ lưu nhiều địa chỉ email cho mỗi khách hàng (tách nhau bởi dấu phẩy)',
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col lg:flex-row">
      {/* New update announcement modal */}
      <AnimatePresence>
        {showNewUpdate && (
          <motion.div
            key="new-update-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ type: 'spring', damping: 22, stiffness: 260 }}
              className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden"
            >
              {/* Gradient header */}
              <div className="relative bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-400 px-7 py-6 text-white overflow-hidden">
                <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full" />
                <div className="absolute -bottom-8 -left-4 w-24 h-24 bg-white/10 rounded-full" />
                <div className="relative">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 opacity-90" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">Phiên bản mới</span>
                  </div>
                  <h2 className="text-2xl font-black leading-tight">Cập nhật tính năng</h2>
                  <p className="text-sm opacity-75 mt-1">Những cải tiến mới nhất trong hệ thống</p>
                </div>
              </div>

              {/* Feature list */}
              <div className="px-7 py-5 space-y-3 max-h-64 overflow-y-auto">
                {newFeatures.map((feat, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                      <Check className="w-3 h-3 text-blue-600" strokeWidth={3} />
                    </span>
                    <p className="text-sm text-slate-700 leading-snug">{feat}</p>
                  </div>
                ))}
              </div>

              {/* Arrow callout → Hướng dẫn sử dụng */}
              <div className="mx-7 mb-5 p-3.5 bg-blue-50 border border-blue-100 rounded-2xl flex items-center gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
                  <ArrowDownLeft className="w-4 h-4 text-blue-600" />
                </div>
                <p className="text-sm text-blue-800 leading-snug">
                  Xem hướng dẫn sử dụng đầy đủ tại nút{' '}
                  <span className="font-bold inline-flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> Hướng dẫn sử dụng
                  </span>{' '}
                  ở cuối thanh bên trái.
                </p>
              </div>

              {/* Dismiss button */}
              <div className="px-7 pb-7">
                <button
                  onClick={dismissNewUpdate}
                  className="w-full py-3.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #0891b2 100%)', boxShadow: '0 4px 20px rgba(29,78,216,0.35)' }}
                >
                  Đã hiểu, không hiển thị lại
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 lg:hidden"
            />
            <motion.aside 
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 z-50 w-80 h-screen bg-white border-r border-slate-200 p-6 flex flex-col gap-8 shadow-2xl lg:hidden overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20">
                    <ClipboardList className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight uppercase">QUẢN LÝ VẬN HÀNH</h2>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-6 px-4">Hệ thống</h3>
                <nav className="space-y-2">
                  <button 
                    onClick={() => {
                      setTopTab('summary');
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${
                      topTab === 'summary' 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    Tổng hợp
                  </button>

                  <div className="space-y-1">
                    <button 
                      onClick={() => { setTopTab('journal'); setIsJournalExpanded(!isJournalExpanded); }}
                      className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'journal' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-4"><ClipboardList className="w-5 h-5" />Hồ sơ vận hành</div>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {isJournalExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                          <button onClick={() => { setTopTab('journal'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'journal' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' ? 'bg-blue-600' : 'bg-slate-300'}`} />Sổ nhật ký vận hành
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="space-y-1">
                    <button 
                      onClick={() => { setTopTab('operating'); setIsOperatingExpanded(!isOperatingExpanded); }}
                      className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'operating' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-4"><Activity className="w-5 h-5" />Thông số vận hành</div>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isOperatingExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {isOperatingExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                          <button onClick={() => { setTopTab('operating'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'operating' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'operating' ? 'bg-blue-600' : 'bg-slate-300'}`} />Thông tin chung
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button onClick={() => { setTopTab('later'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${topTab === 'later' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
                    <RefreshCw className="w-5 h-5" />Cập nhật sau
                  </button>
                </nav>
              </div>
              <div className="mt-auto pt-8 border-t border-slate-100 space-y-3">
                <a
                  href="/document.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all group ${
                    showNewUpdate
                      ? 'bg-blue-50 text-blue-600 ring-2 ring-blue-400 ring-offset-2 animate-pulse'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-blue-600'
                  }`}
                >
                  <FileText className="w-4 h-4 transition-colors text-blue-500" />
                  <span>Hướng dẫn sử dụng</span>
                  <ExternalLink className={`w-3 h-3 ml-auto transition-opacity ${showNewUpdate ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                </a>
                <div className="bg-slate-50 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">{pb.authStore.model?.name?.[0] || 'U'}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{pb.authStore.model?.name || 'Người dùng'}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{pb.authStore.model?.area || 'Khu vực'}</p>
                    </div>
                  </div>
                  <button onClick={handleLogout} className="w-full py-2.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2">
                    <LogOut className="w-3.5 h-3.5" />Đăng xuất
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <aside className="hidden lg:flex sticky top-0 left-0 w-80 h-screen bg-white border-r border-slate-200 p-8 flex-col gap-8 overflow-y-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20">
            <ClipboardList className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight uppercase">QUẢN LÝ VẬN HÀNH</h2>
        </div>
        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-6 px-4">Hệ thống</h3>
          <nav className="space-y-2">
            <button 
              onClick={() => setTopTab('summary')}
              className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${
                topTab === 'summary' 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              Tổng hợp
            </button>

            <div className="space-y-1">
              <button onClick={() => { setTopTab('journal'); setIsJournalExpanded(!isJournalExpanded); }} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'journal' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
                <div className="flex items-center gap-4"><ClipboardList className="w-5 h-5" />Hồ sơ vận hành</div>
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {isJournalExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                    <button onClick={() => { setTopTab('journal'); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'journal' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' ? 'bg-blue-600' : 'bg-slate-300'}`} />Sổ nhật ký vận hành
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="space-y-1">
              <button onClick={() => { setTopTab('operating'); setIsOperatingExpanded(!isOperatingExpanded); }} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'operating' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
                <div className="flex items-center gap-4"><Activity className="w-5 h-5" />Thông số vận hành</div>
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isOperatingExpanded ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {isOperatingExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                    <button onClick={() => { setTopTab('operating'); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'operating' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'operating' ? 'bg-blue-600' : 'bg-slate-300'}`} />Thông tin chung
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={() => setTopTab('later')} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${topTab === 'later' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
              <RefreshCw className="w-5 h-5" />Cập nhật sau
            </button>
          </nav>
        </div>
        <div className="mt-auto pt-8 border-t border-slate-100 space-y-3">
          <a
            href="/document.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all group ${
              showNewUpdate
                ? 'bg-blue-50 text-blue-600 ring-2 ring-blue-400 ring-offset-2 animate-pulse'
                : 'text-slate-500 hover:bg-slate-50 hover:text-blue-600'
            }`}
          >
            <FileText className="w-4 h-4 text-blue-500 transition-colors" />
            <span>Hướng dẫn sử dụng</span>
            <ExternalLink className={`w-3 h-3 ml-auto transition-opacity ${showNewUpdate ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
          </a>
          <div className="bg-slate-50 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">{pb.authStore.model?.name?.[0] || 'U'}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{pb.authStore.model?.name || 'Người dùng'}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{pb.authStore.model?.area || 'Khu vực'}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="w-full py-2.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2">
              <LogOut className="w-3.5 h-3.5" />Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 p-4 md:p-8 lg:max-w-[calc(100vw-320px)]">
        <div className="max-w-[1650px] mx-auto w-full">
          <div className="lg:hidden mb-6 flex items-center justify-between">
            <button onClick={() => setIsSidebarOpen(true)} className="p-3 bg-white hover:bg-slate-50 rounded-2xl shadow-sm border border-slate-100 transition-all">
              <Menu className="w-6 h-6 text-slate-600" />
            </button>
          </div>

          {topTab === 'summary' ? (
            <SummaryDashboard />
          ) : topTab === 'operating' ? (
            <CustomerManager />
          ) : topTab === 'journal' ? (
            <JournalManager />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[2rem] shadow-sm">
              <RefreshCw className="w-16 h-16 text-slate-200 mb-4 animate-[spin_3s_linear_infinite]" />
              <h3 className="text-xl font-bold text-slate-400">Tính năng đang được phát triển</h3>
              <p className="text-slate-400">Vui lòng quay lại sau</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
