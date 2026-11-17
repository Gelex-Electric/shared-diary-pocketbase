/**
 * Đồng bộ khách hàng từ hóa đơn + soát tên viết thường (`low_name`) — chỉ tab Khách hàng dùng.
 * Tách khỏi `useCatalog.ts` ngày 17/11/2026 (rà soát định kỳ, việc 5) — thân hook NGUYÊN VĂN;
 * những gì trước đây đọc qua closure của `useCatalog` nay là tham số.
 */
import { useState } from 'react';
import { useConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../../lib/toast';
import { customers, pbErrorMessage, zones } from '../../../lib/dm/repo';
import type { CatalogData } from '../../../lib/dm/repo';
import type {
  Customer,
  Zone,
} from '../../../lib/dm/types';
import { loadCustomerFacts } from '../../../lib/dm/invoiceRepo';
import { isEmptyPlan, latestByMkh, planCustomerSync } from '../../../lib/dm/customerSync';
import { autoFillable, planLowNameFix } from '../../../lib/dm/lowName';
import type { LowNameRow } from '../../../lib/dm/lowName';

export function useCustomerTools({
  d, load, confirm,
}: UseCustomerToolsDeps) {
  /* ---------------- Đồng bộ khách hàng từ hóa đơn ---------------- */
  /**
   * `MKHang` là khoá không đổi, còn tên/địa chỉ khách hàng thì đổi theo thời
   * gian ⇒ lấy theo hóa đơn có ngày chốt mới nhất.
   *
   * Ghi thẳng vào dữ liệu thật nên: xem trước → hỏi → mới ghi; chỉ tạo và cập
   * nhật, KHÔNG BAO GIỜ xoá; chạy lại không nhân bản.
   */
  const [syncing, setSyncing] = useState(false);

  /* ---------- Soát tên viết thường (`low_name`) ----------
   *
   * `low_name` là cột LƯU SẴN bản viết thường của `name` (PocketBase không có
   * `lower()` trong filter). Lưu sẵn thì lệch được: sửa `name` ở nơi khác, gõ
   * tay thiếu chữ, hoặc bản ghi cũ có trước khi cột ra đời.
   *
   * `null` = chưa soát lần nào; `[]` = đã soát và không có gì lệch.
   */
  const [lowNameRows, setLowNameRows] = useState<LowNameRow[] | null>(null);
  const [lowNameOpen, setLowNameOpen] = useState(false);
  const [fixingLowName, setFixingLowName] = useState(false);

  const auditLowName = () => {
    if (!d) return;
    const rows = planLowNameFix(d.customers);
    if (!rows.length) {
      toast.success('Khớp hết',
        `Đã soát ${d.customers.length} khách hàng — tên viết thường khớp đủ chữ với tên gốc.`);
      return;
    }
    setLowNameRows(rows);
    setLowNameOpen(true);
  };

  /**
   * CHỈ điền các ô đang TRỐNG, bằng tên gốc hạ chữ hoa.
   *
   * KHÔNG ghi đè ô đã có: `low_name` do người dùng soạn (danh từ riêng giữ hoa),
   * hạ hoa tất cả là phá dữ liệu — đã suýt xảy ra ngày 15/09/2026 khi 88/101 bản
   * ghi bị luật cũ coi là "lệch". Các dòng sai CHỮ thì phải người đọc quyết bên
   * nào đúng, máy không tự sửa được.
   *
   * Ghi thẳng vào dữ liệu THẬT (staging dùng chung PocketBase với production)
   * ⇒ đã xem trước ở bảng, còn hỏi thêm một lần nữa. Chỉ `update`, không xóa.
   */
  const fixAllLowName = async () => {
    const rows = autoFillable(lowNameRows ?? []);
    if (!rows.length) return;

    const ok = await confirm({
      title: `Sửa tên viết thường cho ${rows.length} khách hàng?`,
      message: `Ghi cột "Đề nghị" vào ${rows.length} bản ghi: lấy ký tự của tên gốc, `
        + `giữ kiểu viết hoa đang có. Không đụng tên gốc, không xóa bản ghi nào. `
        + `Ghi thẳng vào dữ liệu thật.`,
      confirmLabel: 'Sửa', variant: 'warning',
    });
    if (!ok) return;

    setFixingLowName(true);
    let done = 0;
    try {
      for (const r of rows) {
        await customers.update(r.id, { low_name: r.expected });
        done++;
      }
      setLowNameOpen(false);
      setLowNameRows(null);
      toast.success('Đã sửa', `Cập nhật tên viết thường cho ${done} khách hàng.`);
      await load();
    } catch (err) {
      // Dừng giữa chừng thì nói rõ đã ghi được bao nhiêu — bấm soát lại là ra
      // phần còn lại, không sợ ghi trùng.
      toast.error(`Dừng sau ${done}/${rows.length} bản ghi`, pbErrorMessage(err));
      await load();
    } finally {
      setFixingLowName(false);
    }
  };

  const syncCustomers = async () => {
    if (!d) return;
    setSyncing(true);
    try {
      const plan = planCustomerSync(latestByMkh(await loadCustomerFacts()), d.zones, d.customers);

      if (isEmptyPlan(plan)) {
        toast.info('Không có gì thay đổi', 'Danh mục khách hàng đã khớp hóa đơn.');
        return;
      }

      const lines = [
        plan.zonesToCreate.length && `• Tạo ${plan.zonesToCreate.length} KCN: ${plan.zonesToCreate.map(z => z.code).join(', ')}`,
        plan.customersToCreate.length && `• Tạo ${plan.customersToCreate.length} khách hàng mới`,
        plan.customersToUpdate.length && `• Cập nhật ${plan.customersToUpdate.length} khách hàng (tên / địa chỉ / KCN)`,
        plan.unknownZoneCodes.length && `• Bỏ qua mã KCN lạ: ${plan.unknownZoneCodes.join(', ')}`,
      ].filter(Boolean).join('\n');

      const ok = await confirm({
        title: 'Đồng bộ khách hàng từ hóa đơn?',
        message: `${lines}\n\nKhông xóa bản ghi nào, không đụng tên tắt đã khai. `
          + `Ghi thẳng vào dữ liệu thật.`,
        confirmLabel: 'Đồng bộ', variant: 'warning',
      });
      if (!ok) return;

      // Tạo KCN trước để còn lấy id gắn cho khách hàng.
      const zoneIdByCode = new Map(d.zones.map(z => [z.code, z.id]));
      for (const z of plan.zonesToCreate) {
        const rec = await zones.create({ code: z.code, name: z.name, active: true });
        zoneIdByCode.set(z.code, (rec as unknown as Zone).id);
      }

      for (const c of plan.customersToCreate) {
        await customers.create({
          mkh: c.mkh, name: c.name, address: c.address,
          zone: zoneIdByCode.get(c.zoneCode) || undefined, active: true,
        });
      }

      for (const u of plan.customersToUpdate) {
        const body: Partial<Customer> = {};
        for (const ch of u.changes) {
          if (ch.field === 'name') body.name = ch.to;
          if (ch.field === 'address') body.address = ch.to;
          if (ch.field === 'zone') body.zone = zoneIdByCode.get(ch.to) || undefined;
        }
        await customers.update(u.id, body);
      }

      toast.success('Đã đồng bộ',
        `${plan.zonesToCreate.length} KCN, ${plan.customersToCreate.length} khách mới, `
        + `${plan.customersToUpdate.length} khách cập nhật.`);
      if (plan.customersToCreate.length) {
        toast.warning('Chưa có tên tắt',
          `${plan.customersToCreate.length} khách hàng mới chưa có tên tắt — `
          + 'phải khai thì mới sinh được mã trạm.');
      }
      await load();
    } catch (e) {
      toast.error('Đồng bộ thất bại', pbErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  return {
    auditLowName, fixAllLowName, syncCustomers, syncing, setSyncing, lowNameRows, setLowNameRows, lowNameOpen, setLowNameOpen, fixingLowName, setFixingLowName,
  };
}

type UseCustomerToolsDeps = {
  d: CatalogData | null;
  /** Nạp lại danh mục sau khi ghi. */
  load: () => Promise<void>;
  /** Hộp xác nhận của màn (`useConfirm`) — KHÔNG phải `window.confirm`. */
  confirm: ReturnType<typeof useConfirm>['confirm'];
};
