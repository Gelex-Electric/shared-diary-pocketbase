/**
 * Mảnh dùng chung của module v2: nạp dữ liệu, băng cảnh báo dữ liệu mẫu, nhãn.
 * Để riêng vì cả màn hình điểm đo lẫn màn hình vật tư đều cần y hệt.
 */
import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, RefreshCw } from 'lucide-react';
import { fetchV2, DEMO_DATA, type V2Data } from '../../lib/v2/data';
import { isAbort } from '../../lib/v2/pb';
import type { V2AssetStatus, V2PointStatus } from '../../lib/v2/schema';

export function useV2Data() {
  const [data, setData] = useState<V2Data>(DEMO_DATA);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchV2());
    } catch (e) {
      if (!isAbort(e)) setData({ ...DEMO_DATA, reason: String((e as Error).message ?? e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload };
}

/** Băng cảnh báo — người dùng KHÔNG được nhầm dữ liệu mẫu là dữ liệu thật. */
export function DemoBanner({ data, onReload }: { data: V2Data; onReload: () => void }) {
  if (data.source !== 'demo') return null;
  return (
    <div className="vl-alert vl-alert-light-warning flex flex-wrap items-center gap-2 text-[13px]">
      <FlaskConical className="w-4 h-4 shrink-0" />
      <p className="flex-1 min-w-[220px]">
        <strong className="font-semibold">Đang xem dữ liệu mẫu</strong> — {data.reason ?? 'chưa nối PocketBase'}.
        Số liệu dưới đây là bịa, chỉ để xem giao diện và kiểm tra luật.
      </p>
      <button onClick={onReload} className="px-2.5 py-1 rounded-md border border-hair text-[12px] flex items-center gap-1.5">
        <RefreshCw className="w-3.5 h-3.5" /> Thử nối lại
      </button>
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

export const POINT_STATUS_LABEL: Record<V2PointStatus, string> = {
  du_kien: 'Dự kiến', chua_van_hanh: 'Chưa vận hành',
  active: 'Đang vận hành', dismounted: 'Đã tháo',
};

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
