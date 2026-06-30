import { useState } from 'react';
import { Hand, Database } from 'lucide-react';
import HesManualManager from './HesManualManager';
import HesDirectManager from './HesDirectManager';
import { Tabs, type TabItem } from './ui/Tabs';
import { motion, AnimatePresence } from 'motion/react';

type HesTab = 'manual' | 'direct';

const TABS: TabItem<HesTab>[] = [
  { id: 'manual', label: 'Lấy chỉ số thủ công', sub: 'Gọi trực tiếp HES theo thời điểm', icon: Hand },
  { id: 'direct', label: 'Lấy trực tiếp',        sub: 'Đọc chỉ số tự động theo khoảng ngày', icon: Database },
];

export default function HesReadingManager() {
  const [tab, setTab] = useState<HesTab>('manual');

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {tab === 'manual' ? <HesManualManager /> : <HesDirectManager />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
