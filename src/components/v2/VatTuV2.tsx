/**
 * Trang "Kết nối & thiết lập" của Hồ sơ Kho.
 *
 * Chỉ làm một việc: cho thấy đang nối tới đâu, bằng tài khoản nào, và mỗi
 * collection `wh_*` hiện có bao nhiêu bản ghi. Khi màn hình khác trống trơn thì
 * đây là chỗ trả lời "mất dữ liệu hay chưa đăng nhập hay chưa nhập liệu".
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { pbv2, V2_PB_URL, isAbort } from '../../lib/v2/pb';
import { WH } from '../../lib/v2/wh';
import { pbEmail } from './shared';

interface Probe { name: string; exists: boolean; count: number; error?: string }

export default function VatTuV2() {
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<Probe[]>([]);

  const probe = useCallback(async () => {
    setBusy(true);
    try {
      const out: Probe[] = [];
      for (const name of Object.values(WH)) {
        try {
          const r = await pbv2.collection(name).getList(1, 1, { requestKey: null });
          out.push({ name, exists: true, count: r.totalItems });
        } catch (e) {
          if (isAbort(e)) continue;
          const err = e as { status?: number; message?: string };
          out.push({
            name, exists: false, count: 0,
            error: err.status === 404 ? 'chưa tạo' : (err.message ?? 'lỗi không rõ'),
          });
        }
      }
      setProbes(out);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { probe(); }, [probe]);

  return (
    <div className="space-y-4">
      <div className="vl-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-[16px] font-semibold">Kết nối &amp; thiết lập</h2>
          <p className="text-[13px] text-faint">{V2_PB_URL} · {pbEmail()}</p>
        </div>
        <button onClick={probe} disabled={busy}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Kiểm tra lại
        </button>
      </div>

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
              <tr key={p.name} className="border-t border-hair">
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
                <td className="py-2 text-right tnum">{p.exists ? p.count : '—'}</td>
              </tr>
            ))}
            {!probes.length && (
              <tr><td colSpan={3} className="py-6 text-center text-faint">Đang kiểm tra...</td></tr>
            )}
          </tbody>
        </table>
        <p className="text-[12px] text-faint mt-3">
          Số bản ghi = 0 nghĩa là collection đã tạo nhưng chưa nhập dữ liệu, hoặc tài khoản
          đang đăng nhập không có quyền đọc.
        </p>
      </div>
    </div>
  );
}
