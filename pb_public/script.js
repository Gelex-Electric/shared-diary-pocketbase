// ============== CẤU HÌNH ==============
const pb = new PocketBase('https://getc.up.railway.app');
const COLLECTION = 'handovers';

const AREAS = [
  'KCN Tiền Hải',
  'KCN Phong Điền',
  'KCN Thuận Thành I',
  'KCN Yên Mỹ',
  'KCN Số 3'
];

let currentEditId = null;
let currentFilter = { area: '', dateFrom: '', dateTo: '' };
let situationRows = [];

// ============== KHỞI ĐỘNG ==============
if (!pb.authStore.isValid) {
  window.location.href = '/';
}

window.addEventListener('load', () => {
  renderAreaOptions();
  loadLogs();
  pb.collection(COLLECTION).subscribe('*', () => loadLogs());
});

// ============== ÁNH XẠ TÊN KHU VỰC → CLASS (KHÔNG DẤU) ==============
const AREA_TO_CLASS = {
    'KCN Tiền Hải':      'KCN-Tien-Hai',
    'KCN Phong Điền':    'KCN-Phong-Dien',
    'KCN Thuận Thành I': 'KCN-Thuan-Thanh-I',
    'KCN Yên Mỹ':        'KCN-Yen-My',
    'KCN Số 3':          'KCN-So-3'
};

function getSafeClassName(area = '') {
    return AREA_TO_CLASS[area] || 'KCN-Tien-Hai';
}

function renderAreaOptions() {
  const filterSel = document.getElementById('filterArea');
  filterSel.innerHTML = '<option value="">Tất cả khu vực</option>';
  AREAS.forEach(a => filterSel.insertAdjacentHTML('beforeend', `<option value="${a}">${a}</option>`));

  const modalSel = document.getElementById('area');
  modalSel.innerHTML = AREAS.map(a => `<option value="${a}">${a}</option>`).join('');
}

async function loadLogs() {
    const logsEl = document.getElementById('logs');
    logsEl.innerHTML = '<p class="text-center py-16 text-gray-500">Đang tải...</p>';

    const filterParts = [];
    if (currentFilter.area) filterParts.push(`area = '${currentFilter.area.replace(/'/g, "\\'")}'`);
    if (currentFilter.dateFrom) filterParts.push(`date >= '${currentFilter.dateFrom}'`);
    if (currentFilter.dateTo) filterParts.push(`date <= '${currentFilter.dateTo}'`);

    const options = { sort: '-date' };
    if (filterParts.length) options.filter = filterParts.join(' && ');

    try {
        const records = await pb.collection(COLLECTION).getFullList(options);

        if (!records.length) {
            logsEl.innerHTML = '<p class="text-center py-20 text-gray-500">Chưa có bản ghi nào</p>';
            return;
        }

        let html = '';
        for (const r of records) {
            const safeClass = AREA_TO_CLASS[r.area] || 'KCN-Tien-Hai';
            const mainSub = [r.main_duty, r.sub_duty].filter(Boolean).join(' / ') || '—';

            html += `
            <div class="entry-card flex items-center gap-4 cursor-pointer card-${safeClass}"
                 onclick="showDetail('${r.id}')">
                
                <!-- Badge khu vực -->
                <div class="kcn-badge kcn-${safeClass}">
                    ${r.area || '—'}
                </div>

                <!-- Ngày + Ca -->
                <div class="flex-1 min-w-0">
                    <span class="font-semibold text-gray-800">
                        ${r.date ? new Date(r.date).toLocaleDateString('vi-VN') : '—'}
                    </span>
                    <span class="ml-3 text-sm text-gray-500">${r.shift || '—'}</span>
                </div>

                <!-- Trực -->
                <div class="flex-1 min-w-0 text-gray-700 text-sm truncate">
                    Trực: ${mainSub}
                </div>

                <!-- Giờ tạo -->
                <div class="text-xs text-gray-400 font-medium whitespace-nowrap">
                    ${new Date(r.created).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>`;
        }

        logsEl.innerHTML = html;
    } catch (err) {
        console.error(err);
        logsEl.innerHTML = '<p class="text-center py-20 text-red-600">Không tải được dữ liệu</p>';
    }
}
// ============== CHI TIẾT ==============
async function showDetail(id) {
  try {
    const r = await pb.collection(COLLECTION).getOne(id);

    const situations = (r.situations || []).map(s => `
      <tr class="border-b border-gray-100">
        <td class="p-3 text-emerald-700 font-medium">${s.time || '—'}</td>
        <td class="p-3">${s.content || ''}</td>
      </tr>`).join('');

    const html = `
      <div class="space-y-8">
        <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div>
            <div class="text-3xl font-bold text-gray-800">${r.area || '—'} • ${r.shift || '—'}</div>
            <div class="text-xl text-gray-600 mt-1">
              ${r.date ? new Date(r.date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
            </div>
          </div>
          <div class="text-right text-gray-500 text-sm">
            Tạo: ${new Date(r.created).toLocaleString('vi-VN')}
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-lg">
          <div><strong>Trực chính:</strong> ${r.main_duty || '—'}</div>
          <div><strong>Trực phụ:</strong> ${r.sub_duty || '—'}</div>
          <div><strong>Điện lực chính:</strong> ${r.main_power || '—'}</div>
          <div><strong>Điện lực phụ:</strong> ${r.sub_power || '—'}</div>
        </div>

        ${situations ? `<div><h4 class="font-semibold mb-3">Tình hình trong ca</h4><table class="w-full text-sm">${situations}</table></div>` : ''}

        <div class="space-y-6 border-t pt-6">
          <div><strong>1. Lưu ý & tồn tại ca sau:</strong><br>${r.notes || 'Không có'}</div>
          <div><strong>2. Trang bị, liên lạc, vệ sinh:</strong><br>${r.equipment || 'Không có'}</div>
          <div><strong>3. Ý kiến lãnh đạo:</strong><br>${r.opinions || 'Không có'}</div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-10">
          <button onclick="exportToPDF('${r.id}')" class="bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-medium flex items-center justify-center gap-2">
            <i class="fas fa-file-pdf"></i> In PDF
          </button>
          <button onclick="editLog('${r.id}');closeDetailModal()" class="bg-amber-600 hover:bg-amber-700 text-white py-4 rounded-2xl flex items-center justify-center gap-2">
            <i class="fas fa-edit"></i> Sửa
          </button>
          <button onclick="deleteLog('${r.id}');closeDetailModal()" class="bg-red-600 hover:bg-red-700 text-white py-4 rounded-2xl flex items-center justify-center gap-2">
            <i class="fas fa-trash"></i> Xóa
          </button>
        </div>
      </div>`;

    document.getElementById('detailContent').innerHTML = html;
    document.getElementById('detailModal').classList.remove('hidden');
  } catch (err) {
    alert('Không tìm thấy bản ghi!');
  }
}

// ============== MODAL TẠO/SỬA ==============
function openCreateModal() {
  currentEditId = null;
  document.getElementById('modalTitle').textContent = '✍️ Tạo lịch trực mới';
  document.getElementById('saveBtn').textContent = 'Lưu lịch trực';
  clearModalFields();
  document.getElementById('modal').classList.remove('hidden');
}

function clearModalFields() {
  document.getElementById('date').value = '';
  document.getElementById('area').value = pb.authStore.model?.area || AREAS[0];
  document.getElementById('shift').value = 'Ca 1';
  ['main_duty','sub_duty','main_power','sub_power','notes','equipment','opinions'].forEach(id => {
    document.getElementById(id).value = '';
  });
  situationRows = [];
  renderSituationRows();
}

function renderSituationRows() {
    const tbody = document.getElementById('situationBody');
    tbody.innerHTML = situationRows.map((row, i) => `
        <tr>
            <td class="p-2">
                <input type="time" 
                       lang="vi" 
                       step="60"
                       value="${row.time || ''}" 
                       onchange="situationRows[${i}].time = this.value" 
                       class="w-full p-3 border border-gray-300 rounded-2xl bg-white text-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
            </td>
            <td class="p-2">
                <input type="text" 
                       value="${row.content || ''}" 
                       onchange="situationRows[${i}].content = this.value" 
                       class="w-full p-3 border border-gray-300 rounded-2xl bg-white text-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
            </td>
            <td class="p-2 text-center">
                <button onclick="removeSituationRow(${i})" 
                        class="text-red-600 hover:text-red-800 text-2xl leading-none">×</button>
            </td>
        </tr>
    `).join('');
}

function addSituationRow() {
  situationRows.push({ time: '', content: '' });
  renderSituationRows();
}

function removeSituationRow(index) {
  situationRows.splice(index, 1);
  renderSituationRows();
}

async function saveLog() {
  const data = {
    date:       document.getElementById('date').value,
    area:       document.getElementById('area').value,
    shift:      document.getElementById('shift').value,
    main_duty:  document.getElementById('main_duty').value.trim(),
    sub_duty:   document.getElementById('sub_duty').value.trim(),
    main_power: document.getElementById('main_power').value.trim(),
    sub_power:  document.getElementById('sub_power').value.trim(),
    notes:      document.getElementById('notes').value.trim(),
    equipment:  document.getElementById('equipment').value.trim(),
    opinions:   document.getElementById('opinions').value.trim(),
    situations: situationRows.filter(r => r.time || r.content) // loại bỏ dòng trống
  };

  if (!data.date || !data.main_duty) {
    alert('Vui lòng nhập ít nhất **Ngày** và **Trực chính**!');
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = currentEditId ? 'Đang cập nhật...' : 'Đang tạo...';

  try {
    if (currentEditId) {
      await pb.collection(COLLECTION).update(currentEditId, data);
      alert('Đã cập nhật thành công!');
    } else {
      await pb.collection(COLLECTION).create(data);
      alert('Đã tạo lịch trực mới!');
    }
    closeModal();
    loadLogs();
  } catch (err) {
    alert('Lỗi: ' + (err.message || 'Kiểm tra kết nối'));
  } finally {
    btn.disabled = false;
    btn.textContent = currentEditId ? 'Lưu thay đổi' : 'Lưu lịch trực';
  }
}

function editLog(id) {
  currentEditId = id;
  document.getElementById('modalTitle').textContent = '✏️ Chỉnh sửa lịch trực';
  document.getElementById('saveBtn').textContent = 'Lưu thay đổi';

  pb.collection(COLLECTION).getOne(id).then(r => {
    document.getElementById('date').value      = r.date      || '';
    document.getElementById('area').value      = r.area      || AREAS[0];
    document.getElementById('shift').value     = r.shift     || 'Ca 1';
    document.getElementById('main_duty').value = r.main_duty || '';
    document.getElementById('sub_duty').value  = r.sub_duty  || '';
    document.getElementById('main_power').value= r.main_power|| '';
    document.getElementById('sub_power').value = r.sub_power || '';
    document.getElementById('notes').value     = r.notes     || '';
    document.getElementById('equipment').value = r.equipment || '';
    document.getElementById('opinions').value  = r.opinions  || '';

    situationRows = Array.isArray(r.situations) ? r.situations : [];
    renderSituationRows();
    document.getElementById('modal').classList.remove('hidden');
  }).catch(() => alert('Không tìm thấy bản ghi!'));
}

// ============== KHÁC ==============
function closeModal()          { document.getElementById('modal').classList.add('hidden'); }
function closeDetailModal()    { document.getElementById('detailModal').classList.add('hidden'); }
function applyFilter() {
    currentFilter.area = document.getElementById('filterArea').value;
    currentFilter.dateFrom = document.getElementById('filterDateFrom').value;
    currentFilter.dateTo = document.getElementById('filterDateTo').value;
    loadLogs();
}

async function deleteLog(id) {
  if (!confirm('Bạn chắc chắn muốn xóa bản ghi này?')) return;
  try {
    await pb.collection(COLLECTION).delete(id);
    alert('Đã xóa thành công!');
    loadLogs();
  } catch (err) {
    alert('Không thể xóa: ' + err.message);
  }
}

function refreshList() { loadLogs(); }

function logout() {
  pb.collection(COLLECTION).unsubscribe();
  pb.authStore.clear();
  window.location.href = '/';
}

// ============== XUẤT PDF (giữ nguyên logic cũ nhưng cải thiện nhẹ) ==============
async function exportToPDF(id) {
    const r = await pb.collection('handovers').getOne(id);

    // === Xử lý khung giờ Ca ===
    let caTime = '';
    const startDate = new Date(r.date);
    let endDate = new Date(r.date);
    if (r.shift === 'Ca 1') {
        caTime = `Từ 06 giờ 00 ngày ${startDate.toLocaleDateString('vi-VN')} đến 14 giờ 00 ngày ${startDate.toLocaleDateString('vi-VN')}`;
    } else if (r.shift === 'Ca 2') {
        caTime = `Từ 14 giờ 00 ngày ${startDate.toLocaleDateString('vi-VN')} đến 22 giờ 00 ngày ${startDate.toLocaleDateString('vi-VN')}`;
    } else if (r.shift === 'Ca 3') {
        endDate.setDate(endDate.getDate() + 1);
        caTime = `Từ 22 giờ 00 ngày ${startDate.toLocaleDateString('vi-VN')} đến 06 giờ 00 ngày ${endDate.toLocaleDateString('vi-VN')}`;
    }

    // === Giờ giao ca (giờ cuối của ca) ===
    let giaoCaStr = '';
    const giaoDate = (r.shift === 'Ca 3') ? endDate : startDate;
    if (r.shift === 'Ca 1') giaoCaStr = `14 giờ 00 ngày ${giaoDate.toLocaleDateString('vi-VN')}`;
    else if (r.shift === 'Ca 2') giaoCaStr = `22 giờ 00 ngày ${giaoDate.toLocaleDateString('vi-VN')}`;
    else if (r.shift === 'Ca 3') giaoCaStr = `06 giờ 00 ngày ${giaoDate.toLocaleDateString('vi-VN')}`;

    const dateStr = new Date(r.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const situations = (r.situations || []).slice(0, 10);

    const contentHTML = `
<div style="font-family: 'Times New Roman', Times, serif; font-size: 11px; line-height: 1,4; padding: 20px 30px; width: 595px; margin: 0 auto; background: white;">

    <!-- Tiêu đề Ca -->
    <p style="text-align: center; margin: 0 0 8px 0; font-weight: bold; font-size: 13px;">
        ${r.shift} ${caTime}
    </p>

    <!-- Bảng Nhân viên vận hành -->
    <p style="margin: 8px 0 8px 0; font-weight: bold; font-size: 12px;">NHÂN VIÊN VẬN HÀNH CÁC ĐƠN VỊ (ghi rõ họ tên)</p>
    <table style="width:100%; border-collapse: collapse; margin-bottom: 8px;">
        <tr>
            <td style="border:0.7px solid #000; padding:6px; text-align:center; font-weight:bold; width:35%; vertical-align:middle;"></td>
            <td style="border:0.7px solid #000; padding:6px; text-align:center; font-weight:bold; vertical-align:middle;">Trực đội QLVH</td>
            <td style="border:0.7px solid #000; padding:6px; text-align:center; font-weight:bold; vertical-align:middle;">Trực điều độ điện lực</td>
        </tr>
        <tr>
            <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">Trực chính</td>
            <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">${r.main_duty || ''}</td>
            <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">${r.main_power || ''}</td>
        </tr>
        <tr>
            <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">Trực phụ</td>
            <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">${r.sub_duty || ''}</td>
            <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">${r.sub_power || ''}</td>
        </tr>
    </table>

    <!-- I. Tình hình vận hành -->
    <p style="margin: 8px 0 6px 0; font-weight: bold; font-size: 12px;">I. TÌNH HÌNH VẬN HÀNH TRONG CA (Tóm tắt diễn biến chính trong ca)</p>
    <table style="width:100%; border-collapse: collapse; margin-bottom: 8px;">
        <thead>
            <tr style="background:#f8f8f8;">
                <th style="border:0.7px solid #000; padding:6px; width:26%; text-align:center; vertical-align:middle;">Thời gian</th>
                <th style="border:0.7px solid #000; padding:6px; text-align:center; vertical-align:middle;">Nội dung</th>
            </tr>
        </thead>
        <tbody>
            ${Array(10).fill(0).map((_, i) => {
                const s = situations[i];
                return `
                <tr>
                    <td style="border:0.7px solid #000; padding:7px; text-align:center; vertical-align:middle;">${s ? s.time || '' : '...'}</td>
                    <td style="border:0.7px solid #000; padding:7px; vertical-align:middle;">${s ? s.content || '...............................' : '...............................'}</td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>

    <!-- II. Phần giao nhận ca -->
    <p style="margin: 14px 0 8px 0; font-weight: bold; font-size: 12px;">II. PHẦN GIAO NHẬN CA</p>
    <p style="margin-bottom: 8px;"><strong>1. Những lưu ý và tồn tại ca sau cần giải quyết:</strong><br>${r.notes || 'Không có'}</p>
    <p style="margin-bottom: 8px;"><strong>2. Trang bị vận hành, thông tin liên lạc, vệ sinh công nghiệp:</strong><br>${r.equipment || 'Không có'}</p>

    <!-- === BẢNG CHỮ KÝ THEO CẤU TRÚC MERGE BẠN YÊU CẦU === -->
    <table style="width:100%; border-collapse: collapse; margin: 8px 0 8px 0;">
        <tr>
            <td style="border:0.7px solid #000; padding:6px; text-align:center; font-weight:bold; width:33%;">Ngày giờ phút của Ca<br>(giờ giao ca)</td>
            <td style="border:0.7px solid #000; padding:6px; text-align:center; font-weight:bold;">Người nhận ca ký</td>
            <td style="border:0.7px solid #000; padding:6px; text-align:center; font-weight:bold;">Người giao ca ký</td>
        </tr>
        <tr>
            <!-- Cột giờ giao ca merge 2 hàng -->
            <td rowspan="2" style="border:0.7px solid #000; padding:25px; text-align:center; vertical-align:middle; font-size:12.5px;">
                <strong>${giaoCaStr}</strong>
            </td>
            <!-- Hàng ký tên thứ 1 -->
            <td style="border:0.7px solid #000; padding:18px; text-align:center; vertical-align:middle;"></td>
            <td style="border:0.7px solid #000; padding:18px; text-align:center; vertical-align:middle;"></td>
        </tr>
        <tr>
            <!-- Hàng ký tên thứ 2 -->
            <td style="border:0.7px solid #000; padding:18px; text-align:center; vertical-align:middle;"></td>
            <td style="border:0.7px solid #000; padding:18px; text-align:center; vertical-align:middle;"></td>
        </tr>
    </table>

    <p><strong>3. Ý kiến lãnh đạo đơn vị:</strong><br>${r.opinions || 'Không có'}</p>

</div>`;

    // === Xuất PDF ===
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');

    const tempDiv = document.createElement('div');
    tempDiv.style.width = '595px';
    tempDiv.innerHTML = contentHTML;
    document.body.appendChild(tempDiv);

    html2canvas(tempDiv, { scale: 3, backgroundColor: '#ffffff', logging: false })
        .then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pageWidth = 190;
            const pageHeight = 289;

            pdf.addImage(imgData, 'PNG', 10, 4, pageWidth, pageHeight);
            pdf.save(`SoTruc_${r.area || 'KCN'}_${r.shift}_${dateStr}.pdf`);

            document.body.removeChild(tempDiv);
        });
}
