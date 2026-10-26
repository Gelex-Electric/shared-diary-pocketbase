/**
 * Ô "KIỂU" của một dòng quy cách vật tư — dùng chung cho bảng nhu cầu điểm đo
 * và dòng đơn mua (luồng cấp vật tư, 26/10/2026):
 *   - TI     : hình dạng Tròn / Vuông
 *   - Công tơ: Trực tiếp (điểm đo không TI) / Gián tiếp (qua TI) — schema v24
 *   - loại khác: không có kiểu
 * Dùng lại `ui/Select` variant bare như các ô khác trong bảng.
 */
import { Select } from '../ui/Select';
import {
  CONNECTION_LABEL, SHAPE_LABEL, type AssetType, type Connection, type TiShape,
} from '../../lib/dm/types';

export const SHAPE_PICK = [
  { value: '', label: 'Chưa chọn' },
  ...(Object.keys(SHAPE_LABEL) as TiShape[]).map(s => ({ value: s, label: SHAPE_LABEL[s] })),
];
export const METER_KIND_PICK = [
  { value: '', label: 'Chưa chọn' },
  ...(Object.keys(CONNECTION_LABEL) as Connection[]).map(k => ({ value: k, label: CONNECTION_LABEL[k] })),
];

export default function VariantCell({ type, shape, meterKind, onShape, onMeterKind }: {
  type: AssetType | '';
  shape: TiShape | '';
  meterKind: Connection | '';
  onShape: (v: TiShape | '') => void;
  onMeterKind: (v: Connection | '') => void;
}) {
  if (type === 'TI') {
    return <Select value={shape} variant="bare" options={SHAPE_PICK} onChange={v => onShape(v as TiShape | '')} />;
  }
  if (type === 'CONGTO') {
    return <Select value={meterKind} variant="bare" options={METER_KIND_PICK} onChange={v => onMeterKind(v as Connection | '')} />;
  }
  return <span className="block p-2 text-faint">—</span>;
}
