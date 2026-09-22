/**
 * Gắn HÀNG LOẠT trạm vào một lộ đường dây.
 *
 * Vì sao có màn này chứ không chỉ dựa vào ô chọn lộ trong form Trạm: hiện có
 * 133 trạm chưa gắn lộ. Mở form từng trạm để chọn lộ là 133 lần mở — không ai
 * làm nổi, và làm dở dang thì dữ liệu nửa vời còn khó đọc hơn lúc chưa làm.
 *
 * Hai đường phục vụ hai lúc khác nhau: form Trạm dùng khi khai MỘT trạm mới;
 * màn này dùng khi khai xong một lộ và cần vơ hết trạm thuộc nó về.
 *
 * PHẠM VI GHI — cố ý hẹp: CHỈ đặt `dm_station.line`. Không sửa trường nào khác
 * của trạm, không đụng lộ, không xoá gì.
 */
import { useEffect, useMemo, useState } from 'react';
import { Factory, RefreshCw, Search, X } from 'lucide-react';
import type { CatalogData } from '../../lib/dm/repo';
import { pbErrorMessage, stations } from '../../lib/dm/repo';
import type { Line, Station } from '../../lib/dm/types';
import { toast } from '../../lib/toast';

export default function LineAssign({ line, d, onClose, onDone }: {
  /** `null` = đóng. */
  line: Line | null;
  d: CatalogData | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  /*
    Mở lại là chọn lại từ đầu, kèm sẵn các trạm ĐANG thuộc lộ này. Nhờ vậy màn
    này dùng được cả để BỎ gắn: bỏ tick một trạm đang thuộc lộ thì nó về "Chưa
    gắn lộ" — không cần thêm một màn riêng chỉ để gỡ.
  */
  useEffect(() => {
    if (!line) return;
    setPicked(new Set((d?.stations ?? []).filter(s => s.line === line.id).map(s => s.id)));
    setQ('');
  }, [line, d]);

  /*
    Chỉ hiện trạm CÙNG KCN với lộ: một lộ không vắt sang KCN khác (user xác nhận
    22/09/2026), nên trạm khu bên cạnh xuất hiện ở đây chỉ tạo cơ hội gắn nhầm.

    Trạm đang thuộc lộ KHÁC vẫn hiện, kèm nhãn lộ hiện tại — người dùng phải
    thấy được là mình đang kéo nó khỏi lộ cũ, chứ không phải gắn một trạm rảnh.
  */
  const rows = useMemo(() => {
    if (!line || !d) return [] as Station[];
    const key = q.trim().toLowerCase();
    return d.stations
      .filter(s => s.zone === line.zone)
      .filter(s => !key || s.code.toLowerCase().includes(key))
      .sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
  }, [line, d, q]);

  if (!line) return null;

  const lineCodeOf = (id?: string) => d?.lines.find(l => l.id === id)?.code;
  const pointsOf = (id: string) => d?.points.filter(p => p.station === id).length ?? 0;

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const before = new Set((d?.stations ?? []).filter(s => s.line === line.id).map(s => s.id));
  const toAdd = [...picked].filter(id => !before.has(id));
  const toRemove = [...before].filter(id => !picked.has(id));
  const dirty = toAdd.length + toRemove.length;

  const save = async () => {
    setSaving(true);
    try {
      /*
        Ghi TỪNG bản ghi — PocketBase không có cập nhật hàng loạt. Chạy tuần tự
        chứ không Promise.all: 133 request đồng thời thì server chặn, mà lỗi
        giữa chừng lại khó biết trạm nào đã ghi trạm nào chưa.
      */
      for (const id of toAdd) await stations.update(id, { line: line.id });
      for (const id of toRemove) await stations.update(id, { line: '' });
      toast.success('Đã gắn trạm',
        `Lộ ${line.code}: thêm ${toAdd.length}, bỏ ${toRemove.length}.`);
      onDone();
      onClose();
    } catch (e) {
      toast.error('Gắn trạm thất bại', pbErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-2xl">
        {/* ---- Đầu ---- */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-ink">Gắn trạm vào lộ {line.code}</h3>
            <p className="mt-0.5 text-[13px] text-soft">
              {line.name || 'Chọn các trạm thuộc lộ này'}
              {' · '}bỏ tick để gỡ trạm khỏi lộ
            </p>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Đóng"
            className="shrink-0 rounded-lg p-2 text-faint transition-colors hover:bg-subtle hover:text-ink disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---- Tìm ---- */}
        <div className="border-b border-[var(--border)] px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Tìm mã trạm…"
              className="w-full rounded-lg border border-[var(--border)] bg-surface py-2 pl-10 pr-3 text-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent placeholder:text-faint" />
          </div>
        </div>

        {/* ---- Danh sách ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] italic text-faint">
              {q ? `Không có trạm nào khớp “${q}”.` : 'KCN của lộ này chưa có trạm nào.'}
            </p>
          ) : rows.map(s => {
            const other = s.line && s.line !== line.id ? lineCodeOf(s.line) : '';
            return (
              <label key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-subtle">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)}
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
                <Factory className="h-4 w-4 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-bold text-dim">
                  {s.code}
                </span>
                {/* Nói rõ trạm đang thuộc lộ khác — kéo về đây là gỡ khỏi lộ đó. */}
                {other && (
                  <span className="shrink-0 rounded-md bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                    đang ở {other}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-faint">{s.sdm_kva ?? '—'} kVA</span>
                <span className="shrink-0 text-[11px] font-semibold text-soft">{pointsOf(s.id)} điểm đo</span>
              </label>
            );
          })}
        </div>

        {/* ---- Chân ---- */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-4">
          <p className="text-[12px] text-soft">
            {dirty === 0
              ? 'Chưa thay đổi gì'
              : `Sẽ thêm ${toAdd.length}, bỏ ${toRemove.length} trạm`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving} className="vl-btn vl-btn-secondary vl-btn-sm">
              Hủy
            </button>
            <button onClick={() => void save()} disabled={saving || dirty === 0}
              className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50">
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
