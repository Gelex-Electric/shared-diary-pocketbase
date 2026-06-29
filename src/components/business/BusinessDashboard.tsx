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
import NotificationBell from '../ui/NotificationBell';
import ThemeToggle from '../ui/ThemeToggle';

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
          <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Briefcase className="w-5 h-5 text-[var(--on-accent)]" />
          </div>
          <div className="leading-tight">
            <p className="text-[0.7rem] font-semibold text-faint uppercase tracking-wider">Phần mềm</p>
            <p className="text-[0.95rem] font-bold text-accent leading-snug">Khối kinh doanh GETC</p>
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
                topTab === 'summary' ? 'vl-sidebar-active text-accent' : 'text-dim hover:bg-subtle'
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
                topTab === 'bill-confirm' || topTab === 'quick-import' || topTab === 'customer-debt' ? 'vl-sidebar-active text-accent' : 'text-dim hover:bg-subtle'
              }`}
            >
              <Briefcase className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Hồ sơ kinh doanh</span>
              <ChevronDown className={`w-4 h-4 text-faint transition-transform duration-300 ${isBusinessExpanded ? 'rotate-180' : ''}`} />
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
                        topTab === 'bill-confirm' ? 'text-accent' : 'text-soft hover:text-dim'
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
                        topTab === 'customer-debt' ? 'text-accent' : 'text-soft hover:text-dim'
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
                        topTab === 'quick-import' ? 'text-accent' : 'text-soft hover:text-dim'
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
            className="fixed top-0 left-0 z-50 h-screen bg-surface lg:hidden"
            style={{ width: 260, borderRight: '1px solid var(--border)' }}
          >
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="absolute top-2 right-2 p-2 rounded-lg hover:bg-subtle transition-colors text-soft"
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarNav onNavigate={() => setIsSidebarOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <aside
        className="hidden lg:block fixed top-0 left-0 h-screen bg-surface z-30"
        style={{ width: 260, borderRight: '1px solid var(--border)' }}
      >
        <SidebarNav />
      </aside>

      {/* ---- MAIN ---- */}
      <div className="lg:ml-[260px] flex flex-col min-h-screen">

        {/* Navbar — page title left, user actions right */}
        <nav
          className="sticky top-0 z-20 bg-surface flex items-center px-4 md:px-6 gap-3"
          style={{ height: 70, borderBottom: '1px solid var(--border)' }}
        >
          {/* Mobile hamburger */}
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-subtle transition-colors text-soft"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Current page title */}
          <div className="flex-1 min-w-0">
            <h2 className="text-[1.1rem] font-bold text-ink leading-tight truncate">
              {TAB_LABEL[topTab]}
            </h2>
            <p className="text-[11px] font-semibold text-faint uppercase tracking-wider leading-tight hidden sm:block">
              Khối kinh doanh
            </p>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            <a
              href="/document.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full transition-colors text-soft hover:bg-subtle"
              title="Hướng dẫn sử dụng"
            >
              <FileText className="w-[20px] h-[20px]" />
            </a>

            {/* Thông báo */}
            <NotificationBell />

            {/* Theme */}
            <ThemeToggle />

            <div className="w-px h-6 bg-[var(--border)] mx-1" />

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-[var(--on-accent)] text-[13px] font-bold shrink-0">
                {userInitial}
              </div>
              <span className="hidden md:block text-[13px] font-semibold text-dim max-w-[200px] truncate">
                {userName}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 rounded-full hover:bg-[var(--danger-soft)] transition-colors text-bad"
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
