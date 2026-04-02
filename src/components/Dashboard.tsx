import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS } from '../lib/pocketbase';
import { Handover, Situation, ElectricShift } from '../types';
import { 
  Plus, RefreshCw, LogOut, FileText, Edit, Trash2, 
  Search, Calendar, Clock, User, Zap, MessageSquare, 
  Package, ChevronRight, X, Download, ClipboardList, Users, Menu, ChevronDown,
  Activity, Cpu, Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import ElectricShiftManager from './ElectricShiftManager';
import SummaryDashboard from './SummaryDashboard';
import CustomerManager from './CustomerManager';
import HandoverManager from './HandoverManager';
import HesReadingManager from './HesReadingManager';
import { LayoutDashboard } from 'lucide-react';

// Initialize pdfMake fonts with Times New Roman from CDN
const TINOS_FONTS = {
  Tinos: {
    normal: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Regular.ttf',
    bold: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Bold.ttf',
    italics: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Italic.ttf',
    bolditalics: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-BoldItalic.ttf'
  }
};

export default function Dashboard() {
  const [topTab, setTopTab] = useState<'summary' | 'journal' | 'operating' | 'later'>('summary');
  const [subTab, setSubTab] = useState<'create' | 'staff' | 'customer' | 'hes'>('create');
  
  // User areas handling - stabilize with JSON stringification for dependency tracking
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    const areas = Array.isArray(raw) 
      ? raw 
      : (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
    return areas;
  }, [JSON.stringify(pb.authStore.model?.area)]);
  
  const effectiveAreas = React.useMemo(() => userAreas.length > 0 ? userAreas : AREAS, [userAreas]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isJournalExpanded, setIsJournalExpanded] = useState(true);
  const [isOperatingExpanded, setIsOperatingExpanded] = useState(false);

  const handleLogout = () => {
    pb.authStore.clear();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col lg:flex-row">
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
                  <div className="p-2 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
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
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    Tổng hợp
                  </button>

                  <div className="space-y-1">
                    <button 
                      onClick={() => { setTopTab('journal'); setIsJournalExpanded(!isJournalExpanded); }}
                      className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'journal' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-4"><ClipboardList className="w-5 h-5" />Sổ nhật ký điện tử</div>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {isJournalExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                          <button onClick={() => { setTopTab('journal'); setSubTab('create'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'journal' && subTab === 'create' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'create' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Tạo lịch trực
                          </button>
                          <button onClick={() => { setTopTab('journal'); setSubTab('staff'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'journal' && subTab === 'staff' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'staff' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Quản lý nhân sự trực
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="space-y-1">
                    <button 
                      onClick={() => { setTopTab('operating'); setIsOperatingExpanded(!isOperatingExpanded); }}
                      className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'operating' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-4"><Activity className="w-5 h-5" />Thông số vận hành</div>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isOperatingExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {isOperatingExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                          <button onClick={() => { setTopTab('operating'); setSubTab('customer'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'operating' && subTab === 'customer' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'operating' && subTab === 'customer' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Thông tin chung
                          </button>
                          <button onClick={() => { setTopTab('operating'); setSubTab('hes'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'operating' && subTab === 'hes' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'operating' && subTab === 'hes' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Lấy chỉ số từ HES
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button onClick={() => { setTopTab('later'); setIsSidebarOpen(false); }} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${topTab === 'later' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
                    <RefreshCw className="w-5 h-5" />Cập nhật sau
                  </button>
                </nav>
              </div>
              <div className="mt-auto pt-8 border-t border-slate-100">
                <div className="bg-slate-50 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xs">{pb.authStore.model?.name?.[0] || 'U'}</div>
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
          <div className="p-2 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
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
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              Tổng hợp
            </button>

            <div className="space-y-1">
              <button onClick={() => { setTopTab('journal'); setIsJournalExpanded(!isJournalExpanded); }} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'journal' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
                <div className="flex items-center gap-4"><ClipboardList className="w-5 h-5" />Sổ nhật ký điện tử</div>
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {isJournalExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                    <button onClick={() => { setTopTab('journal'); setSubTab('create'); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'journal' && subTab === 'create' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'create' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Tạo lịch trực
                    </button>
                    <button onClick={() => { setTopTab('journal'); setSubTab('staff'); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'journal' && subTab === 'staff' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'staff' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Quản lý nhân sự trực
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="space-y-1">
              <button onClick={() => { setTopTab('operating'); setIsOperatingExpanded(!isOperatingExpanded); }} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${topTab === 'operating' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
                <div className="flex items-center gap-4"><Activity className="w-5 h-5" />Thông số vận hành</div>
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isOperatingExpanded ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {isOperatingExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-4 space-y-1">
                    <button onClick={() => { setTopTab('operating'); setSubTab('customer'); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'operating' && subTab === 'customer' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'operating' && subTab === 'customer' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Thông tin chung
                    </button>
                    <button onClick={() => { setTopTab('operating'); setSubTab('hes'); }} className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${topTab === 'operating' && subTab === 'hes' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'operating' && subTab === 'hes' ? 'bg-emerald-600' : 'bg-slate-300'}`} />Lấy chỉ số từ HES
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button onClick={() => setTopTab('later')} className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${topTab === 'later' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-slate-500 hover:bg-slate-50'}`}>
              <RefreshCw className="w-5 h-5" />Cập nhật sau
            </button>
          </nav>
        </div>
        <div className="mt-auto pt-8 border-t border-slate-100">
          <div className="bg-slate-50 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xs">{pb.authStore.model?.name?.[0] || 'U'}</div>
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
        <div className="max-w-6xl mx-auto">
          <div className="lg:hidden mb-6 flex items-center justify-between">
            <button onClick={() => setIsSidebarOpen(true)} className="p-3 bg-white hover:bg-slate-50 rounded-2xl shadow-sm border border-slate-100 transition-all">
              <Menu className="w-6 h-6 text-slate-600" />
            </button>
          </div>

          {topTab === 'summary' ? (
            <SummaryDashboard />
          ) : topTab === 'operating' ? (
            subTab === 'customer' ? (
              <CustomerManager />
            ) : (
              <HesReadingManager />
            )
          ) : topTab === 'journal' ? (
            subTab === 'create' ? (
              <HandoverManager />
            ) : (
              <ElectricShiftManager />
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[2rem] shadow-sm">
              <RefreshCw className="w-16 h-16 text-slate-200 mb-4 animate-spin-slow" />
              <h3 className="text-xl font-bold text-slate-400">Tính năng đang được phát triển</h3>
              <p className="text-slate-400">Vui lòng quay lại sau</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
