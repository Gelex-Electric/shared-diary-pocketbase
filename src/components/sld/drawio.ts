import type { SldDiagram, SldNode, SldEdge, DeviceType, SwitchState } from './types';

// ===================================================================
// BỘ CHUYỂN ĐỔI draw.io  ->  SldDiagram
// Đọc file .drawio/.xml (định dạng mxGraphModel, KHÔNG nén) mà admin
// vẽ, rồi sinh ra sơ đồ để viewer hiển thị. Admin không cần đụng code.
//
// Cách máy nhận biết loại thiết bị (ưu tiên từ trên xuống):
//  1) Thuộc tính tuỳ chỉnh sldType=... (đặt qua "Edit Style" của hình)
//  2) Suy ra từ tiền tố nhãn chữ admin gõ (MC, DCL, MBA/T, ...)
// ===================================================================

/** Suy loại thiết bị từ nhãn chữ — để admin chỉ cần gõ tên đúng quy ước. */
function inferTypeFromLabel(label: string): DeviceType | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('nguồn') || s.startsWith('nguon') || s.startsWith('src')) return 'source';
  if (s.startsWith('rmu') || s.startsWith('tủ rmu') || s.startsWith('tu rmu')) return 'rmu';
  if (s.startsWith('rec') || s.startsWith('recloser')) return 'recloser';
  if (s.startsWith('lbs') || s.startsWith('cầu dao') || s.startsWith('cau dao')) return 'lbs';
  if (s.startsWith('mof') || s.startsWith('đo lường') || s.startsWith('do luong')) return 'mof';
  if (s.startsWith('cột') || s.startsWith('cot') || s.startsWith('điểm đấu') || s.startsWith('diem dau')) return 'pole';
  if (s.startsWith('tc') || s.startsWith('thanh cái') || s.startsWith('thanh cai') || s.startsWith('busbar') || /^c4\d/.test(s)) return 'busbar';
  if (s.startsWith('mc') || s.startsWith('máy cắt') || s.startsWith('may cat')) return 'breaker';
  if (s.startsWith('dcl') || s.startsWith('dao')) return 'disconnector';
  if (s.startsWith('mba') || /^t\d/.test(s) || s.startsWith('biến áp') || s.startsWith('bien ap')) return 'transformer';
  if (s.startsWith('tải') || s.startsWith('tai') || s.startsWith('phụ tải') || s.startsWith('load')) return 'load';
  return null;
}

/** Lấy giá trị một khoá trong chuỗi style của draw.io, vd "sldType=breaker;..." */
function styleValue(style: string, key: string): string | undefined {
  const m = style.match(new RegExp(`(?:^|;)\\s*${key}=([^;]+)`, 'i'));
  return m?.[1]?.trim();
}

const VALID_TYPES: DeviceType[] = [
  'source', 'busbar', 'breaker', 'recloser', 'disconnector', 'lbs',
  'rmu', 'mof', 'pole', 'transformer', 'load',
];

/**
 * Chuyển nội dung XML draw.io thành SldDiagram.
 * @param xml  Nội dung file .drawio/.xml (đã bỏ nén — xem hướng dẫn admin)
 * @param meta id + tiêu đề cho sơ đồ
 */
export function parseDrawio(
  xml: string,
  meta: { id: string; title: string },
): SldDiagram {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('File draw.io không hợp lệ hoặc đang ở dạng nén. Hãy lưu lại ở dạng XML không nén.');
  }

  const cells = Array.from(doc.getElementsByTagName('mxCell'));
  const nodes: SldNode[] = [];
  const edges: SldEdge[] = [];
  const knownIds = new Set<string>();

  // ---- Vòng 1: các hình (vertex) -> thiết bị ----
  for (const cell of cells) {
    if (cell.getAttribute('vertex') !== '1') continue;

    const style = cell.getAttribute('style') ?? '';
    const label = (cell.getAttribute('value') ?? '').replace(/<[^>]+>/g, '').trim();

    // Xác định loại thiết bị
    let type = styleValue(style, 'sldType') as DeviceType | undefined;
    if (!type || !VALID_TYPES.includes(type)) {
      type = inferTypeFromLabel(label) ?? undefined;
    }
    if (!type) continue; // hình không phải thiết bị (ghi chú, khung...) -> bỏ qua

    const geo = cell.getElementsByTagName('mxGeometry')[0];
    const x = Number(geo?.getAttribute('x') ?? 0);
    const y = Number(geo?.getAttribute('y') ?? 0);

    const id = cell.getAttribute('id')!;
    const stateAttr = styleValue(style, 'state');
    const state: SwitchState | undefined =
      stateAttr === 'open' || stateAttr === 'closed' ? stateAttr : undefined;

    const baysAttr = styleValue(style, 'bays');
    const bays = baysAttr ? Number(baysAttr) : undefined;

    nodes.push({
      id,
      type,
      position: { x, y },
      data: {
        name: label || id,
        ...(state ? { state } : {}),
        ...(type === 'rmu' && bays ? { bays } : {}),
        ...(type === 'source' ? { isSource: true } : {}),
      },
    });
    knownIds.add(id);
  }

  // ---- Vòng 2: các đường nối (edge) ----
  for (const cell of cells) {
    if (cell.getAttribute('edge') !== '1') continue;
    const source = cell.getAttribute('source');
    const target = cell.getAttribute('target');
    if (!source || !target) continue;            // bỏ dây chưa cắm 2 đầu
    if (!knownIds.has(source) || !knownIds.has(target)) continue;
    edges.push({ id: cell.getAttribute('id')!, source, target });
  }

  if (!nodes.length) {
    throw new Error('Không tìm thấy thiết bị nào trong bản vẽ. Kiểm tra nhãn/sldType theo hướng dẫn.');
  }

  return { id: meta.id, title: meta.title, nodes, edges };
}
