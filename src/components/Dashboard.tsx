import React, { useState, useEffect } from 'react';
import { pb } from '../lib/pocketbase';
import {
  RefreshCw, LogOut, ClipboardList, X, Menu, ChevronDown,
  Activity, FileText, ExternalLink, Bell, Mail, LayoutDashboard,
} from 'lucide-react';
import { NewUpdate } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import SummaryDashboard from './SummaryDashboard';
import CustomerManager from './CustomerManager';
import JournalManager from './JournalManager';
import NewUpdateTour from './NewUpdateTour';

type Tab = 'summary' | 'journal' | 'operating' | 'later';

const TAB_LABEL: Record<Tab, string> = {
  summary:   'Dashboard',
  journal:   'Hồ sơ vận hành',
  operating: 'Thông số vận hành',
  later:     'Cập nhật sau',
};

export default function Dashboard() {
  const [topTab, setTopTab] = useState<Tab>('summary');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isJournalExpanded, setIsJournalExpanded] = useState(true);
  const [isOperatingExpanded, setIsOperatingExpanded] = useState(false);
  const [showNewUpdate, setShowNewUpdate] = useState(false);
  const [newUpdateId, setNewUpdateId] = useState<string | null>(null);

  useEffect(() => {
    const checkNewUpdate = async () => {
      if (!pb.authStore.isValid) return;
      try {
        const record = await pb.collection('New_update').getFirstListItem<NewUpdate>(
          'status = true', { requestKey: null }
        );
        setNewUpdateId(record.id);
        setShowNewUpdate(true);
      } catch (err: any) {
        if (!err?.isAbort && err?.status !== 404) {
          console.warn('New_update check failed:', err?.message ?? err);
        }
      }
    };
    checkNewUpdate();
  }, []);

  useEffect(() => {
    if (showNewUpdate) {
      setIsJournalExpanded(true);
      setIsOperatingExpanded(true);
    }
  }, [showNewUpdate]);

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

  const closeNewUpdateForNow = () => setShowNewUpdate(false);
  const handleLogout = () => { pb.authStore.clear(); window.location.reload(); };

  const userName    = pb.authStore.model?.name || 'Người dùng';
  const userArea    = pb.authStore.model?.area  || '';
  const userInitial = userName[0] || 'U';

  /* -------- Sidebar nav content (pure nav, no user / help) -------- */
  const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* Logo */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#5a8dee] flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-[0.7rem] font-semibold text-[#a3afbd] uppercase tracking-wider">Phần mềm</p>
            <p className="text-[0.95rem] font-bold text-[#5a8dee] leading-snug">Quản lý vận hành GETC</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-4">
        <p className="vl-section-title">Menu chính</p>

        <ul className="list-none px-0 mt-2">

          {/* Tổng hợp */}
          <li className="relative mt-1">
            <button
              onClick={() => { setTopTab('summary'); onNavigate?.(); }}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'summary' ? 'vl-sidebar-active text-[#5a8dee]' : 'text-[#053382] hover:bg-[#f4f8ff]'
              }`}
            >
              <LayoutDashboard className="w-5 h-5 shrink-0" />
              <span>Tổng hợp</span>
            </button>
          </li>

          {/* Hồ sơ vận hành */}
          <li className="relative mt-1">
            <button
              id="nav-journal"
              onClick={() => { setTopTab('journal'); setIsJournalExpanded(v => !v); onNavigate?.(); }}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'journal' ? 'vl-sidebar-active text-[#5a8dee]' : 'text-[#053382] hover:bg-[#f4f8ff]'
              }`}
            >
              <ClipboardList className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Hồ sơ vận hành</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {isJournalExpanded && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden list-none px-0"
                >
                  <li>
                    <button
                      id="nav-journal-sub"
                      onClick={() => { setTopTab('journal'); onNavigate?.(); }}
                      className={`w-full text-left block px-12 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'journal' ? 'text-[#5a8dee]' : 'text-[#676767] hover:text-[#475f7b]'
                      }`}
                    >
                      Sổ nhật ký vận hành
                    </button>
                  </li>
                </motion.ul>
              )}
            </AnimatePresence>
          </li>

          {/* Thông số vận hành */}
          <li className="relative mt-1">
            <button
              onClick={() => { setTopTab('operating'); setIsOperatingExpanded(v => !v); onNavigate?.(); }}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'operating' ? 'vl-sidebar-active text-[#5a8dee]' : 'text-[#053382] hover:bg-[#f4f8ff]'
              }`}
            >
              <Activity className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Thông số vận hành</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isOperatingExpanded ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {isOperatingExpanded && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden list-none px-0"
                >
                  <li>
                    <button
                      id="nav-operating-sub"
                      onClick={() => { setTopTab('operating'); onNavigate?.(); }}
                      className={`w-full text-left block px-12 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'operating' ? 'text-[#5a8dee]' : 'text-[#676767] hover:text-[#475f7b]'
                      }`}
                    >
                      Thông tin chung
                    </button>
                  </li>
                </motion.ul>
              )}
            </AnimatePresence>
          </li>
        </ul>

        {/* Tiện ích */}
        <p className="vl-section-title mt-4">Tiện ích</p>

        <ul className="list-none px-0 mt-2">
          <li className="relative mt-1">
            <button
              onClick={() => { setTopTab('later'); onNavigate?.(); }}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'later' ? 'vl-sidebar-active text-[#5a8dee]' : 'text-[#053382] hover:bg-[#f4f8ff]'
              }`}
            >
              <RefreshCw className="w-5 h-5 shrink-0" />
              <span>Cập nhật sau</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );

  /* ===================== RENDER ===================== */
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--vl-bg)' }}>

      <AnimatePresence>
        {showNewUpdate && (
          <NewUpdateTour onDismiss={dismissNewUpdate} onClose={closeNewUpdateForNow} />
        )}
      </AnimatePresence>

      {/* ---- SIDEBAR ---- */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 26, stiffness: 200 }}
            className="fixed top-0 left-0 z-50 h-screen bg-white lg:hidden"
            style={{ width: 260, borderRight: '1px solid #eee', boxShadow: '0 0 10px #ececec' }}
          >
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="absolute top-2 right-2 p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarNav onNavigate={() => setIsSidebarOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <aside
        className="hidden lg:block fixed top-0 left-0 h-screen bg-white z-30"
        style={{ width: 260, borderRight: '1px solid #eee', boxShadow: '0 0 10px #ececec' }}
      >
        <SidebarNav />
      </aside>

      {/* ---- MAIN ---- */}
      <div className="lg:ml-[260px] flex flex-col min-h-screen">

        {/* Navbar — page title left, user actions right */}
        <nav
          className="sticky top-0 z-20 bg-white flex items-center px-4 md:px-6 gap-3"
          style={{ height: 70, borderBottom: '1px solid #eee', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}
        >
          {/* Mobile hamburger */}
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors text-[#6c757d]"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Current page title */}
          <div className="flex-1 min-w-0">
            <h2 className="text-[1.1rem] font-bold text-[#222f3e] leading-tight truncate">
              {TAB_LABEL[topTab]}
            </h2>
            {userArea && (
              <p className="text-[11px] font-semibold text-[#a3afbd] uppercase tracking-wider leading-tight hidden sm:block">
                {userArea}
              </p>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Bell */}
            <button
              className="p-2 rounded-full hover:bg-gray-100 transition-colors text-[#6c757d]"
              title="Thông báo"
            >
              <Bell className="w-[20px] h-[20px]" />
            </button>

            {/* Help / Hướng dẫn */}
            <a
              href="/document.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className={`p-2 rounded-full transition-colors ${
                showNewUpdate
                  ? 'text-[#5a8dee] bg-[#e8f3ff] animate-pulse'
                  : 'text-[#6c757d] hover:bg-gray-100'
              }`}
              title="Hướng dẫn sử dụng"
            >
              <FileText className="w-[20px] h-[20px]" />
            </a>

            {/* Divider */}
            <div className="w-px h-6 bg-gray-200 mx-1" />

            {/* User avatar + name */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#5a8dee] flex items-center justify-center text-white text-[13px] font-bold shrink-0">
                {userInitial}
              </div>
              <span className="hidden md:block text-[13px] font-semibold text-[#475f7b] max-w-[120px] truncate">
                {userName}
              </span>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-full hover:bg-red-50 transition-colors text-[#ff5b5c]"
              title="Đăng xuất"
            >
              <LogOut className="w-[18px] h-[18px]" />
            </button>
          </div>
        </nav>

        {/* Page content */}
        <div className="flex-1 px-4 py-6 md:px-6 md:py-8">
          <section>
            {topTab === 'summary' ? (
              <SummaryDashboard />
            ) : topTab === 'operating' ? (
              <CustomerManager />
            ) : topTab === 'journal' ? (
              <JournalManager />
            ) : (
              <div className="vl-card flex flex-col items-center justify-center py-20">
                <RefreshCw
                  className="w-14 h-14 mb-4 animate-[spin_3s_linear_infinite]"
                  style={{ color: '#a3afbd' }}
                />
                <h3 className="text-lg font-bold" style={{ color: '#475f7b' }}>
                  Tính năng đang được phát triển
                </h3>
                <p style={{ color: '#a3afbd', fontSize: '0.875rem', marginTop: 4 }}>
                  Vui lòng quay lại sau
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="px-6 py-4">
          <div className="flex justify-end text-[.8rem]" style={{ color: 'var(--vl-light)' }}>
            <p>Phiên bản 1.0</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
