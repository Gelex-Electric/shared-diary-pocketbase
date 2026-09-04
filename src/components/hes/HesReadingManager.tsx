import { useState } from 'react';
import { Hand, Database } from 'lucide-react';
import HesManualManager from './HesManualManager';
import HesDirectManager from './HesDirectManager';
import OfficeHesManualManager from '../business/OfficeHesManualManager';
import OfficeHesDirectManager from '../business/OfficeHesDirectManager';
import { Tabs, type TabItem } from '../ui/Tabs';
import { motion, AnimatePresence } from 'motion/react';
import type { Scope } from '../../lib/scope';

type HesTab = 'manual' | 'direct';

/*
  TÊN TAB TRƯỚC ĐÂY ĐẶT NGƯỢC (sửa 04/09/2026).

  "Lấy trực tiếp" lại là tab ĐỌC FILE `hes_index_daily.csv` đã chốt sẵn, còn
  "thủ công" mới là tab GỌI THẲNG API HES ngay lúc bấm. Người dùng đọc tên xong
  chọn nhầm tab là chuyện đương nhiên.

  Đặt lại theo đúng thứ chúng làm: một bên gọi HES ngay, một bên đọc số liệu
  pipeline đã chốt hằng đêm.
*/
const TABS: TabItem<HesTab>[] = [
  { id: 'manual', label: 'Gọi HES ngay', sub: 'Chọn mốc thời gian, đọc chỉ số tức thời', icon: Hand },
  { id: 'direct', label: 'Số liệu đã chốt', sub: 'Đọc chỉ số pipeline chốt hằng đêm, theo khoảng ngày', icon: Database },
];

/**
 * Lấy chỉ số HES — 2 tab (thủ công / trực tiếp).
 * `scope='doi'`      → bản khối Vận hành: lọc theo KCN của user, 1 bảng phẳng.
 * `scope='vanphong'` → bản khối Văn phòng: mỗi tab hiển thị theo từng KCN.
 */
export default function HesReadingManager({ scope = 'doi' }: { scope?: Scope }) {
  const [tab, setTab] = useState<HesTab>('manual');
  const office = scope === 'vanphong';

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
          {tab === 'manual'
            ? (office ? <OfficeHesManualManager /> : <HesManualManager />)
            : (office ? <OfficeHesDirectManager /> : <HesDirectManager />)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
