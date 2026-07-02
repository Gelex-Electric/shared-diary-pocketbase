import { useState, useEffect } from 'react';
import { pb } from '../lib/pocketbase';
import {
  RefreshCw, LogOut, ClipboardList, X, Menu, ChevronDown,
  Activity, FileText, LayoutDashboard,
} from 'lucide-react';
import { NewUpdate } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import SummaryDashboard from './SummaryDashboard';
import CustomerManager from './CustomerManager';
import HesReadingManager from './hes/HesReadingManager';
import VoltagePowerDashboard from './VoltagePowerDashboard';
import JournalManager from './JournalManager';
import PowerOutageManager from './PowerOutageManager';
import NewUpdateTour from './NewUpdateTour';
import SldPage from './sld/SldPage';
import NotificationBell from './ui/NotificationBell';
import ThemeToggle from './ui/ThemeToggle';

type Tab = 'summary' | 'journal' | 'outage' | 'handover-record' | 'operating' | 'hes' | 'opchart' | 'sld' | 'later';

const TAB_LABEL: Record<Tab, string> = {
  summary:   'Dashboard',
  journal:   'Hồ sơ vận hành',
  outage:            'Thông báo ngừng cấp điện',
  'handover-record': 'Biên bản treo tháo',
  operating: 'Thông số vận hành',
  hes:       'Lấy chỉ số HES',
  opchart:   'Đồ thị điện áp & công suất',
  sld:       'Sơ đồ một sợi',
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

  // Accordion: mở nhóm này thì nhóm kia tự đóng
  const toggleSection = (section: 'journal' | 'operating') => {
    if (section === 'journal') {
      const willOpen = !isJournalExpanded;
      setIsJournalExpanded(willOpen);
      if (willOpen) setIsOperatingExpanded(false);
    } else {
      const willOpen = !isOperatingExpanded;
      setIsOperatingExpanded(willOpen);
      if (willOpen) setIsJournalExpanded(false);
    }
  };

  const userName    = pb.authStore.model?.name || 'Người dùng';
  const userArea    = pb.authStore.model?.area  || '';
  const userInitial = userName[0] || 'U';

  /* -------- Sidebar nav content (pure nav, no user / help) -------- */
  const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* Logo */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-[var(--on-accent)]" />
          </div>
          <div className="leading-tight">
            <p className="text-[0.7rem] font-semibold text-faint uppercase tracking-wider">Nhóm Vận Hành</p>
            <p className="text-[0.95rem] font-bold text-accent leading-snug">Phần mềm Kỹ thuật - Kinh Doanh</p>
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

          {/* Hồ sơ vận hành */}
          <li className="relative mt-1">
            <button
              id="nav-journal"
              onClick={() => toggleSection('journal')}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'journal' || topTab === 'outage' || topTab === 'handover-record' ? 'vl-sidebar-active text-accent' : 'text-dim hover:bg-subtle'
              }`}
            >
              <ClipboardList className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Hồ sơ vận hành</span>
              <ChevronDown className={`w-4 h-4 text-faint transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
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
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'journal' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      Sổ nhật ký vận hành
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-outage-sub"
                      onClick={() => { setTopTab('outage'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'outage' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      Thông báo ngừng cấp điện
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-handover-record-sub"
                      onClick={() => { setTopTab('handover-record'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'handover-record' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      <span className="flex-1">Biên bản treo tháo</span>
                      <span className="text-[10px] font-black text-amber-500 shrink-0 uppercase tracking-wide">Beta</span>
                    </button>
                  </li>
                </motion.ul>
              )}
            </AnimatePresence>
          </li>

          {/* Thông số vận hành */}
          <li className="relative mt-1">
            <button
              onClick={() => toggleSection('operating')}
              className={`vl-sidebar-link relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all ${
                topTab === 'operating' || topTab === 'hes' || topTab === 'opchart' || topTab === 'sld' ? 'vl-sidebar-active text-accent' : 'text-dim hover:bg-subtle'
              }`}
            >
              <Activity className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Thông số vận hành</span>
              <ChevronDown className={`w-4 h-4 text-faint transition-transform duration-300 ${isOperatingExpanded ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
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
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'operating' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      Thông tin khách hàng &amp; Công tơ
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-hes-sub"
                      onClick={() => { setTopTab('hes'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'hes' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      Lấy chỉ số từ HES
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-opchart-sub"
                      onClick={() => { setTopTab('opchart'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'opchart' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      <span className="flex-1">Đồ thị điện áp &amp; công suất</span>
                      <span className="text-[10px] font-black text-red-500 shrink-0 uppercase tracking-wide">New</span>
                    </button>
                  </li>
                  <li>
                    <button
                      id="nav-sld-sub"
                      onClick={() => { setTopTab('sld'); onNavigate?.(); }}
                      className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                        topTab === 'sld' ? 'text-accent' : 'text-soft hover:text-dim'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                      <span className="flex-1">Sơ đồ một sợi</span>
                      <span className="text-[10px] font-black text-red-500 shrink-0 uppercase tracking-wide">New</span>
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
                topTab === 'later' ? 'vl-sidebar-active text-accent' : 'text-dim hover:bg-subtle'
              }`}
            >
              <RefreshCw className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Cập nhật sau</span>
              <span className="text-[10px] font-black text-amber-500 shrink-0 uppercase tracking-wide">Beta</span>
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
          <NewUpdateTour
            onDismiss={dismissNewUpdate}
            onClose={closeNewUpdateForNow}
            onNavigate={(tab) => {
              setTopTab(tab);
              // Mở sẵn nhóm sidebar chứa tab đích để người dùng thấy ngữ cảnh
              if (tab === 'journal') { setIsJournalExpanded(true); setIsOperatingExpanded(false); }
              else if (tab === 'operating' || tab === 'hes' || tab === 'opchart' || tab === 'sld') { setIsOperatingExpanded(true); setIsJournalExpanded(false); }
            }}
          />
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
            {userArea && (
              <p className="text-[11px] font-semibold text-faint uppercase tracking-wider leading-tight hidden sm:block">
                {userArea}
              </p>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Help / Hướng dẫn */}
            <a
              href="/document.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className={`p-2 rounded-full transition-colors ${
                showNewUpdate
                  ? 'text-accent bg-accent-soft animate-pulse'
                  : 'text-soft hover:bg-subtle'
              }`}
              title="Hướng dẫn sử dụng"
            >
              <FileText className="w-[20px] h-[20px]" />
            </a>

            {/* Thông báo */}
            <NotificationBell />

            {/* Theme */}
            <ThemeToggle />

            {/* Divider */}
            <div className="w-px h-6 bg-[var(--border)] mx-1" />

            {/* User avatar + name */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-[var(--on-accent)] text-[13px] font-bold shrink-0">
                {userInitial}
              </div>
              <span className="hidden md:block text-[13px] font-semibold text-dim max-w-[200px] truncate">
                {userName}
              </span>
            </div>

            {/* Logout */}
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
              <SummaryDashboard />
            ) : topTab === 'operating' ? (
              <CustomerManager />
            ) : topTab === 'hes' ? (
              <HesReadingManager />
            ) : topTab === 'opchart' ? (
              <VoltagePowerDashboard />
            ) : topTab === 'sld' ? (
              <div className="vl-card" style={{ height: 'calc(100vh - 180px)', minHeight: 520, padding: 0, overflow: 'hidden' }}>
                <SldPage />
              </div>
            ) : topTab === 'journal' ? (
              <JournalManager />
            ) : topTab === 'outage' ? (
              <PowerOutageManager />
            ) : topTab === 'handover-record' ? (
              <div className="vl-card flex flex-col items-center justify-center py-24 gap-4 text-faint">
                <RefreshCw className="w-14 h-14 animate-[spin_3s_linear_infinite] text-faint" />
                <p className="text-base font-bold text-dim">Tính năng đang được phát triển</p>
                <p className="text-sm text-soft">Biên bản treo tháo sẽ sớm được ra mắt trong phiên bản tiếp theo.</p>
              </div>
            ) : (
              <div className="vl-card flex flex-col items-center justify-center py-20">
                <RefreshCw className="w-14 h-14 mb-4 animate-[spin_3s_linear_infinite] text-faint" />
                <h3 className="text-lg font-bold text-dim">
                  Tính năng đang được phát triển
                </h3>
                <p className="text-soft text-[0.875rem] mt-1">
                  Vui lòng quay lại sau
                </p>
              </div>
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
