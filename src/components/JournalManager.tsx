import { useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import HandoverManager from './HandoverManager';
import ElectricShiftManager from './ElectricShiftManager';
import { Tabs, type TabItem } from './ui/Tabs';

type JournalTab = 'schedule' | 'staff';

const TABS: TabItem<JournalTab>[] = [
  { id: 'schedule', label: 'Tạo lịch trực',          icon: CalendarDays },
  { id: 'staff',    label: 'Quản lý nhân sự trực',   icon: Users },
];

// Gộp "Tạo lịch trực" và "Quản lý nhân sự trực" thành 1 subside "Sổ nhật ký vận hành",
// chia làm 2 tab (dùng chung component Tabs với các trang khác).
export default function JournalManager() {
  const [tab, setTab] = useState<JournalTab>('schedule');

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">Sổ nhật ký vận hành</h2>
        <p className="text-soft text-sm mt-1">Quản lý lịch trực và nhân sự trực vận hành</p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {tab === 'schedule' ? <HandoverManager /> : <ElectricShiftManager />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
