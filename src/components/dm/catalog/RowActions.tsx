import { Edit2, Trash2 } from 'lucide-react';

/** Cụm nút sửa/xóa cuối mỗi hàng — khuôn giống các màn cũ. */
export const RowActions = ({ onEdit, onDelete, extra }: {
  onEdit: () => void; onDelete: () => void;
  /** Nút phụ đứng trước Sửa — hiện chỉ bảng Điểm đo dùng (chuyển chủ thể). */
  extra?: { icon: typeof Edit2; title: string; onClick: () => void };
}) => (
  <div className="flex justify-end gap-2">
    {extra && (
      <button onClick={extra.onClick} title={extra.title}
        className="rounded p-2 text-soft transition-colors hover:bg-accent-soft hover:text-blue-600">
        <extra.icon className="h-5 w-5" />
      </button>
    )}
    <button onClick={onEdit} title="Sửa"
      className="rounded p-2 text-soft transition-colors hover:bg-accent-soft hover:text-blue-600">
      <Edit2 className="h-5 w-5" />
    </button>
    <button onClick={onDelete} title="Xóa"
      className="rounded p-2 text-soft transition-colors hover:bg-[var(--danger-soft)] hover:text-red-500">
      <Trash2 className="h-5 w-5" />
    </button>
  </div>
);
