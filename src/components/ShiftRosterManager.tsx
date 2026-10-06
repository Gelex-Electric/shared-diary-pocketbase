/**
 * Tab "Tạo ca trực tháng" — lập lịch trực cả tháng cho một khu vực (collection `shift_roster`,
 * 1 bản ghi = 1 ca). Quy trình: chọn khu vực + tháng → "Phân ca tự động" (trực đội theo vòng
 * xoay `dutyRotation`, điều độ nối tiếp chu kỳ `powerRotation`) → hiệu chỉnh từng ô → "Lưu".
 * Lưu xong đồng bộ 4 tên sang các ca đã nhập trong `handovers` (user chốt 06/10/2026) để phiếu
 * in khớp lịch. Tab "Tạo lịch trực" đọc lịch này để tự điền + khoá ô nhân sự.
 * Plan: `plans/2026-10-06-lich-truc-thang.md`.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarRange, Wand2, Save, FileDown, RefreshCw, AlertTriangle } from 'lucide-react';
import { pb, AREAS } from '../lib/pocketbase';
import { useUserAreas } from '../lib/scope';
import { toast as notify } from '../lib/toast';
import { pdfMake, loadFontsToVfs } from '../lib/pdfFonts';
import type { ElectricShift, Handover, PowerStaff, RosterSlot, ShiftRoster } from '../types';
import {
  SHIFTS, ROLES, DUTY_ROLES, ROLE_LABEL, addDays, daysOfMonth, emptySlot, normName,
  buildMonthDuty, validateRoster, MIN_DUTY_STAFF, crewsOf, crewLetter, type Role,
} from '../lib/dutyRotation';
import { buildMonthPower } from '../lib/powerRotation';
import { Select } from './ui/Select';
import { MonthPicker } from './ui/DateTimePickers';
import { useConfirm } from './ui/ConfirmDialog';

const slotKey = (date: string, shift: string) => `${date}|${shift}`;
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const weekday = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const sameNames = (a: RosterSlot, b: RosterSlot) => ROLES.every(r => normName(a[r]) === normName(b[r]));
const shiftBadgeClass = (shift: string) =>
  shift === 'Ca 1' ? 'vl-badge-primary' : shift === 'Ca 2' ? 'vl-badge-warning' : 'vl-badge-info';

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ShiftRosterManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const userAreas = useUserAreas();
  const areas = userAreas.length > 0 ? userAreas : AREAS;
  const [area, setArea] = useState<string>(areas[0]);
  const [month, setMonth] = useState(currentMonth());
  const [dutyStaff, setDutyStaff] = useState<ElectricShift[]>([]);
  const [powerStaff, setPowerStaff] = useState<PowerStaff[]>([]);
  const [slots, setSlots] = useState<RosterSlot[]>([]);
  const [saved, setSaved] = useState<Map<string, ShiftRoster>>(new Map());
  const [history, setHistory] = useState<RosterSlot[]>([]); // 60 ngày trước tháng — chu kỳ điều độ + giáp tháng
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => { if (!areas.includes(area)) setArea(areas[0]); }, [areas, area]);

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setIsLoading(true);
    try {
      const days = daysOfMonth(month);
      const [duty, power, rows, before] = await Promise.all([
        pb.collection('Electric_shift').getFullList<ElectricShift>({ filter: pb.filter('area = {:a}', { a: area }), sort: 'IDnum', requestKey: null }),
        pb.collection('power_staff').getFullList<PowerStaff>({ filter: pb.filter('area = {:a}', { a: area }), sort: 'IDnum', requestKey: null }),
        pb.collection('shift_roster').getFullList<ShiftRoster>({
          filter: pb.filter('area = {:a} && date >= {:from} && date <= {:to}', { a: area, from: days[0], to: days[days.length - 1] }), requestKey: null,
        }),
        // ~90 ngày gần nhất CÓ lịch trước tháng (lịch có thể đứt quãng) — dò chu kỳ điều độ + nối kíp + giáp tháng
        pb.collection('shift_roster').getList<ShiftRoster>(1, 270, {
          filter: pb.filter('area = {:a} && date < {:from}', { a: area, from: days[0] }), sort: '-date', requestKey: null,
        }),
      ]);
      setDutyStaff(duty);
      setPowerStaff(power);
      const inMonth = new Map(rows.map(r => [slotKey(r.date, r.shift), r]));
      setSaved(inMonth);
      setHistory(before.items.reverse());
      setSlots(days.flatMap(d => SHIFTS.map(s => {
        const r = inMonth.get(slotKey(d, s));
        return r ? { date: d, shift: s, main_duty: r.main_duty, sub_duty: r.sub_duty, main_power: r.main_power, sub_power: r.sub_power } : emptySlot(d, s);
      })));
    } catch (err: any) {
      console.error('Load roster error:', err);
      notify.error('Lỗi tải lịch trực tháng', err?.data?.message || err?.message || '');
    } finally {
      setIsLoading(false);
    }
  }, [area, month]);

  useEffect(() => { load(); }, [load]);

  const issues = useMemo(() => validateRoster(slots, history), [slots, history]);
  const cellIssues = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) if (i.kind !== 'empty') {
      const k = `${i.date}|${i.shift}|${i.role}`;
      m.set(k, [...(m.get(k) ?? []), i.message]);
    }
    return m;
  }, [issues]);
  const conflictCount = cellIssues.size;
  const emptyCount = issues.filter(i => i.kind === 'empty').length;
  const changed = useMemo(() => slots.filter(s => {
    const r = saved.get(slotKey(s.date, s.shift));
    return r ? !sameNames(s, r) : ROLES.some(role => normName(s[role]));
  }), [slots, saved]);

  // Kíp của mỗi ca nhận qua trực chính (STT lẻ = trực chính kíp A, B, …)
  const crewOfMain = useMemo(() => new Map(crewsOf(dutyStaff).mains.map((s, j) => [normName(s.Name), crewLetter(j)])), [dutyStaff]);

  const setCell = (date: string, shift: string, role: Role, value: string) =>
    setSlots(prev => prev.map(s => (s.date === date && s.shift === shift ? { ...s, [role]: value } : s)));

  const options = (role: Role, current: string) => {
    const list = (DUTY_ROLES as readonly string[]).includes(role) ? dutyStaff : powerStaff;
    const opts = [{ value: '', label: '—' }, ...list.map(s => ({ value: s.Name, label: s.Name }))];
    // Tên cũ không còn trong danh sách vẫn phải hiện, không thì ô trông như trống
    if (current && !list.some(s => s.Name === current)) opts.push({ value: current, label: `${current} (ngoài danh sách)` });
    return opts;
  };

  const handleAutoAssign = async () => {
    const duty = buildMonthDuty(dutyStaff, month);
    if (!duty) {
      notify.warning('Lưu ý', `Cần ít nhất ${MIN_DUTY_STAFF} nhân sự trực đội để phân ca (khu vực này có ${dutyStaff.length}).`);
      return;
    }
    if (slots.some(s => ROLES.some(r => normName(s[r])))) {
      const ok = await confirm({
        title: 'Phân ca lại cả tháng?',
        message: `Tháng ${month.slice(5)}/${month.slice(0, 4)} đã có lịch. Phân ca tự động sẽ thay toàn bộ người trực trong bảng (chưa lưu cho tới khi bấm "Lưu lịch tháng").`,
        confirmLabel: 'Phân ca lại',
      });
      if (!ok) return;
    }
    const power = buildMonthPower(history, month);
    setSlots(duty.slots.map((d, i) => power.period
      ? { ...d, main_power: power.slots[i].main_power, sub_power: power.slots[i].sub_power }
      : { ...d, main_power: slots[i]?.main_power ?? '', sub_power: slots[i]?.sub_power ?? '' }));
    const { K } = crewsOf(dutyStaff);
    notify.success('Đã phân ca', `Trực đội: ${K} kíp${duty.continued ? ', nối tiếp kíp tháng trước' : ''}, trực phụ đã đổi cặp theo tháng. `
      + (power.period ? `Điều độ nối tiếp chu kỳ ${power.period} ngày. ` : '') + 'Kiểm tra rồi bấm "Lưu lịch tháng".');
    if (!duty.continued && history.some(h => h.date === addDays(daysOfMonth(month)[0], -1)))
      notify.warning('Giáp tháng', 'Ca cuối tháng trước không khớp kíp nào (lịch nhập tay) — đã chọn thứ tự kíp không trùng ca giáp tháng, nên xem lại vài ngày đầu.');
    if (duty.unused.length) notify.warning('Lẻ người', `${duty.unused.map(s => s.Name).join(', ')} không được xếp vào kíp (kíp cần đủ 2 người).`);
    if (!power.period) notify.warning('Điều độ điện lực', 'Chưa đủ lịch trước đó để dò chu kỳ điều độ — vui lòng chọn điều độ từng ca.');
  };

  const handleSave = async () => {
    if (isSaving || changed.length === 0) return;
    if (conflictCount > 0) {
      const ok = await confirm({
        title: 'Lịch còn lỗi',
        message: `Còn ${conflictCount} ô vi phạm (trực 2 ca liên tiếp hoặc trùng người trong ca). Vẫn lưu?`,
        confirmLabel: 'Vẫn lưu', variant: 'danger',
      });
      if (!ok) return;
    }
    setIsSaving(true);
    try {
      for (const s of changed) {
        const r = saved.get(slotKey(s.date, s.shift));
        const data = { main_duty: s.main_duty, sub_duty: s.sub_duty, main_power: s.main_power, sub_power: s.sub_power };
        if (r) await pb.collection('shift_roster').update(r.id, data);
        else await pb.collection('shift_roster').create({ area, date: s.date, shift: s.shift, ...data });
      }
      // Đồng bộ sang các ca đã nhập (cùng khu vực/ngày/ca) để phiếu in khớp lịch
      const days = daysOfMonth(month);
      const logs = await pb.collection('handovers').getFullList<Handover>({
        filter: pb.filter('area = {:a} && startdate >= {:from} && startdate < {:to}',
          { a: area, from: `${days[0]} 00:00:00.000Z`, to: `${addDays(days[days.length - 1], 1)} 00:00:00.000Z` }),
        requestKey: null,
      });
      let synced = 0;
      for (const s of changed) {
        for (const log of logs.filter(l => l.startdate.slice(0, 10) === s.date && l.shift === s.shift)) {
          if (sameNames(s, { ...s, main_duty: log.main_duty, sub_duty: log.sub_duty, main_power: log.main_power, sub_power: log.sub_power })) continue;
          await pb.collection('handovers').update(log.id, { main_duty: s.main_duty, sub_duty: s.sub_duty, main_power: s.main_power, sub_power: s.sub_power });
          synced++;
        }
      }
      notify.success('Đã lưu lịch tháng', `${changed.length} ca${synced ? ` · cập nhật tên ${synced} ca trực đã nhập` : ''}.`);
      await load();
    } catch (err: any) {
      console.error('Save roster error:', err);
      notify.error('Lỗi lưu lịch tháng', err?.data?.message || err?.message || 'Vui lòng thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  const exportPdf = async () => {
    setIsExporting(true);
    try {
      await loadFontsToVfs();
      const head = (text: string, extra: object = {}) => ({ text, bold: true, alignment: 'center', fillColor: '#f2f2f2', ...extra });
      const pair = (s: RosterSlot | undefined, a: Role, b: Role) => s ? [s[a] || '—', s[b] || '—'].join('\n') : '';
      const byKey = new Map(slots.map(s => [slotKey(s.date, s.shift), s]));
      const body: any[] = [
        [head('Ngày', { rowSpan: 2 }), ...SHIFTS.flatMap(s => [head(s, { colSpan: 2 }), {}])],
        [{}, ...SHIFTS.flatMap(() => [head('Trực đội QLVH'), head('Điều độ điện lực')])],
        ...daysOfMonth(month).map(d => [
          { text: `${ddmm(d)}\n${weekday(d)}`, alignment: 'center', bold: true },
          ...SHIFTS.flatMap(s => {
            const slot = byKey.get(slotKey(d, s));
            return [pair(slot, 'main_duty', 'sub_duty'), pair(slot, 'main_power', 'sub_power')];
          }),
        ]),
      ];
      const docDefinition: any = {
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: [25, 25, 25, 25],
        defaultStyle: { font: 'Times', fontSize: 8.5, lineHeight: 1.1 },
        content: [
          { text: `LỊCH TRỰC VẬN HÀNH THÁNG ${month.slice(5)}/${month.slice(0, 4)}`, fontSize: 14, bold: true, alignment: 'center' },
          { text: area.toUpperCase(), fontSize: 12, bold: true, alignment: 'center', margin: [0, 2, 0, 4] },
          { text: 'Mỗi ô: dòng trên = trực chính, dòng dưới = trực phụ. Ca 1: 06:00–14:00 · Ca 2: 14:00–22:00 · Ca 3: 22:00–06:00 hôm sau.', italics: true, alignment: 'center', margin: [0, 0, 0, 6] },
          {
            table: { headerRows: 2, dontBreakRows: true, widths: [34, '*', '*', '*', '*', '*', '*'], body },
            layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => '#9ca3af', vLineColor: () => '#9ca3af', paddingTop: () => 2, paddingBottom: () => 2 },
          },
          {
            columns: [
              { width: '*', text: '' },
              { width: 220, stack: [
                { text: `Ngày ..... tháng ..... năm ${month.slice(0, 4)}`, italics: true, alignment: 'center' },
                { text: 'NGƯỜI LẬP', bold: true, alignment: 'center', margin: [0, 2, 0, 40] },
              ] },
            ],
            margin: [0, 10, 0, 0], unbreakable: true, fontSize: 10,
          },
        ],
      };
      pdfMake.createPdf(docDefinition).download(`LichTruc_${area.replace(/\s+/g, '')}_${month}.pdf`);
    } catch (err) {
      console.error('Export roster PDF error:', err);
      notify.error('Lỗi', 'Không xuất được PDF lịch trực tháng.');
    } finally {
      setIsExporting(false);
    }
  };

  const hasAny = slots.some(s => ROLES.some(r => normName(s[r])));

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink flex items-center gap-2"><CalendarRange className="w-6 h-6 text-blue-600" /> Tạo ca trực tháng</h2>
          <p className="text-soft text-sm mt-1">Phân ca cả tháng, hiệu chỉnh rồi lưu — tab "Tạo lịch trực" tự điền nhân sự theo lịch này</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <Select value={area} onChange={setArea} options={areas.map(a => ({ value: a, label: a }))} className="min-w-[180px]" />
          <MonthPicker value={month} onChange={setMonth} className="min-w-[150px]" />
          <button onClick={load} disabled={isLoading} className="vl-btn vl-btn-secondary flex items-center gap-2" title="Tải lại">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleAutoAssign} disabled={isLoading} className="vl-btn vl-btn-primary flex items-center gap-2">
            <Wand2 className="w-4 h-4" /> Phân ca tự động
          </button>
          <button onClick={handleSave} disabled={isSaving || changed.length === 0} className="vl-btn vl-btn-success flex items-center gap-2">
            <Save className="w-4 h-4" /> {isSaving ? 'Đang lưu…' : `Lưu lịch tháng${changed.length ? ` (${changed.length})` : ''}`}
          </button>
          <button onClick={exportPdf} disabled={isExporting || !hasAny} className="vl-btn vl-btn-secondary flex items-center gap-2">
            <FileDown className="w-4 h-4" /> {isExporting ? 'Đang xuất…' : 'In PDF'}
          </button>
        </div>
      </div>

      {!isLoading && (conflictCount > 0 || (hasAny && emptyCount > 0)) && (
        <div className={`vl-alert ${conflictCount ? 'vl-alert-light-danger' : 'vl-alert-light-warning'} flex items-start gap-2`}>
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            {conflictCount > 0 && <div><b>{conflictCount} ô vi phạm</b> — trực 2 ca liên tiếp hoặc trùng người trong ca (đánh dấu đỏ trong bảng).</div>}
            {hasAny && emptyCount > 0 && <div>{emptyCount} ô chưa có người trực.</div>}
          </div>
        </div>
      )}

      <div className="vl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-[10px] font-bold text-faint uppercase tracking-widest w-24">Ngày</th>
                <th className="px-4 py-3 text-[10px] font-bold text-faint uppercase tracking-widest w-20">Ca</th>
                {ROLES.map(r => (
                  <th key={r} className="px-4 py-3 text-[10px] font-bold text-faint uppercase tracking-widest">
                    {(DUTY_ROLES as readonly string[]).includes(r) ? 'QLVH · ' : 'Điều độ · '}{ROLE_LABEL[r].replace('Điều độ ', '').replace('Trực ', '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-faint">
                  <div className="flex justify-center items-center gap-3">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span>Đang tải lịch trực tháng...</span>
                  </div>
                </td></tr>
              ) : slots.map((s, i) => (
                <tr key={slotKey(s.date, s.shift)} className={s.shift === 'Ca 1' && i > 0 ? 'border-t-2 border-[var(--border)]' : ''}>
                  {s.shift === 'Ca 1' && (
                    <td rowSpan={3} className="px-4 py-2 align-top">
                      <div className="font-bold text-ink">{ddmm(s.date)}</div>
                      <div className="text-xs text-faint">{weekday(s.date)}</div>
                    </td>
                  )}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`${shiftBadgeClass(s.shift)} rounded px-2 py-0.5 text-xs font-bold`}>{s.shift}</span>
                    {crewOfMain.get(normName(s.main_duty)) && <span className="ml-1.5 text-xs text-faint font-semibold">Kíp {crewOfMain.get(normName(s.main_duty))}</span>}
                  </td>
                  {ROLES.map(role => {
                    const errs = cellIssues.get(`${s.date}|${s.shift}|${role}`);
                    return (
                      <td key={role} className="px-2 py-1.5 min-w-[170px]" title={errs?.join('\n')}>
                        <Select value={s[role]} onChange={v => setCell(s.date, s.shift, role, v)} options={options(role, s[role])}
                          placeholder="—" searchable className={errs ? 'ring-2 ring-[var(--danger)] rounded' : ''} />
                        {errs && <div className="vl-badge-danger rounded px-1.5 py-0.5 mt-1 text-[10px] font-semibold inline-block">{errs[0]}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
