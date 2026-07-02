import { useState, useEffect, useRef, useCallback } from 'react';
import { pb } from '../../lib/pocketbase';
import { Bell, CheckCheck, Wallet, Info } from 'lucide-react';

/* ============================================================
   NotificationBell — chuông thông báo dùng chung cho cả khối
   Vận hành và Kinh doanh. Đọc từ collection PocketBase `notifications`
   (chia sẻ giữa 2 khối), cập nhật realtime. Trạng thái "đã đọc"
   lưu cục bộ bằng localStorage (mốc thời gian đọc gần nhất) nên
   KHÔNG cần thêm field per-user trên server.
============================================================ */

export interface NotificationRecord {
  id: string;
  title: string;
  message: string;
  type?: string;   // 'payment' | 'info' | ...
  mkh?: string;
  area?: string;   // '' = khối Kinh doanh; tên KCN = khối Vận hành của KCN đó
  created: string;
}

const LAST_READ_KEY = 'getc_notif_last_read';
const COLLECTION = 'notifications';
// Giới hạn số thông báo giữ lại cho MỖI khu vực Vận hành (khối Kinh doanh area="" không giới hạn)
const MAX_PER_AREA = 10;

/* ── Thông báo cục bộ (không lưu server) ──────────────────────
   Dùng cho cảnh báo suy ra từ dữ liệu tại client (vd "Cảnh báo công nợ")
   cần luôn hiện trong chuông trong khi điều kiện còn đúng. Lưu ở module-level
   nên không mất khi component dashboard unmount/remount (chuyển tab). */
let localNotifs: NotificationRecord[] = [];
const localListeners = new Set<() => void>();
const emitLocal = () => localListeners.forEach(fn => fn());

export function setLocalNotification(n: { id: string; title: string; message: string; type?: string }) {
  const idx = localNotifs.findIndex(x => x.id === n.id);
  if (idx >= 0) {
    // Cập nhật nội dung nhưng GIỮ thời điểm tạo cũ (không re-alert liên tục)
    localNotifs[idx] = { ...localNotifs[idx], title: n.title, message: n.message, type: n.type };
  } else {
    localNotifs = [{ ...n, area: '', created: new Date().toISOString().replace('T', ' ') }, ...localNotifs];
  }
  emitLocal();
}

export function clearLocalNotification(id: string) {
  const before = localNotifs.length;
  localNotifs = localNotifs.filter(x => x.id !== id);
  if (localNotifs.length !== before) emitLocal();
}

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [local, setLocal] = useState<NotificationRecord[]>(localNotifs);
  const [lastRead, setLastRead] = useState<string>(() => localStorage.getItem(LAST_READ_KEY) || '');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Đăng ký nhận thông báo cục bộ (vd cảnh báo công nợ)
  useEffect(() => {
    const fn = () => setLocal([...localNotifs]);
    localListeners.add(fn);
    fn();
    return () => { localListeners.delete(fn); };
  }, []);

  // Khu vực của tài khoản hiện tại: '' = Kinh doanh, tên KCN = Vận hành
  const myArea = (pb.authStore.model?.area as string) || '';

  const load = useCallback(async () => {
    try {
      const res = await pb.collection(COLLECTION).getList<NotificationRecord>(1, 50, {
        filter: pb.filter('area = {:area}', { area: myArea }),
        sort: '-created',
        requestKey: null,
      });
      setItems(res.items);
    } catch {
      // Collection chưa tạo hoặc không có quyền — bỏ qua, không làm vỡ giao diện
    }
  }, [myArea]);

  useEffect(() => {
    load();
    // Realtime: tự cập nhật khi có thông báo mới — chỉ nhận thông báo đúng khu vực
    let unsub: (() => void) | undefined;
    pb.collection(COLLECTION)
      .subscribe('*', e => {
        if (((e.record.area as string) || '') !== myArea) return;
        setItems(prev => {
          if (e.action === 'create') return [e.record as any, ...prev].slice(0, 50);
          if (e.action === 'delete') return prev.filter(it => it.id !== e.record.id);
          if (e.action === 'update') return prev.map(it => (it.id === e.record.id ? (e.record as any) : it));
          return prev;
        });
      })
      .then(fn => { unsub = fn; })
      .catch(() => {});
    return () => { if (unsub) unsub(); };
  }, [load, myArea]);

  /* Đóng khi click ngoài */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Gộp thông báo cục bộ + server, mới nhất lên đầu
  const merged = [...local, ...items].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const unreadCount = merged.filter(it => !lastRead || it.created > lastRead).length;

  const markAllRead = () => {
    const now = new Date().toISOString().replace('T', ' ');
    localStorage.setItem(LAST_READ_KEY, now);
    setLastRead(now);
  };

  const toggle = () => {
    setOpen(o => {
      const next = !o;
      if (next) load(); // mở lại thì làm mới danh sách
      return next;
    });
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={toggle}
        title="Thông báo"
        className={`relative p-2 rounded-full transition-colors ${
          open ? 'text-accent bg-accent-soft' : 'text-soft hover:bg-subtle'
        }`}
      >
        <Bell className="w-[20px] h-[20px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-[#ff5b5c] text-white text-[9px] font-black leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-2rem)] bg-surface rounded-2xl overflow-hidden z-[200] animate-in fade-in slide-in-from-top-2 duration-150"
          style={{ boxShadow: '0 12px 32px 0 rgba(25,42,70,0.18)', border: '1px solid var(--surface-inset)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-subtle/60">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-accent" />
              <span className="text-sm font-black text-dim">Thông báo</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#ff5b5c] text-white text-[9px] font-black">{unreadCount} mới</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] font-bold text-accent hover:text-[var(--accent-hover)] transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Đánh dấu đã đọc
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[var(--border)]">
            {merged.length === 0 ? (
              <div className="py-12 text-center text-faint">
                <Bell className="w-8 h-8 text-faint mx-auto mb-2" />
                <p className="text-xs font-semibold">Chưa có thông báo nào</p>
              </div>
            ) : merged.map(it => {
              const isUnread = !lastRead || it.created > lastRead;
              const isPayment = it.type === 'payment';
              return (
                <div
                  key={it.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors ${isUnread ? 'bg-accent-soft' : 'bg-surface'} hover:bg-subtle`}
                >
                  <div className={`p-2 rounded-xl shrink-0 ${isPayment ? 'bg-[var(--success-soft)] text-emerald-500' : 'bg-accent-soft text-accent'}`}>
                    {isPayment ? <Wallet className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-bold text-ink truncate">{it.title}</p>
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-[#ff5b5c] shrink-0" />}
                    </div>
                    <p className="text-[12px] text-soft leading-snug mt-0.5 break-words">{it.message}</p>
                    <p className="text-[10px] font-semibold text-faint mt-1">{fmtWhen(it.created)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* Helper tạo thông báo — gọi từ nơi phát sinh sự kiện (vd đánh dấu thanh toán).
   `area`: '' = khối Kinh doanh; tên KCN = khối Vận hành của KCN đó.
   Sau khi tạo, với khu vực Vận hành (area != '') sẽ tự dọn bớt chỉ giữ MAX_PER_AREA
   bản ghi mới nhất (khối Kinh doanh area="" không giới hạn). Bọc try/catch để không
   làm hỏng luồng chính nếu collection chưa sẵn sàng. */
export async function createNotification(data: { title: string; message: string; type?: string; mkh?: string; area?: string }) {
  try {
    await pb.collection(COLLECTION).create({ ...data, area: data.area || '' });

    const area = data.area || '';
    if (area) {
      // Dọn bớt: chỉ giữ MAX_PER_AREA thông báo mới nhất của khu vực này
      const res = await pb.collection(COLLECTION).getList<NotificationRecord>(1, 100, {
        filter: pb.filter('area = {:area}', { area }),
        sort: '-created',
        requestKey: null,
      });
      const excess = res.items.slice(MAX_PER_AREA);
      await Promise.all(excess.map(it => pb.collection(COLLECTION).delete(it.id).catch(() => {})));
    }
  } catch (err) {
    console.warn('Không tạo được thông báo:', err);
  }
}
