import { useState } from 'react';
import { CalendarDays, CalendarRange, Users, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import HandoverManager from './HandoverManager';
import ShiftRosterManager from './ShiftRosterManager';
import ElectricShiftManager, { type StaffKind } from './ElectricShiftManager';
import { Tabs, type TabItem } from './ui/Tabs';

type JournalTab = 'roster' | 'schedule' | 'staff';

const TABS: TabItem<JournalTab>[] = [
  { id: 'roster',   label: 'Tạo ca trực tháng',      icon: CalendarRange },
  { id: 'schedule', label: 'Tạo lịch trực',          icon: CalendarDays },
  { id: 'staff',    label: 'Quản lý nhân sự trực',   icon: Users },
];

const STAFF_TABS: TabItem<StaffKind>[] = [
  { id: 'duty',  label: 'Trực đội QLVH',    icon: Users },
  { id: 'power', label: 'Điều độ điện lực', icon: Zap },
];

// "Sổ nhật ký vận hành": lập lịch trực tháng (phân ca) → nhập nội dung từng ca (nhân sự tự điền
// theo lịch tháng) → danh mục nhân sự (trực đội + điều độ). Dùng chung component Tabs.
export default function JournalManager() {
  const [tab, setTab] = useState<JournalTab>('schedule');
  const [staffKind, setStaffKind] = useState<StaffKind>('duty');

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">Sổ nhật ký vận hành</h2>
        <p className="text-soft text-sm mt-1">Lập lịch trực tháng, nhập nội dung ca trực và quản lý nhân sự trực</p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={t => setTab(t)} />

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {tab === 'roster' && <ShiftRosterManager />}
          {tab === 'schedule' && <HandoverManager />}
          {tab === 'staff' && (
            <div className="space-y-6">
              <Tabs tabs={STAFF_TABS} value={staffKind} onChange={k => setStaffKind(k)} />
              <ElectricShiftManager key={staffKind} kind={staffKind} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
