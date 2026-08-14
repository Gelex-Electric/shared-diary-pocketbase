/**
 * Màn "Quản lý chung" — thuộc nhóm "Quản lý vật tư thiết bị điện" (khối Văn phòng).
 *
 * Chỉ một việc: vẽ cây đơn vị theo DỮ LIỆU THẬT (KCN → Trạm → Điểm đo).
 * Phần nhập liệu đã tách sang màn "Danh mục" (`CatalogEntry`).
 *
 * Nhận prop `scope` (hiện chỉ gọi với 'vanphong') để sau này mở cho khối Vận
 * hành không phải chép file — nguyên tắc 17 trong ARCHITECTURE.md.
 */
import type { Scope } from '../../lib/scope';
import DataTree from './DataTree';

export default function GeneralManagement({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  return <DataTree />;
}
