import { useState } from 'react';
import { Hand, Database } from 'lucide-react';
import OfficeHesManualManager from './OfficeHesManualManager';
import OfficeHesDirectManager from './OfficeHesDirectManager';
import { Tabs, type TabItem } from '../ui/Tabs';
import { motion, AnimatePresence } from 'motion/react';

type HesTab = 'manual' | 'direct';

const TABS: TabItem<HesTab>[] = [
  { id: 'manual', label: 'Lấy chỉ số thủ công', sub: 'Gọi trực tiếp HES theo thời điểm', icon: Hand },
  { id: 'direct', label: 'Lấy trực tiếp',        sub: 'Đọc chỉ số tự động theo khoảng ngày', icon: Database },
];

// ===================================================================
// Lấy chỉ số HES — bản khối Văn phòng (mỗi tab hiển thị theo KCN).
// ===================================================================
export default function OfficeHesReadingManager() {
  const [tab, setTab] = useState<HesTab>('manual');

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} value={tab} onChange={t => setTab(t)} />
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {tab === 'manual' ? <OfficeHesManualManager /> : <OfficeHesDirectManager />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
