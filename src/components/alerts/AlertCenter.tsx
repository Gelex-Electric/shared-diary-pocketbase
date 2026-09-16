import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldAlert, RefreshCw, MapPin } from 'lucide-react';
import { Select } from '../ui/Select';
import { AlertList } from './AlertList';
import {
  fetchAlerts, countByKind, filterAlerts, zonesOf, labelOfKind,
  ALERT_KINDS, type AlertRecord,
} from '../../lib/alerts';

/* ================================================================
   Màn "Cảnh báo" — sự cố kỹ thuật, giữ vĩnh viễn.

   KHÔNG có thanh tab ngang: các nhóm đã nằm thành sub-side trên sidebar
   (user chốt 16/09/2026), nên `kind` vào đây qua prop. Hai bộ chọn nhóm
   song song thì chỉ tổ lệch nhau.

   KHÔNG có mục "Thanh toán": thanh toán là việc hằng ngày, không phải cảnh
   báo — nó ở chuông trên thanh trên, đọc từ collection `notifications`.

   KHÔNG lọc theo khu vực tài khoản: cảnh báo kỹ thuật ai đăng nhập cũng xem
   được, `zone` chỉ để lọc bằng tay ở đây.
================================================================ */

export default function AlertCenter({ kind }: { kind: string }) {
  const [items, setItems] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [zone, setZone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchAlerts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => countByKind(items), [items]);
  const zones = useMemo(() => zonesOf(items), [items]);
  const shown = useMemo(() => filterAlerts(items, kind, zone), [items, kind, zone]);

  const meta = ALERT_KINDS.find(k => k.kind === kind);
  const open = counts[kind] ?? 0;

  const zoneOptions = [
    { value: '', label: 'Tất cả KCN' },
    ...zones.map(z => ({ value: z, label: z })),
  ];

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-[var(--border)] shadow-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <ShieldAlert className="w-4 h-4 text-accent shrink-0" />
            <span className="truncate">{labelOfKind(kind)}</span>
            {open > 0 && (
              <span className="shrink-0 rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[11px] font-black text-[var(--warning)]">
                {open} chưa xử lý
              </span>
            )}
          </div>
          {meta && <p className="mt-0.5 text-[12px] text-soft">{meta.desc}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Chỉ hiện bộ lọc khi thật sự có nhiều KCN để chọn. */}
          {zones.length > 1 && (
            <Select
              value={zone}
              onChange={setZone}
              options={zoneOptions}
              icon={MapPin}
              className="min-w-[10rem]"
            />
          )}
          <button onClick={load} disabled={loading} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
        </div>
      </div>

      <AlertList
        items={shown}
        loading={loading}
        empty={zone
          ? `Chưa có cảnh báo nào ở mục "${labelOfKind(kind)}" tại ${zone}`
          : `Chưa có cảnh báo nào ở mục "${labelOfKind(kind)}"`}
        onChanged={load}
      />
    </div>
  );
}
