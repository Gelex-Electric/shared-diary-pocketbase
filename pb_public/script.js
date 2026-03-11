const pb = new PocketBase('https://getc.up.railway.app');
let currentEditId = null;
let currentFilter = { area: '', date: '' };
let situationRows = [];

const areas = ['KCN Tiền Hải', 'KCN Phong Điền', 'KCN Thuận Thành I', 'KCN Yên Mỹ', 'KCN số 3'];

if (!pb.authStore.isValid) window.location.href = '/';

pb.collection('handovers').subscribe('*', () => loadLogs());

function renderAreaOptions() {
    const filterSelect = document.getElementById('filterArea');
    filterSelect.innerHTML = '<option value="">Tất cả khu vực</option>';
    areas.forEach(kcn => {
        const opt = document.createElement('option');
        opt.value = kcn; opt.textContent = kcn;
        filterSelect.appendChild(opt);
    });

    const modalSelect = document.getElementById('area');
    modalSelect.innerHTML = '';
    areas.forEach(kcn => {
        const opt = document.createElement('option');
        opt.value = kcn; opt.textContent = kcn;
        modalSelect.appendChild(opt);
    });
}

async function loadLogs() {
    const filterParts = [];
    if (currentFilter.area) filterParts.push(`area = '${currentFilter.area.replace(/'/g, "\\'")}'`);
    if (currentFilter.date) filterParts.push(`date = '${currentFilter.date}'`);

    const options = {
        sort: '-date',
        ...(filterParts.length > 0 && { filter: filterParts.join(' && ') })
    };

    try {
        const records = await pb.collection('handovers').getFullList(options);
        let html = '';

        records.forEach(r => {
            const safeClass = r.area ? r.area.replace(/\s+/g, '-') : 'KCN-Tien-Hai';
            const cardClass = `card-${safeClass}`;           // ← Màu toàn bộ card
            const areaClass = `kcn-${safeClass}`;            // ← Màu tên KCN
            const mainSub = [r.main_duty, r.sub_duty].filter(Boolean).join(' / ') || '-';

            html += `
            <div class="entry-card bg-white shadow rounded-3xl p-6 flex justify-between items-center ${cardClass}"
                 onclick="showDetail('${r.id}')">
                <div class="flex items-center gap-6 flex-1">
                    <div class="px-5 py-3 rounded-lg font-bold text-lg ${areaClass}">
                        ${r.area || 'Chưa có khu vực'}
                    </div>
                    <div>
                        <div class="font-medium text-gray-800">${r.date ? new Date(r.date).toLocaleDateString('vi-VN') : 'Không có ngày'}</div>
                        <div class="text-sm text-gray-600">${r.shift || '?'}</div>
                    </div>
                    <div class="text-gray-700 flex-1">Trực: ${mainSub}</div>
                </div>
                <div class="text-xs text-gray-500">${new Date(r.created).toLocaleString('vi-VN', {hour:'2-digit', minute:'2-digit'})}</div>
            </div>`;
        });

        document.getElementById('logs').innerHTML = html || 
            '<p class="text-center py-20 text-gray-500">Chưa có bản ghi nào. Hãy tạo cái đầu tiên!</p>';
    } catch (err) {
        console.error(err);
        document.getElementById('logs').innerHTML = `<p class="text-center py-20 text-red-600">Lỗi tải dữ liệu</p>`;
    }
}

function showDetail(id) {
    pb.collection('handovers').getOne(id).then(r => {
        const situationsHTML = (r.situations || []).map(s => `<tr class="border-b border-gray-200"><td class="p-3 text-emerald-600">${s.time||'--:--'}</td><td class="p-3">${s.content||''}</td></tr>`).join('');
        const html = `
            <div class="space-y-6">
                <div class="flex justify-between">
                    <div><div class="text-3xl font-bold">${r.area} - ${r.shift}</div>
                    <div class="text-xl text-gray-600">${r.date ? new Date(r.date).toLocaleDateString('vi-VN') : ''}</div></div>
                    <div class="text-right text-gray-500">Tạo lúc: ${new Date(r.created).toLocaleString('vi-VN')}</div>
                </div>
                <div class="grid grid-cols-2 gap-6 text-lg">
                    <div><strong>Trực chính:</strong> ${r.main_duty||'-'}</div>
                    <div><strong>Trực phụ:</strong> ${r.sub_duty||'-'}</div>
                    <div><strong>Trực chính điện lực:</strong> ${r.main_power||'-'}</div>
                    <div><strong>Trực phụ điện lực:</strong> ${r.sub_power||'-'}</div>
                </div>
                ${situationsHTML ? `<div><h4 class="font-semibold mb-2">Tình hình trong ca</h4><table class="w-full text-sm">${situationsHTML}</table></div>` : ''}
                ${r.notes ? `<div><strong>Lưu ý:</strong> ${r.notes}</div>` : ''}
                ${r.equipment ? `<div><strong>Trang bị:</strong> ${r.equipment}</div>` : ''}
                ${r.opinions ? `<div><strong>Ý kiến:</strong> ${r.opinions}</div>` : ''}
                <div class="flex gap-4 mt-8">
                    <button onclick="editLog('${r.id}');closeDetailModal()" class="flex-1 bg-blue-500 text-white py-4 rounded-2xl">✏️ Sửa</button>
                    <button onclick="deleteLog('${r.id}');closeDetailModal()" class="flex-1 bg-red-500 text-white py-4 rounded-2xl">🗑️ Xóa</button>
                </div>
            </div>`;
        document.getElementById('detailContent').innerHTML = html;
        document.getElementById('detailModal').classList.remove('hidden');
    }).catch(() => alert('Không tìm thấy bản ghi!'));
}

function closeDetailModal() { document.getElementById('detailModal').classList.add('hidden'); }
function applyFilter() { currentFilter.area = document.getElementById('filterArea').value; currentFilter.date = document.getElementById('filterDate').value; loadLogs(); }

// ==================== CÁC HÀM MODAL TẠO/SỬA ====================
function openCreateModal() {
    currentEditId = null;
    document.getElementById('modalTitle').textContent = '✍️ Tạo bàn giao mới';
    document.getElementById('saveBtn').textContent = 'Lưu bàn giao';
    clearModal();
    document.getElementById('modal').classList.remove('hidden');
}

function clearModal() {
    document.getElementById('date').value = '';
    document.getElementById('shift').value = 'Ca 1';
    document.getElementById('main_duty').value = '';
    document.getElementById('sub_duty').value = '';
    document.getElementById('main_power').value = '';
    document.getElementById('sub_power').value = '';
    document.getElementById('notes').value = '';
    document.getElementById('equipment').value = '';
    document.getElementById('opinions').value = '';
    
    // Tự động gán khu vực của user đang đăng nhập
    const currentArea = pb.authStore.model?.area || '';
    document.getElementById('area').value = currentArea;
    
    situationRows = [];
    renderSituationTable();
}

function renderSituationTable() {
    const tbody = document.getElementById('situationBody');
    tbody.innerHTML = '';
    situationRows.forEach((row, i) => {
        tbody.innerHTML += `
            <tr>
                <td><input type="time" value="${row.time||''}" onchange="situationRows[${i}].time=this.value" class="bg-gray-100 border border-gray-300 p-2 rounded w-full"></td>
                <td><input type="text" value="${row.content||''}" onchange="situationRows[${i}].content=this.value" class="bg-gray-100 border border-gray-300 p-2 rounded w-full"></td>
                <td><button onclick="removeSituationRow(${i})" class="text-red-600 text-xl">×</button></td>
            </tr>`;
    });
}

function addSituationRow() { situationRows.push({ time: '', content: '' }); renderSituationTable(); }
function removeSituationRow(i) { situationRows.splice(i, 1); renderSituationTable(); }

async function saveLog() {
    const data = {
        date: document.getElementById('date').value,
        area: document.getElementById('area').value,
        shift: document.getElementById('shift').value,
        main_duty: document.getElementById('main_duty').value,
        sub_duty: document.getElementById('sub_duty').value,
        main_power: document.getElementById('main_power').value,
        sub_power: document.getElementById('sub_power').value,
        notes: document.getElementById('notes').value,
        equipment: document.getElementById('equipment').value,
        opinions: document.getElementById('opinions').value,
        situations: situationRows
    };
    if (!data.date || !data.main_duty) return alert('Vui lòng nhập Ngày và Trực chính!');
    try {
        if (currentEditId) {
            await pb.collection('handovers').update(currentEditId, data);
            alert('✅ Đã cập nhật!');
        } else {
            await pb.collection('handovers').create(data);
            alert('✅ Đã tạo bàn giao mới!');
        }
        closeModal();
        loadLogs();
    } catch (err) { alert('❌ Lỗi: ' + err.message); }
}

function closeModal() { document.getElementById('modal').classList.add('hidden'); }

function editLog(id) {
    currentEditId = id;
    document.getElementById('modalTitle').textContent = '✏️ Chỉnh sửa bàn giao';
    document.getElementById('saveBtn').textContent = 'Lưu thay đổi';
    pb.collection('handovers').getOne(id).then(r => {
        document.getElementById('date').value = r.date || '';
        document.getElementById('area').value = r.area || areas[0];
        document.getElementById('shift').value = r.shift || 'Ca 1';
        document.getElementById('main_duty').value = r.main_duty || '';
        document.getElementById('sub_duty').value = r.sub_duty || '';
        document.getElementById('main_power').value = r.main_power || '';
        document.getElementById('sub_power').value = r.sub_power || '';
        document.getElementById('notes').value = r.notes || '';
        document.getElementById('equipment').value = r.equipment || '';
        document.getElementById('opinions').value = r.opinions || '';
        situationRows = r.situations || [];
        renderSituationTable();
        document.getElementById('modal').classList.remove('hidden');
    }).catch(() => alert('Không tìm thấy bản ghi!'));
}

async function deleteLog(id) {
    if (!confirm('Xác nhận xóa?')) return;
    try {
        await pb.collection('handovers').delete(id);
        loadLogs();
        alert('🗑️ Đã xóa!');
    } catch (err) { alert('❌ Không thể xóa: ' + err.message); }
}

function refreshList() { loadLogs(); }

function logout() {
    pb.collection('handovers').unsubscribe();
    pb.authStore.clear();
    window.location.href = '/';
}

window.onload = () => {
    renderAreaOptions();
    loadLogs();
};
