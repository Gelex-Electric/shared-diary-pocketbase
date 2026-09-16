import { useState, useEffect, useCallback } from 'react';
import { pb } from '../../lib/pocketbase';
import { fetchAlerts, unresolvedCount, countByKind } from '../../lib/alerts';

/**
 * Số cảnh báo CHƯA XỬ LÝ — cho badge trên sidebar và từng sub-side.
 *
 * Thay cho `useUnreadCount`: mốc đọc localStorage chỉ nói "tôi đã liếc qua", mà
 * liếc qua không làm chỉ số hết chạy lùi. Số ở đây chỉ giảm khi có người thật sự
 * bấm "Đã xử lý", và giống nhau trên mọi máy vì trạng thái nằm ở server.
 *
 * `reload` để nơi gọi tính lại sau khi vừa đánh dấu xong — realtime cũng bắt
 * được, nhưng chờ vòng mạng thì badge trễ một nhịp ngay trước mắt người dùng.
 */
export function useUnresolvedAlerts(): {
  total: number;
  byKind: Record<string, number>;
  reload: () => void;
} {
  const [total, setTotal] = useState(0);
  const [byKind, setByKind] = useState<Record<string, number>>({});

  const recount = useCallback(async () => {
    const items = await fetchAlerts();
    setTotal(unresolvedCount(items));
    setByKind(countByKind(items));
  }, []);

  useEffect(() => {
    recount();

    /* Realtime: không lọc khu vực — cảnh báo kỹ thuật ai đăng nhập cũng thấy. */
    let unsub: (() => void) | undefined;
    pb.collection('alerts')
      .subscribe('*', () => { recount(); })
      .then(fn => { unsub = fn; })
      .catch(() => { /* chưa có quyền realtime → vẫn đếm được lúc mở app */ });

    return () => { if (unsub) unsub(); };
  }, [recount]);

  return { total, byKind, reload: recount };
}
