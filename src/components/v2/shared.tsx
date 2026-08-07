/**
 * Mảnh dùng chung của module Hồ sơ Kho: nạp dữ liệu, nhãn, badge.
 *
 * Không có dữ liệu mẫu và KHÔNG có đăng nhập riêng (user chốt 07/08) — dùng
 * chung phiên đăng nhập của app, đọc thẳng PocketBase production. Lỗi thì hiện
 * lỗi thật, không có bản thay thế nào cả.
 */
import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { pbv2, isAuthed, isAbort } from '../../lib/v2/pb';
import { fetchWh, EMPTY_WH, type WhData } from '../../lib/v2/wh';
import type { V2AssetStatus, V2PointStatus } from '../../lib/v2/schema';

export function useWhData() {
  const [data, setData] = useState<WhData>(EMPTY_WH);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!isAuthed()) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      setData(await fetchWh());
    } catch (e) {
      if (isAbort(e)) return;
      setError((e as { message?: string }).message ?? 'Không đọc được dữ liệu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export function ErrorBar({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="vl-alert vl-alert-light-danger flex items-start gap-2 text-[13px]">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <p>{message}</p>
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'vl-badge-success', warn: 'vl-badge-warning', bad: 'vl-badge-danger',
  info: 'vl-badge-info', muted: 'bg-subtle text-soft',
};

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: Tone }) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink';
  return (
    <div className="vl-card px-4 py-3">
      <p className="text-[12px] text-faint">{label}</p>
      <p className={`text-[22px] font-semibold tnum ${color}`}>{value}</p>
    </div>
  );
}

/** Một dòng "nhãn — giá trị" trong thẻ chi tiết. */
export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-hair last:border-0">
      <span className="text-[12px] text-faint w-[150px] shrink-0">{label}</span>
      <span className="text-[13px] flex-1">{value ?? '—'}</span>
    </div>
  );
}

export const POINT_STATUS_LABEL: Record<V2PointStatus, string> = {
  du_kien: 'Dự kiến', chua_van_hanh: 'Chưa vận hành',
  active: 'Đang vận hành', dismounted: 'Đã tháo',
};

/** Nhãn tag thật trên `wh_device.status` — khác với trạng thái nội bộ của luật. */
export { DEVICE_TAG_LABEL } from '../../lib/v2/wh';

export const ASSET_STATUS_LABEL: Record<V2AssetStatus, string> = {
  kho: 'Trong kho', dang_treo: 'Đang treo', cho_kiem_dinh: 'Chờ kiểm định',
  dang_kiem_dinh: 'Đang kiểm định', dat: 'Kiểm định đạt',
  khong_dat: 'Không đạt', thanh_ly: 'Đã thanh lý',
};

/** `2028-06-30` → `30/06/2028`. */
export function viDate(v?: string): string {
  const d = (v || '').slice(0, 10);
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}

export const pbEmail = () => pbv2.authStore.record?.email ?? '';
