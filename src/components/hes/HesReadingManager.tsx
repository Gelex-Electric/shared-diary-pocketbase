import { useState } from 'react';
import { Hand, Database, Clock, FileText } from 'lucide-react';
import HesManualManager from './HesManualManager';
import HesDirectManager from './HesDirectManager';
import Hes30MinManager from './Hes30MinManager';
import HesInvoiceManager from './HesInvoiceManager';
import OfficeHesManualManager from '../business/OfficeHesManualManager';
import OfficeHesDirectManager from '../business/OfficeHesDirectManager';
import { Tabs, type TabItem } from '../ui/Tabs';
import { motion, AnimatePresence } from 'motion/react';
import type { Scope } from '../../lib/scope';

type HesTab = 'manual' | 'direct' | 'min30' | 'invoice';

/*
  TÊN TAB TRƯỚC ĐÂY ĐẶT NGƯỢC (sửa 04/09/2026).

  "Lấy trực tiếp" lại là tab ĐỌC FILE đã chốt sẵn, còn "thủ công" mới là tab GỌI
  THẲNG API HES ngay lúc bấm. Người dùng đọc tên xong chọn nhầm tab là chuyện
  đương nhiên. Đặt lại theo đúng thứ chúng làm.

  Bốn tab hiện tại, theo thứ tự "tươi" dần về phía số liệu chốt (16/09/2026):
    manual  — gọi HES ngay, mốc bất kỳ kể cả hôm nay
    direct  — file chỉ số ngày của pipeline (SẼ BỎ khi hai tab mới ổn định)
    min30   — chi tiết 30 phút, 30 ngày gần nhất
    invoice — chỉ số trên hóa đơn, số liệu có giá trị pháp lý
*/
const TABS: TabItem<HesTab>[] = [
  { id: 'manual', label: 'Gọi HES ngay', sub: 'Chọn mốc thời gian, đọc chỉ số tức thời', icon: Hand },
  { id: 'direct', label: 'Số liệu đã chốt', sub: 'Đọc chỉ số pipeline chốt hằng đêm, theo khoảng ngày', icon: Database },
  { id: 'min30', label: 'Chỉ số trong 30 ngày', sub: 'Chi tiết 30 phút, chọn được mốc giờ', icon: Clock },
  { id: 'invoice', label: 'Chỉ số theo hóa đơn', sub: 'Số liệu pháp lý trên hóa đơn, theo tháng', icon: FileText },
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
            : tab === 'min30'
              ? <Hes30MinManager scope={scope} />
              : tab === 'invoice'
                ? <HesInvoiceManager scope={scope} />
                : (office ? <OfficeHesDirectManager /> : <HesDirectManager />)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
