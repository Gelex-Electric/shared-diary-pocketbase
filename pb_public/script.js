// ============== CẤU HÌNH ==============
const pb = new PocketBase('https://getc.up.railway.app');
const COLLECTION = 'handovers';

const AREAS = [
  'KCN Tiền Hải', 'KCN Phong Điền', 'KCN Thuận Thành I',
  'KCN Yên Mỹ', 'KCN Số 3'
];

let currentEditId = null;
let currentFilter = { area: '', dateFrom: '', dateTo: '' };
let situationRows = [];

// ============== CẤU HÌNH FONT PDF (Hỗ trợ hoàn hảo tiếng Việt) ==============
pdfMake.fonts = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf'
  }
};

// ============== KHỞI ĐỘNG ==============
if (!pb.authStore.isValid) window.location.href = '/';

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

// ============== HÀM XUẤT PDF ĐÃ ĐƯỢC NÂNG CẤP HOÀN TOÀN ==============
// ============== HÀM XUẤT PDF – ĐÃ CÓ HEIGHTS CỐ ĐỊNH + TẤT CẢ YÊU CẦU TRƯỚC ==============
async function exportToPDF(id) {
  try {
    const r = await pb.collection('handovers').getOne(id);

    // === Tính thời gian ca ===
    let caTime = '';
    const start = new Date(r.date);
    let end = new Date(r.date);
    if (r.shift === 'Ca 1') caTime = `Từ 06:00 ngày ${start.toLocaleDateString('vi-VN')} đến 14:00 ngày ${start.toLocaleDateString('vi-VN')}`;
    else if (r.shift === 'Ca 2') caTime = `Từ 14:00 ngày ${start.toLocaleDateString('vi-VN')} đến 22:00 ngày ${start.toLocaleDateString('vi-VN')}`;
    else if (r.shift === 'Ca 3') {
      end.setDate(end.getDate() + 1);
      caTime = `Từ 22:00 ngày ${start.toLocaleDateString('vi-VN')} đến 06:00 ngày ${end.toLocaleDateString('vi-VN')}`;
    }

    const giaoCaStr = r.shift === 'Ca 1' ? `14:00 ngày ${start.toLocaleDateString('vi-VN')}`
      : r.shift === 'Ca 2' ? `22:00 ngày ${start.toLocaleDateString('vi-VN')}`
      : `06:00 ngày ${end.toLocaleDateString('vi-VN')}`;

    // === Xử lý tình hình (6 dòng, cắt ngắn) ===
    let situations = (r.situations || []);
    const showSituations = situations.length > 8 ? [] : situations.slice(0, 6);
    const padRows = Array.from({ length: 6 - showSituations.length }, () => ['', '']);
    const displaySituations = showSituations.map(s => [
      s.time || '',
      (s.content || '').length > 160 ? (s.content || '').substring(0, 160) + '...' : (s.content || '')
    ]);

    const limitText = (text) => {
      const t = (text || 'Không có').trim();
      return t.length > 360 ? t.substring(0, 360) + '...' : t;
    };

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [35, 30, 35, 30],
      defaultStyle: { font: 'Roboto', fontSize: 12, lineHeight: 1.3 },
      content: [
        { text: `${r.shift} ${caTime}`, style: 'header', alignment: 'center', margin: [0, 0, 0, 10] },

        { text: 'NHÂN VIÊN VẬN HÀNH CÁC ĐƠN VỊ (ghi rõ họ tên)', style: 'subheader', margin: [0, 0, 0, 6] },
        {
          table: { headerRows: 1, widths: ['25%', '37.5%', '37.5%'], body: [
            [{ text: '', fillColor: '#e5e7eb', bold: true, alignment: 'center' },
             { text: 'Trực đội QLVH', fillColor: '#e5e7eb', bold: true, alignment: 'center' },
             { text: 'Trực điều độ điện lực', fillColor: '#e5e7eb', bold: true, alignment: 'center' }],
            ['Trực chính', r.main_duty || '', r.main_power || ''],
            ['Trực phụ', r.sub_duty || '', r.sub_power || '']
          ]},
          layout: { fillColor: (i) => (i===0)?'#e5e7eb':null, hLineWidth:()=>1, vLineWidth:()=>1, hLineColor:()=>'#9ca3af', vLineColor:()=>'#9ca3af', padding: [8,8,8,8] }
        },

        { text: 'I. TÌNH HÌNH VẬN HÀNH TRONG CA', style: 'subheader', margin: [0, 8, 0, 5] },
        ...(showSituations.length > 0 ? [{
          table: {
            headerRows: 1,
            widths: ['13%', '*'],
            heights: [22, 28, 28, 28, 28, 28, 28],   // cố định chiều cao 7 dòng (header + 6 dòng)
            body: [
              [{ text: 'Thời gian', fillColor: '#e5e7eb', bold: true, alignment: 'center' },
               { text: 'Nội dung', fillColor: '#e5e7eb', bold: true, alignment: 'center' }],
              ...displaySituations,
              ...padRows
            ]
          },
          layout: { fillColor: (i) => (i===0)?'#e5e7eb':null, hLineWidth:()=>1, vLineWidth:()=>1, hLineColor:()=>'#9ca3af', vLineColor:()=>'#9ca3af', padding: [8,8,8,8] }
        }] : []),

        { text: 'II. PHẦN GIAO NHẬN CA', style: 'subheader', margin: [0, 8, 0, 5] },
        { text: '1. Những lưu ý và tồn tại ca sau cần giải quyết:', style: 'boldSection', margin: [0, 4, 0, 3] },
        { text: limitText(r.notes), margin: [0, 0, 0, 8] },
        { text: '2. Trang bị vận hành, thông tin liên lạc, vệ sinh công nghiệp:', style: 'boldSection', margin: [0, 4, 0, 3] },
        { text: limitText(r.equipment), margin: [0, 0, 0, 8] },

        // Bảng ký – heights cố định (dòng ký rất cao để ký thoải mái)
        {
          table: {
            headerRows: 1,
            widths: ['26%', '37%', '37%'],
            heights: [22, 35, 35],   // header 22pt + 2 dòng ký mỗi dòng 85pt (cố định)
            body: [
              [
                { text: 'Giờ giao ca', fillColor: '#e5e7eb', bold: true, alignment: 'center' },
                { text: 'Người nhận ca ký', fillColor: '#e5e7eb', bold: true, alignment: 'center' },
                { text: 'Người giao ca ký', fillColor: '#e5e7eb', bold: true, alignment: 'center' }
              ],
              [
                { text: giaoCaStr, rowSpan: 2, alignment: 'center', bold: true },
                { text: ' ', alignment: 'center' },
                { text: ' ', alignment: 'center' }
              ],
              [
                '',
                { text: ' ', alignment: 'center' },
                { text: ' ', alignment: 'center' }
              ]
            ]
          },
          layout: {
            fillColor: (i) => (i===0)?'#e5e7eb':null,
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#9ca3af',
            vLineColor: () => '#9ca3af',
            padding: [8, 12, 8, 12]
          }
        },

        { text: '3. Ý kiến lãnh đạo đơn vị:', style: 'boldSection', margin: [0, 8, 0, 3] },
        { text: limitText(r.opinions), margin: [0, 0, 0, 0] }
      ],
      styles: {
        header: { fontSize: 14, bold: true },
        subheader: { fontSize: 13, bold: true },
        boldSection: { bold: true, fontSize: 12 }
      }
    };

    const cleanArea = (r.area || 'KCN').replace(/ /g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    pdfMake.createPdf(docDefinition).download(`SoTruc_${cleanArea}_${r.shift}_${new Date(r.date).toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric'})}.pdf`);

  } catch (err) {
    console.error(err);
    alert('❌ Lỗi khi xuất PDF: ' + (err.message || 'Kiểm tra kết nối'));
  }
}