/**
 * Khu vực "Quản lý vận hành" — một mục trong menu, chia thành 2 tab ngang:
 * Tổng hợp và Danh sách hợp đồng.
 *
 * Gộp lại từ 2 mục menu riêng (user chốt 21/08/2026): hai màn cùng một bộ dữ
 * liệu, tách ra hai mục menu khiến phải quay ra menu mới đổi được góc nhìn.
 */

import { useState } from 'react';
import { FileText, LayoutDashboard } from 'lucide-react';
import { Tabs, type TabItem } from '../ui/Tabs';
import type { Scope } from '../../lib/scope';
import QlvhSummary from './QlvhSummary';
import ContractListManager from './ContractListManager';

type Tab = 'summary' | 'contracts';

const TABS: TabItem<Tab>[] = [
  { id: 'summary',   label: 'Tổng hợp',            icon: LayoutDashboard },
  { id: 'contracts', label: 'Danh sách hợp đồng',  icon: FileText },
];

export default function QlvhPage({ scope }: { scope: Scope }) {
  const [tab, setTab] = useState<Tab>('summary');

  return (
    <div>
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'summary' ? <QlvhSummary scope={scope} /> : <ContractListManager scope={scope} />}
    </div>
  );
}
