import React from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import { DatePicker, TimePicker } from '../ui/DateTimePickers';
import { kcnColorOf } from '../../lib/kcnColors';
import { fmtTime, type MeterRow } from './useHesConsumption';
import type { ReadingSection } from './useHesManualReadings';

const SECTION_COLOR = ['bg-accent shadow-[var(--accent)]/20', 'bg-purple-600 shadow-purple-600/20'];
const COLS = 7;

/** Một dòng công tơ trong bảng lấy chỉ số. */
function ReadingRow({ meter, section }: { meter: MeterRow; section: ReadingSection }) {
  const r         = section.readings[meter.MeterNo];
  const isLoading = r?.status === 'loading';
  const isError   = r?.status === 'error';
  const isOk      = r?.status === 'success';

  const cell = (val: string) => isLoading
    ? <RefreshCw className="w-3 h-3 animate-spin text-faint mx-auto" />
    : <span className={isError ? 'text-red-400' : isOk ? '' : 'text-faint'}>{val}</span>;

  return (
    <tr className="hover:bg-accent-soft transition-colors">
      <td>
        <div>
          <span className="font-mono text-xs font-bold text-accent">{meter.MeterNo}</span>
          {meter.Line && <div className="text-[10px] text-faint">{meter.Line}</div>}
        </div>
      </td>
      <td className="text-center whitespace-nowrap">
        {isLoading
          ? <RefreshCw className="w-3 h-3 animate-spin text-faint mx-auto" />
          : <span className="text-[11px] font-mono text-faint">{fmtTime(r?.recordTime)}</span>
        }
      </td>
      <td className="text-center text-xs font-bold text-accent">{cell(r?.pg || '-')}</td>
      <td className="text-center text-xs font-bold text-accent">{cell(r?.bt || '-')}</td>
      <td className="text-center text-xs font-bold text-orange-500">{cell(r?.cd || '-')}</td>
      <td className="text-center text-xs font-bold text-purple-600">{cell(r?.td || '-')}</td>
      <td className="text-center text-xs font-bold text-soft">{cell(r?.vc || '-')}</td>
    </tr>
  );
}

/**
 * Hai thẻ "Lấy chỉ số đầu kỳ / cuối kỳ" của tab HES thủ công.
 *
 * `zones` có giá trị → xếp công tơ theo KCN, mỗi KCN một dòng tiêu đề màu
 * (khối Văn phòng). Bỏ trống → một danh sách phẳng (khối Vận hành).
 */
export function HesManualSectionCards({
  sections, meters, zones, isLoadingMeters, onDateChange, onTimeChange, onFetch,
}: {
  sections: ReadingSection[];
  meters: MeterRow[];
  zones?: { area: string; rows: MeterRow[] }[];
  isLoadingMeters: boolean;
  onDateChange: (id: number, val: string) => void;
  onTimeChange: (id: number, val: string) => void;
  onFetch: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {sections.map((section, si) => (
        <div key={section.id} className="vl-card overflow-hidden flex flex-col">

          {/* Card header */}
          <div className="p-5 border-b border-[var(--border)] bg-subtle/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-lg shadow-md ${SECTION_COLOR[si]}`}>
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    {section.id === 1 ? 'Lấy chỉ số đầu kỳ' : 'Lấy chỉ số cuối kỳ'}
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-faint">Chỉ số tức thời HES</p>
                </div>
              </div>
              <button
                onClick={() => onFetch(section.id)}
                disabled={meters.length === 0 || isLoadingMeters}
                className="vl-btn vl-btn-primary vl-btn-sm gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Lấy chỉ số
              </button>
            </div>

            {/* Date + Time pickers */}
            <div className="flex gap-3">
              <DatePicker
                value={section.date}
                onChange={val => onDateChange(section.id, val)}
                label="Ngày"
                className="flex-1"
              />
              <TimePicker
                value={section.time}
                onChange={val => onTimeChange(section.id, val)}
                label="Giờ (24h)"
                className="flex-1"
              />
            </div>
          </div>

          {/* Reading table */}
          <div className="flex-1 overflow-x-auto" style={{ maxHeight: 440 }}>
            <table className="vl-table w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  <th>Công tơ</th>
                  <th className="text-center text-faint">Thời gian</th>
                  <th className="text-center text-accent">Tổng</th>
                  <th className="text-center text-accent">Biểu 1</th>
                  <th className="text-center text-orange-500">Biểu 2</th>
                  <th className="text-center text-purple-600">Biểu 3</th>
                  <th className="text-center text-soft">Vô công</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {meters.length === 0 ? (
                  <tr>
                    <td colSpan={COLS} className="py-10 text-center text-faint text-sm italic">
                      Chưa có danh sách công tơ
                    </td>
                  </tr>
                ) : zones ? (
                  zones.map(({ area, rows }) => {
                    const c = kcnColorOf(area);
                    return (
                      <React.Fragment key={area}>
                        <tr className={c.bg}>
                          <td colSpan={COLS} className={`py-1.5 text-[11px] font-bold ${c.text}`}>
                            <span className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${c.dot}`} />
                            {area} · {rows.length} công tơ
                          </td>
                        </tr>
                        {rows.map(m => <ReadingRow key={m.id} meter={m} section={section} />)}
                      </React.Fragment>
                    );
                  })
                ) : (
                  meters.map(m => <ReadingRow key={m.id} meter={m} section={section} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
