/**
 * Khung màn hình NHÓM VẬT TƯ (`users.nhom = vat_tu`, user chốt 23/10/2026 —
 * plan `2026-10-23-ba-nhom-dang-nhap-nhom-vat-tu.md`).
 *
 * Nhóm này chỉ lo khai vật tư vào danh mục, nên chỉ có một nhóm menu
 * "Quản lý vật tư thiết bị điện":
 *  - Quản lý chung: cây KCN → Lộ → Trạm → Điểm đo (chỉ xem — `DataTree` không ghi).
 *  - Danh mục: CHỈ tab Kho vật tư (toàn quyền) + Rà soát vòng đời (chỉ tra cứu).
 *
 * Sidebar + thanh trên chép bố cục `business/BusinessDashboard.tsx` (cùng lớp
 * `vl-*`, cùng kích thước) để hai khối trông như một sản phẩm. Sửa khung thì
 * sửa cả hai chỗ. Màn con dùng `scope="vanphong"` = xem toàn bộ KCN.
 *
 * Lưu ý: chỉ giới hạn ở GIAO DIỆN — rule PocketBase của `dm_*` vẫn cho mọi
 * tài khoản đăng nhập ghi.
 */
import { useState } from 'react';
import { pb } from '../../lib/pocketbase';
import { LogOut, X, Menu, ChevronDown, FileText, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import GeneralManagement from '../dm/GeneralManagement';
import CatalogEntry, { type CatTab } from '../dm/CatalogEntry';
import ThemeToggle from '../ui/ThemeToggle';
import { GROUP_LABEL } from '../../lib/userGroup';

type Tab = 'dm-general' | 'dm-catalog';

const TAB_LABEL: Record<Tab, string> = {
  'dm-general': 'Quản lý chung',
  'dm-catalog': 'Danh mục',
};
const NAV: { id: Tab; label: string }[] = [
  { id: 'dm-general', label: TAB_LABEL['dm-general'] },
  { id: 'dm-catalog', label: TAB_LABEL['dm-catalog'] },
];
/** Kho vật tư đứng đầu ⇒ mở Danh mục là vào thẳng Kho. */
const CATALOG_TABS: CatTab[] = ['stock', 'lifecycle'];

export default function MaterialDashboard() {
  const [topTab, setTopTab] = useState<Tab>('dm-catalog');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAssetExpanded, setIsAssetExpanded] = useState(true);

  const handleLogout = () => { pb.authStore.clear(); window.location.reload(); };

  const userName    = pb.authStore.model?.name || 'Người dùng';
  const userInitial = userName[0] || 'U';

  const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* Logo */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-[var(--on-accent)]" />
          </div>
          <div className="leading-tight">
            <p className="text-[0.7rem] font-semibold text-faint uppercase tracking-wider">{GROUP_LABEL.vat_tu}</p>
            <p className="text-[0.95rem] font-bold text-accent leading-snug">Phần mềm hệ thống GETC</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-4">
        <p className="vl-section-title">Menu chính</p>
        <ul className="list-none px-0 mt-2">
          <li className="relative mt-1">
            <button
              id="nav-asset"
              onClick={() => setIsAssetExpanded(v => !v)}
              className="vl-sidebar-link vl-sidebar-active text-accent relative w-full flex items-center gap-4 px-6 py-[.7rem] text-[.875rem] font-semibold transition-all"
            >
              <Package className="w-5 h-5 shrink-0" />
              <span className="flex-1 text-left">Quản lý vật tư thiết bị điện</span>
              <ChevronDown className={`w-4 h-4 text-faint transition-transform duration-300 ${isAssetExpanded ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {isAssetExpanded && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden list-none px-0"
                >
                  {NAV.map(n => (
                    <li key={n.id}>
                      <button
                        id={`nav-${n.id}-sub`}
                        onClick={() => { setTopTab(n.id); onNavigate?.(); }}
                        className={`w-full text-left flex items-center gap-2 px-9 py-[.7rem] text-[.78rem] font-medium tracking-wide transition-all hover:translate-x-1 ${
                          topTab === n.id ? 'text-accent' : 'text-soft hover:text-dim'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-50" />
                        <span className="flex-1">{n.label}</span>
                      </button>
                    </li>
                  ))}
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

        <nav
          className="sticky top-0 z-20 bg-surface flex items-center px-4 md:px-6 gap-3"
          style={{ height: 70, borderBottom: '1px solid var(--border)' }}
        >
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-subtle transition-colors text-soft"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0">
            <h2 className="text-[1.1rem] font-bold text-ink leading-tight truncate">
              {TAB_LABEL[topTab]}
            </h2>
            <p className="text-[11px] font-semibold text-faint uppercase tracking-wider leading-tight hidden sm:block">
              Khối vật tư
            </p>
          </div>

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

        <div className="flex-1 px-4 py-6 md:px-6 md:py-8">
          <section>
            {topTab === 'dm-general' ? (
              <GeneralManagement scope="vanphong" />
            ) : (
              <CatalogEntry key="dm-catalog" scope="vanphong" tabs={CATALOG_TABS} />
            )}
          </section>
        </div>

        <footer className="px-6 py-4">
          <div className="flex justify-end text-[.8rem]" style={{ color: 'var(--vl-light)' }}>
            <p>2026 © GETC</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
