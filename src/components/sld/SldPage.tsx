import { useMemo } from 'react';
import { pb } from '../../lib/pocketbase';
import SldViewer from './SldViewer';
import { getDiagramForUser } from './diagrams';

// ===================================================================
// Trang SLD — mỗi user xem 1 sơ đồ. Đây là component để cắm vào
// Dashboard (thêm 1 topTab và render <SldPage /> ở phần nội dung).
// ===================================================================
export default function SldPage() {
  // PocketBase: id user đang đăng nhập (khớp quy ước pb.authStore.model trong project).
  const userId = (pb.authStore.model?.id as string | undefined) ?? undefined;

  const diagram = useMemo(() => getDiagramForUser(userId), [userId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-800">{diagram.title}</h2>
        <p className="text-xs text-slate-500">
          Bấm vào máy cắt / dao cách ly để đóng–cắt. Nhánh mất điện chuyển màu xám.
          Trạng thái không lưu, làm mới trang sẽ trở về ban đầu.
        </p>
      </div>
      <div className="flex-1 min-h-[480px]">
        <SldViewer diagram={diagram} />
      </div>
    </div>
  );
}
