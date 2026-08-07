/**
 * Mảnh dùng chung của module Hồ sơ Kho: đăng nhập, nạp dữ liệu, nhãn, badge.
 *
 * Không còn dữ liệu mẫu (user chốt 07/08) — màn hình nối THẲNG PocketBase
 * production. Chưa đăng nhập thì hiện form đăng nhập, lỗi thì hiện lỗi thật,
 * không có bản thay thế nào cả.
 */
import { useState, useEffect, useCallback } from 'react';
import { Lock, AlertTriangle } from 'lucide-react';
import { pbv2, V2_PB_URL, isAuthed, loginV2, isAbort } from '../../lib/v2/pb';
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

/** Bọc màn hình: chưa đăng nhập PocketBase production thì hỏi trước. */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(isAuthed());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (authed) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await loginV2(email.trim(), password);
      setAuthed(true);
    } catch (e) {
      setErr((e as { message?: string }).message ?? 'Đăng nhập không thành công');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vl-card max-w-md mx-auto p-6">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-[18px] h-[18px] text-dim" />
        <h2 className="text-[16px] font-semibold">Đăng nhập dữ liệu kho</h2>
      </div>
      <p className="text-[13px] text-faint mb-4">
        Phần này đọc thẳng dữ liệu thật trên {V2_PB_URL} nên có phiên đăng nhập riêng.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Email" autoComplete="username" required
          className="w-full px-3 py-2 rounded-lg border border-hair bg-inset text-[14px]"
        />
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Mật khẩu" autoComplete="current-password" required
          className="w-full px-3 py-2 rounded-lg border border-hair bg-inset text-[14px]"
        />
        {err && <p className="text-[13px] text-bad">{err}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full py-2 rounded-lg bg-accent text-[var(--on-accent)] text-[14px] font-semibold disabled:opacity-60"
        >
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
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
