const pb = new PocketBase('https://getc.up.railway.app');
let currentEditId = null;
let currentFilter = { area: '', date: '' };
let situationRows = [];

const areas = [
    'KCN Tiền Hải',
    'KCN Phong Điền',
    'KCN Thuận Thành I',
    'KCN Yên Mỹ',
    'KCN số 3'
];

if (!pb.authStore.isValid) window.location.href = '/';

pb.collection('handovers').subscribe('*', () => loadLogs());

function renderAreaOptions() {
    const filterSelect = document.getElementById('filterArea');
    filterSelect.innerHTML = '<option value="">Tất cả khu vực</option>';
    areas.forEach(kcn => {
        const opt = document.createElement('option');
        opt.value = kcn;
        opt.textContent = kcn;
        filterSelect.appendChild(opt);
    });

    const modalSelect = document.getElementById('area');
    modalSelect.innerHTML = '';
    areas.forEach(kcn => {
        const opt = document.createElement('option');
        opt.value = kcn;
        opt.textContent = kcn;
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
            const areaClass = `kcn-${safeClass}`;
            const mainSub = [r.main_duty, r.sub_duty].filter(Boolean).join(' / ') || '-';

            html += `
            <div class="entry-card bg-white shadow rounded-3xl p-6 flex justify-between items-center" onclick="showDetail('${r.id}')">
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

        document.getElementById('logs').innerHTML = html || '<p class="text-center py-20 text-gray-500">Chưa có bản ghi nào. Hãy tạo cái đầu tiên!</p>';
    } catch (err) {
        console.error(err);
        document.getElementById('logs').innerHTML = `<p class="text-center py-20 text-red-600">Lỗi tải dữ liệu</p>`;
    }
}

// Các hàm còn lại (showDetail, closeDetailModal, applyFilter, openCreateModal, clearModal, renderSituationTable, addSituationRow, removeSituationRow, saveLog, closeModal, editLog, deleteLog, refreshList, logout) giống hệt như trong code trước đó bạn đã có.

window.onload = () => {
    renderAreaOptions();
    loadLogs();
};