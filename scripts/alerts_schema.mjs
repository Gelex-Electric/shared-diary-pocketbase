#!/usr/bin/env node
/**
 * Tạo collection `alerts` — CẢNH BÁO KỸ THUẬT, không bao giờ tự xoá.
 *
 * Vì sao tách khỏi `notifications` (user chốt 16/09/2026): `createNotification`
 * dọn hàng đợi mỗi lần ghi, chỉ giữ 10 bản mới nhất mỗi KCN. Thanh toán sinh
 * hằng ngày nên cảnh báo kỹ thuật nằm chung sẽ bị đẩy ra và XOÁ MẤT — đúng thứ
 * cần giữ lại để truy vết thì lại là thứ biến mất trước.
 *
 *   notifications = thanh toán, hằng ngày, tự dọn, hiện ở chuông
 *   alerts        = sự cố kỹ thuật, hiếm, giữ vĩnh viễn, hiện ở màn Cảnh báo
 *
 * KHÔNG nhân bản theo KCN: mỗi cảnh báo MỘT bản ghi, cột `zone` chỉ để LỌC trên
 * màn hình chứ không phải phân quyền. Nhân đôi rồi sửa một bản là lệch ngay.
 *
 * Script còn CHUYỂN các cảnh báo đang nằm nhầm trong `notifications` sang
 * `alerts` — chúng được tạo ở N6 trước khi có chỗ đúng, và đang đếm ngược tới
 * lúc bị dọn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/alerts_schema.mjs --dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/alerts_schema.mjs
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS || '';
const DRY_RUN = process.argv.includes('--dry-run');

const NAME = 'alerts';
/**
 * Các `kind` thuộc về CẢNH BÁO — phần còn lại của `notifications` là thanh toán.
 *
 * KHÔNG có `hsn` (user chốt 16/09/2026): HSN giờ lấy theo điểm đo tại thời điểm
 * hiện tại (`dm_point.hsn`), không đối chiếu với HES nữa, nên lệch với HES không
 * còn là sự cố cần cảnh báo.
 */
const ALERT_KINDS = ['lui', 'lamtron', 'congto', 'phatnguoc', 'dubu'];
/** Từng là cảnh báo, nay bỏ — cần biết để dọn bản ghi cũ. */
const RETIRED_KINDS = ['hsn', 'tram'];

async function call(method, path, token, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`HTTP ${res.status} ${method} ${path}\n${text.slice(0, 300)}`); process.exit(1); }
  return text ? JSON.parse(text) : {};
}

const txt = (name) => ({ name, type: 'text', required: false, presentable: false });

const FIELDS = [
  txt('kind'),      // lui · hsn · tram · congto
  txt('title'),
  txt('message'),
  txt('zone'),      // KCN liên quan; rỗng = không thuộc KCN nào
  txt('meters'),    // danh sách số công tơ, cách nhau dấu phẩy
  /*
    Chi tiết TỪNG công tơ để dựng bảng trên màn Cảnh báo: mảng JSON
    [{ meter, customer, zone, note, value }]. `meters` ở trên chỉ là danh sách
    phẳng — đủ để đếm, không đủ để người đọc biết công tơ nào của ai và lệch bao
    nhiêu. Giữ CẢ HAI: bản ghi cũ không có `details` vẫn hiện được.
  */
  { name: 'details', type: 'json', required: false, presentable: false, maxSize: 2000000 },
  txt('day'),       // ngày phát hiện, YYYY-MM-DD
  { name: 'resolved', type: 'bool', required: false, presentable: false },
  /*
    PHẢI khai tường minh: truyền `fields` thì PocketBase KHÔNG tự thêm
    created/updated, và `?sort=-created` sẽ trả HTTP 400. Màn Cảnh báo sắp theo
    thời gian phát hiện nên thiếu hai trường này là hỏng ngay.
  */
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (hoặc PB_EMAIL/PB_PASS)');
    process.exit(1);
  }
  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });

  const list = await call('GET', '/api/collections?perPage=500', token);
  console.log(`PB: ${PB_URL}`);
  const existed = list.items.some(c => c.name === NAME);

  /* ---------------------- 1. tạo collection ---------------------- */
  if (existed) {
    console.log(`\n\`${NAME}\` đã tồn tại — bỏ qua bước tạo.`);
    /*
      Bản tạo đầu tiên thiếu created/updated (truyền `fields` thì PocketBase
      không tự thêm) — vá lại cho PB đã chạy bản cũ của script này.
    */
    const cur = await call('GET', `/api/collections/${NAME}`, token);
    const missing = FIELDS.filter(f => (f.type === 'autodate' || f.type === 'json')
      && !cur.fields.some(c => c.name === f.name));
    if (missing.length) {
      const names = missing.map(f => f.name).join(', ');
      if (DRY_RUN) console.log(`   [dry-run] sẽ bổ sung ${names}.`);
      else {
        await call('PATCH', `/api/collections/${NAME}`, token,
          { fields: [...cur.fields, ...missing] });
        console.log(`   + đã bổ sung ${names}.`);
      }
    }
  } else if (DRY_RUN) {
    console.log(`\n[dry-run] sẽ tạo \`${NAME}\` với ${FIELDS.length} trường: `
      + FIELDS.map(f => f.name).join(', '));
    console.log('   + list/view: phải đăng nhập · create/update: chỉ superuser · DELETE: KHOÁ');
  } else {
    await call('POST', '/api/collections', token, {
      name: NAME,
      type: 'base',
      fields: FIELDS,
      /* Ai đăng nhập cũng xem được — lệch HSN ở KCN nào thì cả bộ phận kỹ thuật nên biết. */
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      /* Script pipeline ghi bằng tài khoản superuser; app chỉ được đánh dấu đã xử lý. */
      createRule: null,
      updateRule: '@request.auth.id != ""',
      /*
        XOÁ BỊ KHOÁ HẲN (user chốt 16/09): cảnh báo là thông tin quan trọng,
        không được xoá. Xong việc thì đặt `resolved = true`, bản ghi vẫn còn.
      */
      deleteRule: null,
      indexes: [`CREATE INDEX \`idx_${NAME}_kind_day\` ON \`${NAME}\` (\`kind\`, \`day\`)`],
    });
    console.log(`\n✔ Đã tạo \`${NAME}\` (${FIELDS.length} trường, xoá bị khoá).`);
  }

  /* -------- 2. chuyển cảnh báo đang nằm nhầm trong notifications -------- */
  const recs = [];
  for (let page = 1; ; page++) {
    const r = await call('GET', `/api/collections/notifications/records?perPage=500&page=${page}`, token);
    recs.push(...r.items);
    if (page >= (r.totalPages ?? 1)) break;
  }
  const stray = recs.filter(r => ALERT_KINDS.includes(r.kind));
  /* `hsn` không còn là cảnh báo: xoá khỏi notifications, KHÔNG chuyển sang alerts. */
  const retired = recs.filter(r => RETIRED_KINDS.includes(r.kind));
  if (retired.length) {
    console.log(`Bỏ qua ${retired.length} bản \`hsn\` (không còn cảnh báo HSN) — sẽ xoá luôn.`);
  }
  console.log(`\nnotifications: ${recs.length} bản ghi, trong đó ${stray.length} là cảnh báo kỹ thuật.`);

  /*
    Nhiều bản ghi trùng nội dung vì N6 nhân bản theo KCN. Gộp theo `message`:
    mỗi cảnh báo chỉ còn MỘT bản trong `alerts`, `zone` lấy bản có KCN (bản
    `area=''` là bản toàn cục, không mang thông tin KCN).
  */
  const byMessage = new Map();
  for (const r of stray) {
    const cur = byMessage.get(r.message) ?? { rec: r, areas: new Set() };
    if (r.area) cur.areas.add(r.area);
    byMessage.set(r.message, cur);
  }

  /*
    KCN cho bản gộp: đúng MỘT khu vực thì ghi khu vực đó; TRẢI NHIỀU khu vực thì
    để rỗng (cảnh báo toàn cục).

    Bản gốc dùng CÙNG một `message` cho mọi KCN — nội dung liệt kê hết công tơ
    của các khu — nên chọn bừa một khu là gán sai. Ví dụ cảnh báo lệch HSN có bản
    ở cả KCN Số 3 lẫn KCN Tiền Hải.
  */
  for (const v of byMessage.values()) {
    v.zone = v.areas.size === 1 ? [...v.areas][0] : '';
  }
  const spread = [...byMessage.values()].filter(v => v.areas.size > 1).length;
  console.log(`Gộp trùng theo nội dung: ${stray.length} → ${byMessage.size} cảnh báo`
    + `${spread ? ` (${spread} cái trải nhiều KCN → để zone rỗng)` : ''}.`);

  if (DRY_RUN) {
    for (const { rec, zone, areas } of byMessage.values()) {
      console.log(`   [dry-run] ${String(rec.kind).padEnd(8)} zone="${zone}"`
        + `${areas.size > 1 ? ` (từ ${[...areas].join(", ")})` : ''} — ${rec.title}`);
    }
    console.log(`\n[dry-run] sẽ tạo ${byMessage.size} bản ghi trong \`${NAME}\`, `
      + `rồi xoá ${stray.length} bản gốc khỏi notifications.`);
    return;
  }

  let made = 0;
  for (const { rec, zone } of byMessage.values()) {
    await call('POST', `/api/collections/${NAME}/records`, token, {
      kind: rec.kind, title: rec.title, message: rec.message,
      zone,
      meters: '',                       // bản cũ không tách danh sách công tơ ra cột riêng
      day: String(rec.created).slice(0, 10),
      resolved: false,
    });
    made++;
  }
  console.log(`✔ Đã tạo ${made} cảnh báo trong \`${NAME}\`.`);

  /* Dọn bản gốc: chúng đang chiếm chỗ trong hàng đợi 10 bản/KCN của thanh toán. */
  let removed = 0;
  for (const r of [...stray, ...retired]) {
    await call('DELETE', `/api/collections/notifications/records/${r.id}`, token);
    removed++;
  }
  console.log(`✔ Đã xoá ${removed} bản cảnh báo khỏi notifications (chúng đã có chỗ đúng).`);
}

main();
