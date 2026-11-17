/**
 * Tab Trạm của màn Danh mục: bảng + nội dung form.
 * Tách khỏi `CatalogEntry.tsx` ngày 17/11/2026 (plan `2026-11-17-tach-catalog-entry.md`,
 * đợt 5) — JSX NGUYÊN VĂN; state + logic ở `useCatalog.ts`, truyền vào bằng `{...cat}`.
 */
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { stations } from '../../../lib/dm/repo';
import {
  DerivedValue, Field, NumberInput, TextInput, TH_CLS,
} from '../entryUi';
import { ZoneTables } from '../ZoneTables';
import { SDM_RANGE, P0_RANGE, PK_RANGE, toNum } from './constants';
import { RowActions } from './RowActions';
import type { CatalogState } from './useCatalog';

export function StationTable(props: CatalogState) {
  const {
    d, loading, stationGroupsShown, emptyText, zoneName, lineCodeOf, customerMkh, pointsOfStation,
    editStation, del,
  } = props;
  return (
    <>
        <>
          {!d?.zones.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một KCN ở tab "Khu công nghiệp" trước khi thêm trạm.
            </div>
          )}
          <ZoneTables groups={stationGroupsShown} unit="trạm" loading={loading}
            empty={emptyText('trạm', 'Chưa có trạm nào được khai.')}
            rowKey={s => s.id}
            columns={<>
              <th className={`${TH_CLS} w-[24%] pl-10`}>Mã trạm</th>
              <th className={`${TH_CLS} w-[16%]`}>Khu công nghiệp</th>
              <th className={`${TH_CLS} w-[12%]`}>Lộ đường dây</th>
              <th className={`${TH_CLS} w-[13%]`}>Khách hàng</th>
              <th className={`${TH_CLS} w-[9%]`}>Sdm (kVA)</th>
              <th className={`${TH_CLS} w-[11%]`}>P0 / Pk (W)</th>
              <th className={`${TH_CLS} w-[7%]`}>Điểm đo</th>
              <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
            </>}
            renderRow={s => (
              <tr className="transition-colors hover:bg-subtle/50">
                <td className="truncate px-6 py-4 pl-10 font-mono text-sm font-bold text-ink" title={s.code}>{s.code}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    {zoneName(s.zone)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {/* Chưa gắn lộ là BÌNH THƯỜNG, không tô đỏ — chỉ để nhạt. */}
                  {lineCodeOf(s.line)
                    ? <span className="font-mono text-xs font-bold text-dim">{lineCodeOf(s.line)}</span>
                    : <span className="text-[11px] italic text-faint">chưa gắn</span>}
                </td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(s.customer)}</td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{s.sdm_kva ?? '—'}</td>
                {/* Nhìn bảng phải biết ngay số nào là ĐO, số nào là ƯỚC LƯỢNG, trạm nào
                    cố ý nằm ngoài bảng tổn thất — nếu không thì ba thứ trông như một. */}
                <td className="px-6 py-4 text-sm text-soft">
                  {s.mv_metering
                    ? <span className="vl-badge-info text-[10px]">Trung thế</span>
                    : s.auto_loss_param
                      ? <span className="vl-badge-warning text-[10px]">Tự tính</span>
                      : <>{s.p0_w ?? '—'} / {s.pk_w ?? '—'}</>}
                </td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{pointsOfStation(s.id)}</td>
                <td className="px-6 py-4 pr-10 text-right">
                  <RowActions onEdit={() => editStation(s)}
                    onDelete={() => void del(`trạm ${s.code}`, () => stations.remove(s.id),
                      pointsOfStation(s.id) > 0
                        ? `Trạm này đang có ${pointsOfStation(s.id)} điểm đo. Xóa trạm KHÔNG xóa điểm đo — chúng sẽ mất trạm cha.`
                        : undefined)} />
                </td>
              </tr>
            )} />
        </>
    </>
  );
}

export function StationForm(props: CatalogState) {
  const {
    sCustomer, sForm, setSForm, customerOpts, sZone, zoneOpts, lineOptsOfZone,
    customerLacksShortName, stationCodeMissing, stationCode, lossEstimate,
  } = props;
  return (
    <>
          <>
            {/*
              4 mảnh ghép nên mã trạm — đặt trước, để ô mã bên dưới cập nhật theo.
              Khách hàng chiếm TRỌN MỘT HÀNG: nhãn là "MKH — tên đầy đủ (tên tắt)",
              tên công ty dài mấy chục ký tự, nhét chung hàng với 3 ô kia là bị
              cắt cụt không đọc nổi.
            */}
            <Field label="Khách hàng" required
              hint={sCustomer?.short_name ? `Tên tắt: ${sCustomer.short_name}` : undefined}>
              <Select value={sForm.customer} onChange={v => setSForm(f => ({ ...f, customer: v }))}
                options={customerOpts} placeholder="Chọn khách hàng" searchable />
            </Field>

            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Khu công nghiệp" required hint={sZone ? `Hậu tố: ${sZone.code}` : undefined}>
                <Select value={sForm.zone} onChange={v => setSForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chọn KCN" searchable />
              </Field>
              {/* Lộ KHÔNG bắt buộc: 133 trạm hiện chưa khai lộ, bắt buộc là
                  chặn mọi thao tác sửa trạm cho tới khi khai xong hết lộ. */}
              <Field label="Lộ đường dây"
                hint={!sForm.zone ? 'Chọn KCN trước'
                  : lineOptsOfZone(sForm.zone).length ? 'Không bắt buộc'
                    : 'KCN này chưa khai lộ nào'}>
                <Select value={sForm.line} onChange={v => setSForm(f => ({ ...f, line: v }))}
                  options={lineOptsOfZone(sForm.zone)} placeholder="Chưa gắn lộ" searchable
                  disabled={!sForm.zone || lineOptsOfZone(sForm.zone).length === 0} />
              </Field>
              <Field label="Định danh trạm" required hint="T1, T2, NX1…">
                <TextInput value={sForm.ident} mono placeholder="T1"
                  onChange={v => setSForm(f => ({ ...f, ident: v.toUpperCase() }))} />
              </Field>
              <Field label="Công suất trạm" required>
                <NumberInput value={sForm.sdm_kva} suffix="kVA" placeholder="2500"
                  min={SDM_RANGE[0]} max={SDM_RANGE[1]}
                  onChange={v => setSForm(f => ({ ...f, sdm_kva: v }))} />
              </Field>
            </div>

            {customerLacksShortName && (
              <div className="vl-alert vl-alert-light-warning text-[13px]">
                Khách hàng "{sCustomer?.name}" chưa có tên tắt. Vào Hồ sơ kinh doanh → Khách hàng bổ sung tên tắt
                thì mới ghép được mã trạm.
              </div>
            )}

            <Field label="Mã trạm (hệ thống tự sinh)"
              hint="Ghép theo: hậu tố KCN . tên tắt KH . định danh . công suất — không sửa tay được.">
              <DerivedValue value={stationCodeMissing.length ? '' : stationCode}
                placeholder={stationCode || 'Chọn đủ 4 mục phía trên'} />
            </Field>
            {stationCodeMissing.length > 0 && (
              <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                Còn thiếu: {stationCodeMissing.join(', ')}.
              </p>
            )}

            {/* ---- Thông số tổn hao: hai cờ quyết định ô P0/Pk có nhập tay được không ---- */}
            {/* `Switch` là inline-flex nên phải xếp cột tường minh, `space-y` không ăn. */}
            <div className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-subtle p-4">
              <Switch
                checked={sForm.auto_loss_param}
                onChange={v => setSForm(f => ({
                  /* Hai cờ loại trừ nhau: trạm trung thế thì không tính tổn thất,
                     bật thêm "tự động" là vô nghĩa. */
                  ...f, auto_loss_param: v, mv_metering: v ? false : f.mv_metering,
                }))}
                label="Tính tự động P0, Pk"
                title="Lấy trung bình của các trạm cùng công suất đã có số thật"
              />
              <Switch
                checked={sForm.mv_metering}
                onChange={v => setSForm(f => ({
                  ...f, mv_metering: v, auto_loss_param: v ? false : f.auto_loss_param,
                }))}
                label="Điểm đo trung thế — không tính tổn thất trạm này"
                title="Mua bán điện phía trung thế: tổn hao máy biến áp là của khách hàng"
              />
            </div>

            {sForm.mv_metering ? (
              <div className="vl-alert vl-alert-light-primary text-[13px]">
                Trạm mua bán điện phía trung thế nên tổn hao máy biến áp là của khách hàng.
                Trạm này <strong>nằm ngoài bảng tổn thất</strong>, không cần khai P0/Pk.
              </div>
            ) : sForm.auto_loss_param ? (
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Tổn hao không tải" hint="P0 — ước lượng, không phải số đo.">
                  <DerivedValue value={lossEstimate ? `${lossEstimate.p0_w} W` : ''}
                    placeholder="Chưa có trạm nào cùng công suất để lấy mẫu" />
                </Field>
                <Field label="Tổn hao ngắn mạch" hint="Pk — ước lượng, không phải số đo.">
                  <DerivedValue value={lossEstimate ? `${lossEstimate.pk_w} W` : ''}
                    placeholder="Chưa có trạm nào cùng công suất để lấy mẫu" />
                </Field>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Tổn hao không tải" hint="P0 — đơn vị W, không phải kW.">
                  <NumberInput value={sForm.p0_w} suffix="W"
                    min={P0_RANGE[0]} max={P0_RANGE[1]}
                    onChange={v => setSForm(f => ({ ...f, p0_w: v }))} />
                </Field>
                <Field label="Tổn hao ngắn mạch" hint="Pk — đơn vị W, không phải kW.">
                  <NumberInput value={sForm.pk_w} suffix="W"
                    min={PK_RANGE[0]} max={PK_RANGE[1]}
                    onChange={v => setSForm(f => ({ ...f, pk_w: v }))} />
                </Field>
              </div>
            )}

            {sForm.auto_loss_param && (
              lossEstimate ? (
                <p className="-mt-3 ml-1 text-[11px] font-semibold text-soft">
                  Trung bình của {lossEstimate.samples} trạm cùng {toNum(sForm.sdm_kva)} kVA:{' '}
                  {lossEstimate.codes.slice(0, 4).join(', ')}
                  {lossEstimate.codes.length > 4 && ` và ${lossEstimate.codes.length - 4} trạm nữa`}.
                  Số này <strong>không lưu vào trạm</strong> — khai thêm trạm có số thật thì nó tự cập nhật.
                </p>
              ) : (
                <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                  {toNum(sForm.sdm_kva)
                    ? `Chưa trạm nào ${toNum(sForm.sdm_kva)} kVA có P0/Pk thật để lấy mẫu — trạm này sẽ nằm ngoài bảng tổn thất cho tới khi có.`
                    : 'Khai công suất trạm trước thì mới tìm được trạm cùng công suất để lấy mẫu.'}
                </p>
              )
            )}
            <Field label="Ghi chú">
              <TextInput value={sForm.note} onChange={v => setSForm(f => ({ ...f, note: v }))} />
            </Field>
          </>
    </>
  );
}
