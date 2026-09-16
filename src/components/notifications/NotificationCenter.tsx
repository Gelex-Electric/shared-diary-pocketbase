import { useState, useEffect, useCallback, useMemo } from 'react';
import { Bell, CreditCard, TrendingDown, Gauge, Building2, Cable, Inbox, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tabs, type TabItem } from '../ui/Tabs';
import { NotificationList } from './NotificationList';
import {
  fetchNotifications, countByKind, kindOf, markAllRead, getLastRead,
  NOTIF_KINDS, type NotificationRecord,
} from '../../lib/notifications';

/* ================================================================
   Màn "Thông báo" — mỗi NHÓM nghiệp vụ một sub-tab.

   Chuông ở thanh trên chỉ trả lời "có gì mới?" bằng vài dòng tóm tắt;
   màn này trả lời "cụ thể là gì?" bằng từng bản ghi.

   Phạm vi theo khu vực của tài khoản (xem `lib/notifications.ts`):
   '' = khối Kinh doanh, tên KCN = khối Vận hành của KCN đó.
================================================================ */

/** Biểu tượng cho từng nhóm. Để ở component vì lib giữ thuần, không nhập icon. */
const KIND_ICON: Record<string, LucideIcon> = {
  thanhtoan: CreditCard,
  lui: TrendingDown,
  hsn: Gauge,
  tram: Building2,
  congto: Cable,
  '': Inbox,
};

export default function NotificationCenter({ initialKind }: { initialKind?: string }) {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>(initialKind ?? NOTIF_KINDS[0].kind);

  /*
    Chốt mốc đọc NGAY khi mở màn, nhưng GIỮ mốc CŨ trong state để hiển thị.

    Nếu lấy mốc mới để tô "mới" thì vừa mở ra là mọi dấu biến mất, người dùng
    không kịp thấy cái gì vừa tới. Số trên sidebar thì về 0 đúng như mong đợi.
  */
  const [lastRead] = useState<string>(() => {
    const before = getLastRead();
    markAllRead();
    return before;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchNotifications());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Bấm một dòng ở chuông thì mở đúng nhóm đó. */
  useEffect(() => { if (initialKind != null) setTab(initialKind); }, [initialKind]);

  const counts = useMemo(() => countByKind(items), [items]);
  const shown = useMemo(() => items.filter(r => kindOf(r) === tab), [items, tab]);

  /* Sub-tab LUÔN đủ mọi nhóm, kể cả nhóm rỗng — người dùng cần biết hệ thống có
     theo dõi loại cảnh báo đó mà hiện chưa có gì. Số đếm ghi ngay trên nhãn. */
  const tabs: TabItem<string>[] = NOTIF_KINDS.map(k => ({
    id: k.kind,
    label: counts[k.kind] ? `${k.label} (${counts[k.kind]})` : k.label,
    sub: k.desc,
    icon: KIND_ICON[k.kind] ?? Inbox,
  }));

  const total = items.length;

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="flex items-center gap-2 text-sm text-soft">
          <Bell className="w-4 h-4 text-accent" />
          <span>{total} thông báo trong phạm vi của bạn</span>
        </div>
        <button onClick={load} disabled={loading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <NotificationList
        items={shown}
        lastRead={lastRead}
        loading={loading}
        empty={`Chưa có thông báo nào ở mục "${NOTIF_KINDS.find(k => k.kind === tab)?.label}"`}
      />
    </div>
  );
}
