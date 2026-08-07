/**
 * Trang gốc của module vật tư làm lại (v2).
 *
 * Tách hẳn khỏi màn hình cũ (`components/catalog/`): dùng client PocketBase
 * riêng trỏ thẳng production, phiên đăng nhập riêng, collection riêng `v2_*`.
 * Màn hình này KHÔNG đọc/ghi bất kỳ collection `dm_*` / `vt_*` nào.
 *
 * Đợt này mới là phần khung: đăng nhập + soi xem 4 collection đã tạo chưa.
 * Màn hình điểm đo/vật tư dựng ở task sau, trên đúng nền này.
 */
import { useState, useEffect, useCallback } from 'react';
import { Lock, RefreshCw, LogOut, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { pbv2, V2_PB_URL, isAuthed, loginV2, logoutV2, isAbort } from '../../lib/v2/pb';
import { V2_COLLECTIONS } from '../../lib/v2/schema';

interface Probe {
  name: string;
  exists: boolean;
  count: number;
  error?: string;
}

export default function VatTuV2() {
  const [authed, setAuthed] = useState(isAuthed());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [probes, setProbes] = useState<Probe[]>([]);

  /** Thử đọc 1 bản ghi mỗi collection để biết nó đã tồn tại hay chưa. */
  const probe = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const out: Probe[] = [];
      for (const name of Object.values(V2_COLLECTIONS)) {
        try {
          const r = await pbv2.collection(name).getList(1, 1, { requestKey: null });
          out.push({ name, exists: true, count: r.totalItems });
        } catch (e) {
          if (isAbort(e)) continue;
          const msg = (e as { status?: number; message?: string });
          out.push({
            name, exists: false, count: 0,
            error: msg.status === 404 ? 'chưa tạo' : (msg.message ?? 'lỗi không rõ'),
          });
        }
      }
      setProbes(out);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { if (authed) probe(); }, [authed, probe]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await loginV2(email.trim(), password);
      setAuthed(true);
      setPassword('');
    } catch (e) {
      setErr((e as { message?: string }).message ?? 'Đăng nhập không thành công');
    } finally {
      setBusy(false);
    }
  };

  const doLogout = () => {
    logoutV2();
    setAuthed(false);
    setProbes([]);
  };

  if (!authed) {
    return (
      <div className="vl-card max-w-md mx-auto p-6">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-[18px] h-[18px] text-dim" />
          <h2 className="text-[16px] font-semibold">Đăng nhập PocketBase production</h2>
        </div>
        <p className="text-[13px] text-faint mb-4">
          Module này chạy trên dữ liệu thật nên có phiên đăng nhập riêng, không dùng chung
          với phần còn lại của app. Máy chủ: {V2_PB_URL}
        </p>
        <form onSubmit={doLogin} className="space-y-3">
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" autoComplete="username" required
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[14px]"
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Mật khẩu" autoComplete="current-password" required
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[14px]"
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

  const missing = probes.filter(p => !p.exists);

  return (
    <div className="space-y-4">
      <div className="vl-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-[16px] font-semibold">Vật tư (bản làm lại)</h2>
          <p className="text-[13px] text-faint">
            {V2_PB_URL} · {pbv2.authStore.record?.email ?? ''} · chỉ đọc/ghi collection <code>v2_*</code>
          </p>
        </div>
        <button onClick={probe} disabled={busy}
          className="px-3 py-2 rounded-lg border border-[var(--border)] text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Kiểm tra lại
        </button>
        <button onClick={doLogout}
          className="px-3 py-2 rounded-lg border border-[var(--border)] text-[13px] flex items-center gap-1.5 text-bad">
          <LogOut className="w-4 h-4" /> Thoát
        </button>
      </div>

      {missing.length > 0 && (
        <div className="vl-card p-4 flex items-start gap-2">
          <ShieldAlert className="w-[18px] h-[18px] text-bad shrink-0 mt-0.5" />
          <p className="text-[13px]">
            Còn {missing.length} collection chưa tạo trên production. Chạy
            {' '}<code>scripts/v2_create_collections.py</code>{' '}
            bằng tài khoản superuser rồi bấm kiểm tra lại. Script chỉ TẠO MỚI collection
            <code> v2_*</code>, không đụng tới dữ liệu cũ.
          </p>
        </div>
      )}

      <div className="vl-card p-4">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-faint text-left">
              <th className="pb-2 font-medium">Collection</th>
              <th className="pb-2 font-medium">Trạng thái</th>
              <th className="pb-2 font-medium text-right">Số bản ghi</th>
            </tr>
          </thead>
          <tbody>
            {probes.map(p => (
              <tr key={p.name} className="border-t border-[var(--border)]">
                <td className="py-2"><code>{p.name}</code></td>
                <td className="py-2">
                  {p.exists ? (
                    <span className="inline-flex items-center gap-1.5 text-ok">
                      <CheckCircle2 className="w-4 h-4" /> đã có
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-bad">
                      <XCircle className="w-4 h-4" /> {p.error}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{p.exists ? p.count : '—'}</td>
              </tr>
            ))}
            {!probes.length && (
              <tr><td colSpan={3} className="py-6 text-center text-faint">Đang kiểm tra...</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
