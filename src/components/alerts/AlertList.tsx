import { useState, Fragment } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Undo2, MapPin, ChevronDown } from 'lucide-react';
import type { AlertRecord, AlertDetail } from '../../lib/alerts';
import { setResolved, detailsOf, groupByZone, totalOf, isReactive, unitOf } from '../../lib/alerts';

/**
 * Danh sách cảnh báo của MỘT nhóm.
 *
 * Đổi tên từ `NotificationList` và khác nó ở hai chỗ:
 *   · mỗi dòng có nút "Đánh dấu đã xử lý" (và mở lại) — thay cho việc xoá, vốn
 *     bị khoá hẳn trên collection;
 *   · phân biệt bằng ĐÃ XỬ LÝ / CHƯA, không phải đã đọc / chưa đọc.
 *
 * Bản đã xử lý vẫn hiện, chỉ mờ đi: cần biết sự cố này từng xảy ra và ai đó đã
 * xử lý, chứ không phải nó biến mất.
 */

/**
 * Số có dấu chấm ngăn nghìn; `null` = không đo được, KHÁC 0.
 *
 * LUÔN giữ phần thập phân. Bản đầu bỏ phần lẻ với số ≥ 10 cho gọn, nhưng khi
 * cộng lại thì tổng 19,03 hiện thành "19" trong khi các dòng cộng bên trên vẫn
 * có số lẻ — nhìn như cộng sai. Số nhỏ cần 3 chữ số (lùi 0,2 kWh mà làm tròn
 * thành 0 thì cả cột thành dãy số 0 vô nghĩa), số lớn thì 2 là đủ.
 */
const fmtValue = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const digits = Math.abs(v) < 10 ? 3 : 2;
  return v.toLocaleString('vi-VN', { maximumFractionDigits: digits });
};

/** Chỉ số thô — giữ nguyên phần thập phân, đây là con số trên mặt công tơ. */
const fmtIdx = (v: number | undefined) =>
  v === undefined ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 3 });

/**
 * Bảng chi tiết CÁC CA LÙI CHỈ SỐ, gom nhóm theo KCN, có tổng từng khu và tổng
 * chung ở cuối.
 *
 * Một dòng = MỘT CA (một biểu, một khoảng thời gian), không phải một công tơ:
 * cùng một công tơ lùi ở nhiều biểu và nhiều giờ khác nhau là chuyện thường, gộp
 * lại thì mất hết "lùi từ bao nhiêu về bao nhiêu, lúc mấy giờ" — đúng những thứ
 * người đi tra cần.
 */
/** "2026-09-15" → "15/09". Năm bỏ đi: cảnh báo luôn trong vài tuần gần đây. */
const fmtDay = (d: string | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
  return m ? `${m[3]}/${m[2]}` : (d || '—');
};

function RegressTable({ rows, fallbackDay }: { rows: AlertDetail[]; fallbackDay: string }) {
  const groups = groupByZone(rows);
  const total = totalOf(rows);
  const nReactive = total.excluded;
  /* Số cột trước cột tổng — để dòng tổng nhập ô cho đúng. */
  const LEAD = 7;

  return (
    /* Bảng là thứ DUY NHẤT được phép rộng hơn khung — cuộn ngang trong hộp
       riêng để thân trang không bao giờ cuộn ngang trên máy hẹp. */
    <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="bg-subtle text-faint">
            <th className="px-2.5 py-1.5 text-left font-bold w-10">STT</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Số công tơ</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Khách hàng</th>
            {/* Cột KCN bỏ đi (user chốt 16/09/2026): bảng đã gom nhóm theo KCN
                và thẻ cảnh báo cũng ghi KCN, nhắc lại ở từng dòng là thừa. Chỗ
                đó dành cho NGÀY — cột giờ chỉ có HH:mm nên không có ngày thì
                không biết ca nằm ở đâu, nhất là ca ở chỗ nối qua nửa đêm. */}
            <th className="px-2.5 py-1.5 text-left font-bold whitespace-nowrap">Ngày</th>
            <th className="px-2.5 py-1.5 text-left font-bold whitespace-nowrap">Giờ bất thường</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Biểu bất thường</th>
            <th className="px-2.5 py-1.5 text-right font-bold whitespace-nowrap">Mức bất thường</th>
            <th className="px-2.5 py-1.5 text-right font-bold whitespace-nowrap">Lượng bất thường</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.zone || '(chưa rõ)'}>
              {/* Tiêu đề khu — chỉ hiện khi cảnh báo trải NHIỀU khu; một khu
                  duy nhất thì cột KCN đã nói rồi, thêm dòng này là thừa. */}
              {groups.length > 1 && (
                <tr className="bg-accent-soft">
                  <td colSpan={LEAD + 1} className="px-2.5 py-1.5 font-black text-accent">
                    {g.zone || 'Chưa rõ KCN'} — {g.rows.length} ca
                  </td>
                </tr>
              )}
              {g.rows.map((r, i) => (
                <tr key={`${r.meter}-${r.register}-${r.fromTime}-${i}`} className="border-t border-[var(--border)]">
                  <td className="px-2.5 py-1.5 text-faint">{i + 1}</td>
                  <td className="px-2.5 py-1.5 font-mono font-bold text-ink whitespace-nowrap">{r.meter}</td>
                  {/* Khách hàng trên, trạm dưới — cùng quy ước với các bảng chỉ số. */}
                  <td className="px-2.5 py-1.5">
                    <div className="font-medium text-ink">
                      {r.customer || <span className="text-faint italic">chưa khai</span>}
                    </div>
                    {r.station && <div className="text-[11px] text-faint">{r.station}</div>}
                    {/* Ghi chú (vd đỉnh phát ngược) hiện THÊM dưới trạm, không thay trạm. */}
                    {r.note && <div className="text-[11px] text-soft">{r.note}</div>}
                  </td>
                  {/* Bản ghi cũ chưa có `day` từng dòng — lùi về ngày của cảnh báo. */}
                  <td className="px-2.5 py-1.5 font-mono text-soft whitespace-nowrap">
                    {fmtDay(r.day || fallbackDay)}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-soft whitespace-nowrap">
                    {r.fromTime && r.toTime ? `${r.fromTime} → ${r.toTime}` : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-soft">{r.register || '—'}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono text-soft whitespace-nowrap">
                    {fmtIdx(r.fromIndex)} → {fmtIdx(r.toIndex)}
                  </td>
                  {/* Vô công để mờ + ghi rõ kVArh: nó KHÔNG vào tổng, phải nhìn
                      ra ngay chứ không để người đọc tự cộng nhẩm rồi thấy lệch. */}
                  <td className={`px-2.5 py-1.5 text-right font-mono font-bold whitespace-nowrap
                    ${isReactive(r) && nReactive > 0 ? 'text-faint' : 'text-ink'}`}>
                    {fmtValue(r.value)} <span className="font-sans font-normal text-[10px]">{unitOf(r)}</span>
                  </td>
                </tr>
              ))}
              {groups.length > 1 && (
                <tr className="border-t border-[var(--border)] bg-subtle">
                  <td colSpan={LEAD} className="px-2.5 py-1.5 text-right font-bold text-soft">
                    Cộng {g.zone || 'chưa rõ KCN'}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono font-black text-ink whitespace-nowrap">
                    {fmtValue(totalOf(g.rows).value)} <span className="font-sans font-normal text-[10px]">{totalOf(g.rows).unit}</span>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          <tr className="border-t-2 border-[var(--accent)] bg-accent-soft">
            <td colSpan={LEAD} className="px-2.5 py-2 text-right font-black text-accent">
              TỔNG ({rows.length} ca)
              {/* Nói thẳng vì sao tổng không bằng tổng mắt thường của cột. */}
              {nReactive > 0 && (
                <span className="ml-1.5 font-sans font-normal text-[11px] text-soft">
                  — không gồm {nReactive} ca vô công (kVArh)
                </span>
              )}
            </td>
            <td className="px-2.5 py-2 text-right font-mono font-black text-accent whitespace-nowrap">
              {fmtValue(total.value)} <span className="font-sans font-normal text-[10px]">{total.unit}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Bảng chi tiết cho các nhóm KHÁC (đối chiếu công tơ, dữ liệu trạm).
 *
 * Những nhóm này không có chỉ số hay khoảng thời gian để hiện — chỉ cần biết
 * công tơ nào, của ai, ở đâu.
 */
function DetailTable({ rows }: { rows: AlertDetail[] }) {
  const groups = groupByZone(rows);
  return (
    /* Cuộn ngang trong hộp riêng để thân trang không cuộn ngang trên máy hẹp. */
    <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="bg-subtle text-faint">
            <th className="px-2.5 py-1.5 text-left font-bold w-10">STT</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Số công tơ</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Khách hàng</th>
            <th className="px-2.5 py-1.5 text-left font-bold">KCN</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <Fragment key={g.zone || '(chưa rõ)'}>
              {groups.length > 1 && (
                <tr className="bg-accent-soft">
                  <td colSpan={4} className="px-2.5 py-1.5 font-black text-accent">
                    {g.zone || 'Chưa rõ KCN'} — {g.rows.length} công tơ
                  </td>
                </tr>
              )}
              {g.rows.map((r, i) => (
                <tr key={`${r.meter}-${i}`} className="border-t border-[var(--border)]">
                  <td className="px-2.5 py-1.5 text-faint">{i + 1}</td>
                  <td className="px-2.5 py-1.5 font-mono font-bold text-ink whitespace-nowrap">{r.meter}</td>
                  {/* Khách hàng trên, trạm dưới — cùng quy ước với các bảng chỉ số. */}
                  <td className="px-2.5 py-1.5">
                    <div className="font-medium text-ink">
                      {r.customer || <span className="text-faint italic">chưa khai</span>}
                    </div>
                    {r.station && <div className="text-[11px] text-faint">{r.station}</div>}
                    {r.note && <div className="text-[11px] text-soft">{r.note}</div>}
                  </td>
                  <td className="px-2.5 py-1.5 text-soft whitespace-nowrap">{r.zone || '—'}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "2026-09-16 08:00:00Z" → "16/09/2026 08:00". */
const fmtWhen = (raw: string) => {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function AlertList({ items, loading, empty, onChanged }: {
  items: AlertRecord[];
  loading: boolean;
  empty: string;
  /** Gọi sau khi đổi trạng thái để nơi cha đếm lại. */
  onChanged: () => void;
}) {
  /* Id đang gửi lệnh — chặn bấm hai lần, và cho thấy có gì đó đang chạy. */
  const [busy, setBusy] = useState<string>('');
  /* Cảnh báo nào đang mở bảng. Mặc định ĐÓNG: một ngày có thể vài cảnh báo,
     mỗi cái vài chục dòng — mở sẵn hết thì phải cuộn mãi mới thấy cái thứ hai. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const toggle = async (r: AlertRecord) => {
    setBusy(r.id);
    try {
      if (await setResolved(r.id, !r.resolved)) onChanged();
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="vl-card px-6 py-12 text-center text-faint">
        <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="vl-card px-6 py-12 text-center">
        <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-2" />
        <p className="text-sm italic text-faint">{empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map(it => {
        const rows = detailsOf(it);
        const meterCount = new Set(rows.map(r => r.meter)).size;
        const isOpen = open.has(it.id);
        /*
          Cắt đuôi danh sách sê-ri khỏi câu mô tả: script ghép nó vào `message`
          để bản ghi tự đứng một mình đọc được, nhưng trên màn hình thì bảng bên
          dưới đã liệt kê đầy đủ — để cả hai là một đoạn dài lặp lại vô ích.
        */
        const summary = rows.length ? it.message.split(' — ')[0] : it.message;
        return (
          <div
            key={it.id}
            className={`vl-card flex items-start gap-3 px-4 py-3 transition-colors
              ${it.resolved ? 'opacity-60' : 'border-l-2 border-l-[var(--warning)]'}`}
          >
            <div className={`shrink-0 rounded-lg p-2 ${
              it.resolved ? 'bg-[var(--success-soft)]' : 'bg-[var(--warning-soft)]'}`}>
              {it.resolved
                ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />
                : <AlertTriangle className="w-4 h-4 text-[var(--warning)]" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-ink">{it.title}</span>
                {it.resolved && (
                  <span className="rounded-full bg-[var(--success)] px-1.5 py-0.5 text-[9px] font-black text-white">
                    ĐÃ XỬ LÝ
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-soft break-words">{summary}</p>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-faint">
                <span className="font-mono">{fmtWhen(it.created)}</span>
                {/* Rỗng = trải nhiều KCN. Nói thẳng, đừng để người đọc đoán. */}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {it.zone || 'nhiều KCN'}
                </span>
                {rows.length > 0 && (
                  <button
                    onClick={() => toggleOpen(it.id)}
                    className="flex items-center gap-1 font-bold text-accent hover:underline"
                  >
                    {/*
                      Nhóm `lui`: một dòng = một CA lùi, nhiều ca có thể cùng một
                      công tơ — nên phải nói cả hai con số. Ghi "81 công tơ" trong
                      khi chỉ có 49 công tơ dính là báo sai quy mô sự việc.
                    */}
                    {it.kind === 'lui' || it.kind === 'lamtron'
                      ? `${rows.length} ca · ${meterCount} công tơ`
                      : `${rows.length} công tơ`}
                    <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {isOpen && rows.length > 0 && (
                /* `lui` và `lamtron` cùng là ca lùi chỉ số nên dùng chung bảng —
                   khác nhau ở mức độ nghiêm trọng, không ở dữ liệu. `phatnguoc`
                   cũng mang khung giờ + chỉ số đầu/cuối + kWh nên dùng bảng này. */
                it.kind === 'lui' || it.kind === 'lamtron' || it.kind === 'phatnguoc' || it.kind === 'dubu'
                  ? <RegressTable rows={rows} fallbackDay={it.day} />
                  : <DetailTable rows={rows} />
              )}
            </div>

            <button
              onClick={() => toggle(it)}
              disabled={busy === it.id}
              className="vl-btn vl-btn-secondary vl-btn-sm shrink-0 gap-1.5 disabled:opacity-50"
            >
              {busy === it.id
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : it.resolved
                  ? <Undo2 className="w-3.5 h-3.5" />
                  : <CheckCircle2 className="w-3.5 h-3.5" />}
              {it.resolved ? 'Mở lại' : 'Đã xử lý'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
