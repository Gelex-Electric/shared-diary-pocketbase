import { useState } from 'react';
import { pb } from '../../lib/pocketbase';
import {
  RefreshCw, LogOut, X, Menu, ChevronDown,
  FileText, LayoutDashboard, Briefcase,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import BusinessSummaryDashboard from './BusinessSummaryDashboard';
import BillConfirmManager from './BillConfirmManager';
import QuickImportManager from './QuickImportManager';
import CustomerDebtManager from './CustomerDebtManager';

type Tab = 'summary' | 'bill-confirm' | 'quick-import' | 'customer-debt';

const TAB_LABEL: Record<Tab, string> = {
  summary:         'Dashboard',
  'bill-confirm':  'Biên bản xác nhận chỉ số',
  'quick-import':  'Nạp dữ liệu nhanh',
  'customer-debt': 'Công nợ khách hàng',
};

export default function BusinessDashboard() {
  const [topTab, setTopTab] = useState<Tab>('summary');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBusinessExpanded, setIsBusinessExpanded] = useState(true);

  const handleLogout = () => { pb.authStore.clear(); window.location.reload(); };

  const userName    = pb.authStore.model?.name || 'Người dùng';
  const userInitial = userName[0] || 'U';

  /* -------- Sidebar nav content (pure nav, no user / help) -------- */
  const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* Logo */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#5a8dee] flex items-center justify-center shrink-0">
            <Briefcase className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-[0.7rem] font-semibold text-[#a3afbd] uppercase tracking-wider">Phần mềm</p>
            <p className="text-[0.95rem] font-bold text-[#5a8dee] leading-snug">Khối kinh doanh GETC</p>
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

          {/* Hồ sơ kinh doanh */}
          <li className="relative mt-1">
            <button
              id="nav-business"
              onClick={() => setIsBusinessExpanded(v => !v)}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'bill-confirm' || topTab === 'quick-import' || topTab === 'customer-debt' ? 'vl-sidebar-active text-[#5a8dee]' : 'text-[#053382] hover:bg-[#f4f8ff]'
              }`}
            >
              <Briefcase className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Hồ sơ kinh doanh</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isBusinessExpanded ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {isBusinessExpanded && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden list-none px-0"
                >
                  <li>
                    <button
                      id="nav-bill-confirm-sub"
                      onClick={() => { setTopTab('bill-confirm'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'bill-confirm' ? 'text-[#5a8dee]' : 'text-[#676767] hover:text-[#475f7b]'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      <span className="flex-1">Biên bản xác nhận chỉ số</span>
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-customer-debt-sub"
                      onClick={() => { setTopTab('customer-debt'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'customer-debt' ? 'text-[#5a8dee]' : 'text-[#676767] hover:text-[#475f7b]'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      <span className="flex-1">Công nợ khách hàng</span>
                      <span className="text-[10px] font-black text-red-500 shrink-0 uppercase tracking-wide">New</span>
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-quick-import-sub"
                      onClick={() => { setTopTab('quick-import'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'quick-import' ? 'text-[#5a8dee]' : 'text-[#676767] hover:text-[#475f7b]'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      <span className="flex-1">Nạp dữ liệu nhanh</span>
                      <span className="text-[10px] font-black text-red-500 shrink-0 uppercase tracking-wide">New</span>
                    </button>
                  </li>
                </motion.ul>
              )}
            </AnimatePresence>
          </li>
        </ul>
      </nav>
    </div>
  );

  /* ===================== RENDER ===================== */
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--vl-bg)' }}>

      {/* ---- SIDEBAR (mobile overlay) ---- */}
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
            <p className="text-[11px] font-semibold text-[#a3afbd] uppercase tracking-wider leading-tight hidden sm:block">
              Khối kinh doanh
            </p>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            <a
              href="/document.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full transition-colors text-[#6c757d] hover:bg-gray-100"
              title="Hướng dẫn sử dụng"
            >
              <FileText className="w-[20px] h-[20px]" />
            </a>

            <div className="w-px h-6 bg-gray-200 mx-1" />

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#5a8dee] flex items-center justify-center text-white text-[13px] font-bold shrink-0">
                {userInitial}
              </div>
              <span className="hidden md:block text-[13px] font-semibold text-[#475f7b] max-w-[200px] truncate">
                {userName}
              </span>
            </div>

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
              <BusinessSummaryDashboard />
            ) : topTab === 'quick-import' ? (
              <QuickImportManager />
            ) : topTab === 'customer-debt' ? (
              <CustomerDebtManager />
            ) : (
              <BillConfirmManager />
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="px-6 py-4">
          <div className="flex justify-end text-[.8rem]" style={{ color: 'var(--vl-light)' }}>
            <p>2026 © GETC</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
