/**
 * Màn "Quản lý chung" — thuộc nhóm "Quản lý vật tư thiết bị điện" (khối Văn phòng).
 *
 * Đúng 2 tab theo yêu cầu:
 *   1. Sơ đồ quan hệ — chỉ hiển thị cây quan hệ giữa các bảng, không nhập liệu.
 *   2. Nhập liệu     — các vùng nhập, ghi thẳng vào 4 collection `dm_*`.
 *
 * Nhận prop `scope` ngay từ đầu (hiện chỉ gọi với 'vanphong') để sau này mở cho
 * khối Vận hành không phải chép file — nguyên tắc 17 trong ARCHITECTURE.md.
 */
import { useState } from 'react';
import { GitBranch, PencilLine } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import type { Scope } from '../../lib/scope';
import RelationTree from './RelationTree';
import DataEntry from './DataEntry';

type SubTab = 'tree' | 'entry';

const TABS: TabItem<SubTab>[] = [
  { id: 'tree', label: 'Sơ đồ quan hệ', icon: GitBranch, sub: 'Cây quan hệ giữa các bảng danh mục' },
  { id: 'entry', label: 'Nhập liệu', icon: PencilLine, sub: 'Khai KCN, trạm, khách hàng, điểm đo' },
];

export default function GeneralManagement({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  const [tab, setTab] = useState<SubTab>('tree');

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} value={tab} onChange={t => setTab(t)} />
      {tab === 'tree' ? <RelationTree /> : <DataEntry />}
    </div>
  );
}
