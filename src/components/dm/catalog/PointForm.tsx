/**
 * Thân FORM ĐIỂM ĐO (nằm trong `FormModal` của `CatalogEntry`). Tách ngày 17/11/2026
 * (plan `2026-11-17-tach-catalog-entry.md`, đợt 4) — JSX là NGUYÊN VĂN đoạn cũ.
 * State + logic: `usePointForm.ts`; prop thêm là phần danh mục dùng chung với form khác.
 */
import {
  Package,
  Plus, Trash2, RefreshCw, FileText,
  Zap,
} from 'lucide-react';
import { Select } from '../../ui/Select';
import { Toggle } from '../../ui/Toggle';
import { DatePicker } from '../../ui/DateTimePickers';
import type { CatalogData } from '../../../lib/dm/repo';
import { ASSET_LABEL, ROLE_LABEL } from '../../../lib/dm/types';
import type {
  AssetType,
} from '../../../lib/dm/types';
import { connectionOfHsn, hsnFormula } from '../../../lib/dm/hsn';
import { TI_PER_SET } from '../../../lib/dm/pointStatus';
import {
  CellInput, DerivedValue, Field, TextInput,
} from '../entryUi';
import { StatusTag } from '../pointIcons';
import { dmy, dmyRange } from '../../../lib/dm/lifecycle';
import { CUSTOM } from '../../../lib/dm/pointCheck';
import PointNeedEditor from '../PointNeedEditor';
import { HAS_RATIO, liveFirst } from '../../../lib/dm/supply';
import {
  SHORT_NAME_HINT, SUB_PURPOSES,
  normalizeShortName,
} from '../../../lib/dm/naming';
import { SERIAL_STATE, type PointFormState } from './usePointForm';

type Opt = { value: string; label: string };
/** State của `usePointForm` + phần danh mục dùng chung với các form khác. */
type PointFormProps = PointFormState & {
  d: CatalogData | null;
  editingId: string | null;
  customerOpts: Opt[];
  stationOpts: Opt[];
  /** Mã điểm đo để nêu trong nhãn "đang treo ở …". */
  pointCodeOf: (id?: string) => string;
};

export default function PointForm(props: PointFormProps) {
  const {
    d, editingId, customerOpts, stationOpts, pointCodeOf,
    pForm, setPForm, setRegenCode, invLoading,
    pStation, pStationZone, pStationCustomer, pSubCustomer, pLine, isSub, isHead, lineHeadTaken,
    allLineOpts, parentOpts, sameCustomer, purposeLabel, mainTenant,
    generatedCode, pointCode, pointCodeMissing, codeLocked,
    hasTi, hsnInput, derivedHsn, hsnFromPlan, manualHsn, hsnMismatch, ratioRowOf, tuRow,
    activeSeg, invoiceHsn, refHsn, canFillTi, suggestedTi, fillTiFromInvoice, fillDate,
    meterRefs, invoiceNotes, setSuggestions, applySet,
    serialOptions, liveElsewhere, lockedOn, setRow, addRow, removeRow,
    isNeedRow, treoRows, needRows, saveBlocks, assetWarnings, derivedStatus, statusReason,
  } = props;
  return (
          <>
            {/* Mã điểm đo đứng ĐẦU form: nó là kết quả của mọi ô bên dưới, để
                trên cùng thì vừa gõ vừa thấy mã đổi theo, khỏi cuộn xuống. */}
            {isHead ? (
              <Field label="Mã điểm đo đầu nguồn" required
                hint="Nhập tay, khớp LINE_NAME bên HES (vd TTI.DIEMDOPHU). Đầu nguồn không thuộc trạm nên không sinh mã theo trạm được.">
                <TextInput value={pForm.head_code} mono placeholder="TTI.DIEMDOPHU"
                  onChange={v => setPForm(f => ({ ...f, head_code: v }))} />
              </Field>
            ) : (<>
            <Field label={codeLocked ? 'Mã điểm đo (đang giữ nguyên)' : 'Mã điểm đo (hệ thống tự sinh)'}
              hint={codeLocked
                ? 'Điểm đo đã chuyển chủ thể nên mã được giữ nguyên để khớp LINE_NAME bên HES.'
                : isSub
                ? `Ghép: mã trạm . ${sameCustomer ? 'nhãn mục đích' : 'tên tắt KH phụ'}(định danh điểm đo)`
                : mainTenant
                  ? 'Ghép: mã trạm . tên tắt khách thuê(định danh điểm đo) — điểm đo khác chủ trạm'
                  : 'Ghép: mã trạm(định danh điểm đo)'}>
              <DerivedValue value={pointCodeMissing.length ? '' : pointCode}
                placeholder={pForm.station ? pointCode : 'Chọn trạm trước'} />
            </Field>

            {/*
              Mã đang bị giữ mà dữ liệu hiện tại sinh ra mã khác ⇒ nói rõ hai mã,
              và cho đổi nhưng phải bấm — không âm thầm đổi định danh của điểm đo.
            */}
            {codeLocked && generatedCode !== pointCode && (
              <div className="-mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-subtle px-4 py-3">
                <span className="text-[12px] text-soft">
                  Theo dữ liệu hiện tại, mã sẽ là{' '}
                  <b className="font-mono text-dim">{generatedCode}</b>. Đang giữ mã cũ.
                </span>
                <button type="button" onClick={() => setRegenCode(true)}
                  className="vl-btn vl-btn-secondary vl-btn-sm">
                  Sinh lại mã
                </button>
              </div>
            )}
            {pointCodeMissing.length > 0 && (
              <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                Còn thiếu: {pointCodeMissing.join(', ')}. Các mảnh này lấy từ hồ sơ trạm và khách hàng.
              </p>
            )}
            </>)}

            {isHead ? (
              <Field label="Lộ đường dây" required
                hint={lineHeadTaken ? 'Lộ này đã có điểm đo đầu nguồn — mỗi lộ một điểm.'
                  : pLine ? `KCN ${d?.zones.find(z => z.id === pLine.zone)?.name ?? '—'} · đo TỔNG mọi trạm của lộ` : undefined}>
                <Select value={pForm.line} onChange={v => setPForm(f => ({ ...f, line: v }))}
                  options={allLineOpts} placeholder="Chọn lộ" searchable />
              </Field>
            ) : (
            <Field label="Trạm" required
              hint={pStation ? `KCN ${pStationZone?.code ?? '—'} · KH ${pStationCustomer?.short_name ?? '—'} · ${pStation.ident ?? '—'} · ${pStation.sdm_kva ?? '—'} kVA` : undefined}>
              <Select value={pForm.station}
                onChange={v => setPForm(f => {
                  // Doi tram thi KH mac dinh theo chu tram moi, tru khi dang sua
                  // mot diem do da khai KH rieng.
                  const st = d?.stations.find(x => x.id === v);
                  const keep = f.customer && f.customer !== pStation?.customer;
                  return { ...f, station: v, parent_point: '',
                    customer: keep ? f.customer : (st?.customer ?? '') };
                })}
                options={stationOpts} placeholder="Chọn trạm" searchable />
            </Field>
            )}

            {/*
              Không còn ô "Đấu nối": HSN = 1 đã là đấu trực tiếp rồi, hỏi thêm
              chỉ tạo cơ hội khai mâu thuẫn với bảng vật tư (user chốt 20/08).
            */}
            <Field label="Loại điểm đo">
              <Toggle value={pForm.role}
                onChange={v => setPForm(f => ({ ...f, role: v, parent_point: '' }))}
                options={[
                  { value: 'chinh', label: ROLE_LABEL.chinh },
                  { value: 'phu', label: ROLE_LABEL.phu, hex: '#8b5cf6' },
                  { value: 'dau_nguon', label: ROLE_LABEL.dau_nguon, hex: '#f59e0b' },
                ]} />
            </Field>

            {/* Đầu nguồn: không khách, không điểm cha, không đuôi mã — bỏ cả cụm. */}
            {!isHead && (<>
            {/*
              Khách hàng của điểm đo — cho CẢ điểm chính. Mặc định là chủ trạm,
              nhưng trạm cho thuê thì điểm đo thuộc khách thuê, khác chủ trạm.
            */}
            <Field label={isSub ? 'Khách hàng phụ' : 'Khách hàng của điểm đo'} required
              hint={pSubCustomer && !pSubCustomer.short_name
                ? 'KH này chưa khai tên tắt — chưa ghép được đuôi mã'
                : mainTenant
                  ? `Khác chủ trạm (${pStationCustomer?.short_name ?? '—'}) → mã thêm đuôi ${normalizeShortName(pSubCustomer?.short_name ?? '')}`
                  : isSub ? 'Tên tắt của KH này thành đuôi mã' : 'Mặc định là chủ trạm; đổi được nếu trạm cho thuê'}>
              <Select value={pForm.customer} onChange={v => setPForm(f => ({ ...f, customer: v }))}
                options={customerOpts} placeholder="Chọn khách hàng" searchable />
            </Field>

            {/* Điểm đo phụ: cần thêm điểm đo chính chứa nó */}
            {isSub && (
              <>
                <Field label="Phụ của điểm đo chính" required
                  hint={pForm.station ? undefined : 'Chọn trạm trước'}>
                  <Select value={pForm.parent_point} onChange={v => setPForm(f => ({ ...f, parent_point: v }))}
                    options={parentOpts} placeholder={parentOpts.length ? 'Chọn điểm đo chính' : 'Trạm này chưa có điểm đo chính'}
                    disabled={!parentOpts.length} searchable />
                </Field>

              </>
            )}

            {/*
              Nhãn mục đích + định danh: hai mảnh đuôi của mã điểm đo, để cạnh
              nhau cho thấy ngay mã sẽ ra thế nào. Nhãn LUÔN hiện, không còn chỉ
              bật khi điểm phụ trùng khách hàng (user chốt 25/08/2026).
            */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Nhãn mục đích (đuôi mã)"
                required={isSub && sameCustomer}
                hint={isSub && sameCustomer
                  ? 'Trùng khách hàng với điểm đo chính nên phải có nhãn để phân biệt.'
                  : 'Không bắt buộc. Bỏ trống thì đuôi mã lấy theo tên tắt khách hàng.'}>
                <Select value={pForm.purpose} onChange={v => setPForm(f => ({ ...f, purpose: v }))}
                  options={[
                    { value: '', label: 'Không có nhãn' },
                    ...SUB_PURPOSES.map(x => ({ value: x.code, label: `${x.label} (${x.code})` })),
                    { value: CUSTOM, label: 'Tự nhập ký tự…' },
                  ]}
                  placeholder="Không có nhãn" searchable />
              </Field>

              <Field label="Định danh điểm đo" hint="Không bắt buộc. Gõ 0,4 → mã có đuôi (0,4)">
                <TextInput value={pForm.ident} mono placeholder="0,4"
                  onChange={v => setPForm(f => ({ ...f, ident: v }))} />
              </Field>

              {/*
                Ô tự nhập nằm NGAY DƯỚI bộ chọn nhãn (ô thứ 3 của lưới 2 cột), để
                chọn "Tự nhập ký tự…" xong là thấy ngay chỗ gõ.

                KHÔNG chuẩn hoá lúc gõ nữa: `normalizeShortName` viết hoa và xoá
                mọi ký tự ngoài [A-Z0-9-] ngay từng phím một, nên gõ dấu tiếng
                Việt hay khoảng trắng là chữ biến mất trước mắt — cảm giác "gõ
                không ăn gì". Giữ nguyên chữ người dùng gõ, chỉ chuẩn hoá khi
                GHÉP MÃ, và hiện luôn kết quả bên dưới cho thấy mã sẽ ra sao.
              */}
              {pForm.purpose === CUSTOM && (
                <Field label="Ký tự tự nhập" required
                  hint={purposeLabel
                    ? `Đuôi mã sẽ là: ${purposeLabel}`
                    : SHORT_NAME_HINT}>
                  <TextInput value={pForm.purpose_custom} mono placeholder="KHO-LANH-2"
                    onChange={v => setPForm(f => ({ ...f, purpose_custom: v }))} />
                </Field>
              )}
            </div>
            </>)}

            {/*
              HSN NHẬP TAY, đặt TRÊN bảng vật tư (user chốt 28/09/2026): khai HSN
              trước rồi mới chọn bộ TI/TU cho khớp. HSN suy từ vật tư và HSN hóa
              đơn chỉ hiện để tham chiếu, bấm mới điền — không tự điền ngầm.
            */}
            <Field label="HSN điểm đo" required
              hint={`Vật tư đang khai: ${hsnFormula(hsnInput)}`
                + (hsnFromPlan ? ' (theo vật tư dự kiến)' : '')
                + (refHsn != null ? ` · Hóa đơn: HSN ${refHsn}` : '')}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[10rem] flex-1">
                  <TextInput value={pForm.hsn} mono placeholder="vd 40 (TI 200/5) · 1 = đo thẳng"
                    onChange={v => setPForm(f => ({ ...f, hsn: v }))} />
                </div>
                {derivedHsn != null && derivedHsn > 0 && derivedHsn !== manualHsn && (
                  <button type="button" className="vl-btn vl-btn-sm vl-btn-outline-primary"
                    onClick={() => setPForm(f => ({ ...f, hsn: String(derivedHsn) }))}>
                    Dùng {derivedHsn} theo vật tư
                  </button>
                )}
                {refHsn != null && refHsn !== manualHsn && refHsn !== derivedHsn && (
                  <button type="button" className="vl-btn vl-btn-sm vl-btn-outline-primary"
                    onClick={() => setPForm(f => ({ ...f, hsn: String(refHsn) }))}>
                    Dùng {refHsn} theo hóa đơn
                  </button>
                )}
              </div>
            </Field>

            {/* Phần NHU CẦU (quy cách) — Kinh Doanh khai; Vật Tư gắn số No dự kiến (điểm đo hai phần, 27/10/2026). */}
            <PointNeedEditor
              rows={pForm.need} onChange={need => setPForm(f => ({ ...f, need }))}
              hsn={manualHsn} connection={connectionOfHsn(manualHsn)}
              allocated={editingId ? liveFirst(d?.assets ?? [], editingId) : undefined}
              devices={d?.devices ?? []} />
            {/* Số No Vật Tư đã gắn dự kiến — thuộc phần NHU CẦU, chưa treo (treo ở màn Treo tháo). */}
            {needRows.length > 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-subtle px-4 py-3 text-[12px]">
                <p className="mb-2 font-bold uppercase tracking-wide text-dim">
                  Vật tư dự kiến đã gắn ({needRows.length}) — chưa treo
                </p>
                <div className="flex flex-wrap gap-2">
                  {needRows.map(r => (
                    <span key={r.key} className="rounded-md border border-[var(--border)] bg-surface px-2 py-1">
                      {r.type ? ASSET_LABEL[r.type as AssetType] : '—'}{' '}
                      <b className="font-mono text-ink">{r.serial}</b>{r.ratio ? ` · ${r.ratio}` : ''}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-faint">Treo thực tế thì ghi ở màn Treo tháo — số No khác đề xuất sẽ tự trả kho.</p>
              </div>
            )}

            {/* Gợi ý bộ TI/TU trong kho khớp HSN — chỉ khi đo gián tiếp (HSN > 1). */}
            {manualHsn != null && manualHsn > 1 && (hsnMismatch || !hasTi) && (
              setSuggestions.length ? (
                <div className="vl-alert vl-alert-light-primary space-y-2 text-[12px]">
                  <p className="font-bold">Bộ TI còn trong Kho khớp HSN {manualHsn}:</p>
                  <div className="flex flex-wrap gap-2">
                    {setSuggestions.map(s => (
                      <button key={`${s.ti}|${s.tu ?? ''}`} type="button"
                        className="vl-btn vl-btn-sm vl-btn-outline-primary"
                        onClick={() => applySet(s)}>
                        TI {s.ti} ({s.tiFree} rảnh)
                        {s.tu && <> × TU {s.tu} ({s.tuFree} rảnh)</>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] opacity-80">
                    Bấm một bộ để thêm sẵn {TI_PER_SET} dòng TI rồi chọn Số No.
                  </p>
                </div>
              ) : (
                <div className="vl-alert vl-alert-light-warning text-[12px]">
                  Kho chưa có bộ TI nào (đủ {TI_PER_SET} cái rảnh) khớp HSN {manualHsn}
                  — khai thiết bị ở tab Kho vật tư trước.
                </div>
              )
            )}

            {/* ---------------- Bảng vật tư gắn ở điểm đo ---------------- */}
            <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
                  <Package className="h-4 w-4" /> Treo tháo — vật tư thực tế ở điểm đo
                </p>
                <span className="text-[11px] text-faint">
                  {treoRows.length} thiết bị · bắt buộc ngày treo
                  {treoRows.some(r => !r.active) &&
                    ` · ${treoRows.filter(r => r.active).length} đang hoạt động`}
                </span>
              </div>
              {/* Chú giải icon ở ô chọn Số No. */}
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
                {Object.values(SERIAL_STATE).map(s => (
                  <span key={s.label} className="flex items-center gap-1">
                    <s.icon className={`h-3.5 w-3.5 ${s.cls}`} /> {s.label}
                  </span>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-surface">
                {/* table-fixed + colgroup: khoá tỷ lệ cột, không để nội dung
                    trong ô tự kéo co làm cột "Số No" teo lại. */}
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '17%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '6%' }} />
                  </colgroup>
                  <thead className="border-b border-[var(--border)] bg-subtle">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-soft">Thiết bị</th>
                      <th className="px-4 py-3 text-left font-bold text-soft">Số No</th>
                      <th className="px-4 py-3 text-left font-bold text-soft">Tỷ số</th>
                      <th className="px-2 py-3 text-left font-bold text-soft">Ngày treo</th>
                      <th className="px-2 py-3 text-left font-bold text-soft">Ngày tháo</th>
                      <th className="px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {treoRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-[13px] italic text-faint">
                          Chưa treo thiết bị nào — treo thực tế thì bấm "Thêm dòng" và khai ngày treo.
                        </td>
                      </tr>
                    ) : treoRows.map(r => (
                      // Dòng đã ngưng hoạt động làm mờ đi — vẫn sửa được, chỉ
                      // để mắt nhận ra ngay đâu là thiết bị đang treo.
                      <tr key={r.key} className={r.active ? '' : 'opacity-60'}>
                        <td className="p-2">
                          {isNeedRow(r) ? (
                            <span className="block p-2 text-soft">{r.type ? ASSET_LABEL[r.type as AssetType] : '—'}</span>
                          ) : (
                            <Select value={r.type} variant="bare"
                              onChange={v => setRow(r.key, { type: v as AssetType })}
                              options={Object.entries(ASSET_LABEL).map(([value, label]) => ({ value, label }))}
                              placeholder="Chọn thiết bị" />
                          )}
                          {/* Dòng NHU CẦU chưa treo (Vật Tư gắn) — khai ngày treo là treo nó. */}
                          {r.type && r.serial.trim() && !r.dateOn.trim() && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-faint"
                              title="Nhóm Vật Tư gắn cho điểm đo — khai ngày treo khi đã treo thực tế">
                              nhu cầu
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {isNeedRow(r) ? (
                            <span className="block p-2 font-mono font-semibold text-soft">{r.serial}</span>
                          ) : (() => {
                            const opts = serialOptions(r);
                            return (<>
                              <Select value={r.serial.trim()} variant="bare" searchable
                                onChange={v => setRow(r.key, { serial: v })}
                                options={opts} placeholder="Chọn từ Kho" />
                              {opts.length === 0 && (
                                <span className="mt-1 block text-[11px] leading-snug text-bad">
                                  Kho chưa có {r.type ? ASSET_LABEL[r.type as AssetType] : 'vật tư'} nào
                                  — khai ở tab Kho vật tư trước
                                </span>
                              )}
                            </>);
                          })()}
                        </td>
                        <td className="p-2">
                          {/* Dòng MỚI: tỷ số theo thiết bị trong kho, chỉ đọc.
                              Dòng đã lưu giữ ô nhập như cũ. */}
                          {!r.id && HAS_RATIO.includes(r.type as AssetType) ? (
                            <span className={`block p-2 font-mono ${r.ratio ? 'text-ink' : 'text-faint'}`}
                              title="Tỷ số lấy theo thiết bị trong Kho — sửa ở tab Kho vật tư">
                              {r.ratio || '—'}
                            </span>
                          ) : HAS_RATIO.includes(r.type as AssetType) ? (
                            <CellInput value={r.ratio} mono
                              placeholder={r.type === 'TU' ? '22000/100' : '200/5'}
                              onChange={v => setRow(r.key, { ratio: v })} />
                          ) : <span className="block p-2 text-faint">—</span>}
                        </td>
                        <td className="p-2">
                          {/* usePortal: bảng nằm trong khung overflow-hidden,
                              không có portal thì lịch bị cắt mất. */}
                          {lockedOn(r) ? (
                            // Thiết bị còn treo ở điểm đo cũ — khoá ngày treo.
                            <span className="flex items-center gap-1 p-2 text-[11px] leading-snug text-faint"
                              title={`Đang treo ở ${pointCodeOf(liveElsewhere(r.serial)?.point)} — `
                                + 'khai ngày tháo ở điểm đo đó trước rồi mới khai ngày treo ở đây'}>
                              <Zap className="h-3.5 w-3.5 shrink-0 text-red-500" />
                              Chờ tháo ở {pointCodeOf(liveElsewhere(r.serial)?.point)}
                            </span>
                          ) : (
                            <DatePicker value={r.dateOn} usePortal
                              onChange={v => setRow(r.key, { dateOn: v })} />
                          )}
                        </td>
                        <td className="p-2">
                          <DatePicker value={r.dateOff} usePortal
                            onChange={v => setRow(r.key, { dateOff: v })} />
                        </td>
                        <td className="p-2 text-center">
                          {!isNeedRow(r) && (
                            <button type="button" onClick={() => removeRow(r.key)} title="Bỏ dòng"
                              className="p-1 text-faint transition-colors hover:text-red-500">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button type="button" onClick={() => addRow()}
                className="mt-3 flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                <Plus className="h-4 w-4" /> Thêm dòng
              </button>
            </div>


            {/*
              Đối chiếu hóa đơn — THAM CHIẾU, không tự điền gì cả.
              Hóa đơn chuẩn cho HSN, nhưng không nói được ngày treo/tháo.
            */}
            {(invLoading || activeSeg || invoiceNotes.length > 0) && (
              <div className="rounded-lg border border-dashed border-[var(--border)] bg-subtle/40 p-4 text-[12px] space-y-2">
                <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px] text-faint">
                  <FileText className="h-3.5 w-3.5" />
                  Đối chiếu hóa đơn
                  {invLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
                </div>

                {meterRefs.filter(m => m.mine).length ? (
                  <div className="space-y-2">
                    {meterRefs.filter(m => m.mine).map(({ row, mine }) => (
                      <div key={row.key} className={`space-y-1 ${row.active ? '' : 'opacity-70'}`}>
                        <p className="text-soft">
                          Công tơ <span className="font-mono font-bold text-ink">{row.serial.trim()}</span>
                          {!row.active && <span className="ml-1 text-[10px] font-bold uppercase text-faint">đã tháo</span>}
                          {' '}· khách <span className="font-mono font-bold text-ink">{mine!.mkh}</span>
                          {' '}· phát sinh tiền điện{' '}
                          <b className="text-ink">{dmyRange(mine!.from, mine!.to)}</b>
                          {' '}({mine!.count} HĐ){mine!.isCurrent && ' — còn phát sinh gần đây'}
                          {mine!.hsn != null && <> · HSN hóa đơn <b className="text-ink">{mine!.hsn}</b></>}
                        </p>
                        {/*
                          Nút điền nhanh cho trường hợp ngày treo/tháo trùng đúng
                          mốc hóa đơn. Chỉ hiện khi ô đang khác giá trị đó — điền
                          rồi thì nút biến mất, khỏi bấm nhầm lần nữa.
                        */}
                        <div className="flex flex-wrap gap-2">
                          {row.dateOn !== mine!.from && (
                            <button type="button" onClick={() => fillDate(row.key, 'dateOn', mine!.from)}
                              className="vl-btn vl-btn-secondary vl-btn-sm">
                              Ngày treo = {dmy(mine!.from)}
                            </button>
                          )}
                          {row.dateOff !== mine!.to && (
                            <button type="button" onClick={() => fillDate(row.key, 'dateOff', mine!.to)}
                              className="vl-btn vl-btn-secondary vl-btn-sm">
                              Ngày tháo = {dmy(mine!.to)}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !invLoading && (
                  <p className="italic text-faint">
                    Chưa tra được hóa đơn nào cho các công tơ của điểm đo này.
                  </p>
                )}

                {canFillTi && suggestedTi !== ratioRowOf('TI')?.ratio && (
                  <button type="button" onClick={fillTiFromInvoice}
                    className="vl-btn vl-btn-secondary vl-btn-sm">
                    Điền tỷ số TI theo hóa đơn: {suggestedTi} (HSN {invoiceHsn})
                  </button>
                )}
                {hasTi && invoiceHsn != null && tuRow && (
                  <p className="text-faint">
                    Có TU nên không suy ngược được tỷ số — nhập cả TI và TU sao cho
                    tích hai tỷ số bằng <b className="text-ink">{invoiceHsn}</b>.
                  </p>
                )}

                {invoiceNotes.length > 0 && (
                  <div className="vl-alert vl-alert-light-warning text-[12px]">
                    <b>Nhắc:</b> {invoiceNotes.join('; ')}. Vẫn lưu được.
                  </div>
                )}
              </div>
            )}

            {/* Trạng thái do hệ thống suy — xem `lib/dm/pointStatus.ts`. */}
            <Field label="Trạng thái (hệ thống tự gắn)"
              hint="Chưa gắn công tơ, hoặc công tơ chưa khai ngày treo → Dự kiến · đã treo nhưng chưa có hóa đơn → Chưa vận hành · đã có hóa đơn → Đang vận hành · mọi vật tư đã ngưng → Đã tháo gỡ.">
              <div className="rounded border border-dashed border-[var(--border)] bg-subtle px-4 py-3">
                <StatusTag status={derivedStatus} />
                {statusReason && (
                  <div className="mt-2 text-[12px] text-muted">{statusReason}</div>
                )}
              </div>
            </Field>

            {/* Màu đỏ = thứ CHẶN lưu (đụng số chế tạo, thiếu/sai tỷ số). */}
            {saveBlocks.length > 0 && (
              <div className="vl-alert vl-alert-light-danger text-[12px]">
                <b>Không lưu được:</b> {saveBlocks.join('; ')}.
              </div>
            )}

            {assetWarnings.length > 0 && (
              <div className="vl-alert vl-alert-light-warning text-[12px]">
                <b>Nhắc:</b> {assetWarnings.join('; ')}. Vẫn lưu được — điểm đo khai dở
                sẽ hiện nhãn thiếu vật tư.
              </div>
            )}

            <Field label="Ghi chú">
              <TextInput value={pForm.note} onChange={v => setPForm(f => ({ ...f, note: v }))} />
            </Field>
          </>
  );
}
