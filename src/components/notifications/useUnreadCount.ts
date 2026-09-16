import { useState, useEffect, useCallback } from 'react';
import { pb } from '../../lib/pocketbase';
import {
  fetchNotifications, getLastRead, unreadCount, onReadChange, myArea,
} from '../../lib/notifications';

/**
 * Số thông báo CHƯA ĐỌC của tài khoản hiện tại — cho badge trên sidebar.
 *
 * Cập nhật ở ba thời điểm:
 *   1. lúc mở app;
 *   2. khi PocketBase đẩy realtime một thông báo mới ĐÚNG khu vực;
 *   3. khi người dùng mở màn Thông báo (mốc đọc đổi → số về 0).
 *
 * Dùng chung cho cả hai dashboard, để hai nơi không đếm lệch nhau.
 */
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);

  const recount = useCallback(async () => {
    const items = await fetchNotifications();
    setCount(unreadCount(items, getLastRead()));
  }, []);

  useEffect(() => {
    recount();
    /* Mốc đọc đổi (người dùng vừa mở màn Thông báo) → tính lại ngay. */
    const off = onReadChange(() => { recount(); });

    /* Realtime: chỉ quan tâm bản ghi đúng khu vực, giống luật lọc khi tải. */
    let unsub: (() => void) | undefined;
    pb.collection('notifications')
      .subscribe('*', e => {
        if (((e.record.area as string) || '') !== myArea()) return;
        recount();
      })
      .then(fn => { unsub = fn; })
      .catch(() => { /* chưa có quyền realtime → vẫn đếm được lúc mở app */ });

    return () => { off(); if (unsub) unsub(); };
  }, [recount]);

  return count;
}
