import { useState } from 'react';
import { Hand, Clock, FileText } from 'lucide-react';
import HesManualManager from './HesManualManager';
import Hes30MinManager from './Hes30MinManager';
import HesInvoiceManager from './HesInvoiceManager';
import OfficeHesManualManager from '../business/OfficeHesManualManager';
import { Tabs, type TabItem } from '../ui/Tabs';
import { motion, AnimatePresence } from 'motion/react';
import type { Scope } from '../../lib/scope';

type HesTab = 'manual' | 'min30' | 'invoice';

/*
  TÊN TAB TRƯỚC ĐÂY ĐẶT NGƯỢC (sửa 04/09/2026): "Lấy trực tiếp" lại là tab đọc
  file đã chốt sẵn, còn "thủ công" mới là tab gọi thẳng API HES. Đặt lại theo
  đúng thứ chúng làm.

  Ba tab hiện tại (16/09/2026):
    manual  — gọi HES ngay, mốc bất kỳ kể cả hôm nay
    min30   — chi tiết 30 phút, 30 ngày gần nhất, chọn được mốc giờ
    invoice — chỉ số trên hóa đơn, số liệu có giá trị pháp lý

  Đã BỎ tab "Số liệu đã chốt" (đọc `hes_index_daily.csv`): tab "Chỉ số theo hóa
  đơn" làm đúng việc đó bằng nguồn chuẩn hơn, mà tab cũ còn bắt trình duyệt tải
  trọn file 2,9 MB rồi vứt gần hết — nó chỉ dùng 2 dòng mỗi công tơ.
*/
const TABS: TabItem<HesTab>[] = [
  { id: 'manual', label: 'Gọi HES ngay', sub: 'Chọn mốc thời gian, đọc chỉ số tức thời', icon: Hand },
  { id: 'min30', label: 'Chỉ số trong 30 ngày', sub: 'Chi tiết 30 phút, chọn được mốc giờ', icon: Clock },
  { id: 'invoice', label: 'Chỉ số theo hóa đơn', sub: 'Số liệu pháp lý trên hóa đơn, theo tháng', icon: FileText },
];

/**
 * Lấy chỉ số HES — 3 tab.
 * `scope='doi'`      → bản khối Vận hành: lọc theo KCN của user, 1 bảng phẳng.
 * `scope='vanphong'` → bản khối Văn phòng: mỗi KCN một bảng.
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
            : tab === 'min30'
              ? <Hes30MinManager scope={scope} />
              : <HesInvoiceManager scope={scope} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
