import type { ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import type { CatalogData } from '../../lib/catalog';
import { canDrop, type DragItem, type DropTarget } from '../../lib/dnd';

/** Mã hóa target vào id của droppable để giải mã lại trong onDragEnd. */
export const targetId = (t: DropTarget) => `${t.kind}:${t.id}${t.role ? ':' + t.role : ''}`;
export const parseTarget = (id: string): DropTarget => {
  const [kind, rest, role] = id.split(':');
  return { kind: kind as DropTarget['kind'], id: rest, role: role as 'chinh' | 'phu' | undefined };
};

export const itemId = (i: DragItem) => `${i.kind}:${i.id}${i.fromPoint ? ':' + i.fromPoint : ''}`;
export const parseItem = (id: string): DragItem => {
  const [kind, rest, fromPoint] = id.split(':');
  return { kind: kind as DragItem['kind'], id: rest, fromPoint };
};

/** Phần tử kéo được. `disabled` khi tài khoản không có quyền sửa. */
export function Draggable({
  item, disabled, children,
}: { item: DragItem; disabled?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: itemId(item), disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center ${isDragging ? 'opacity-40' : ''}`}
    >
      {!disabled && (
        <span
          {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing text-faint hover:text-soft shrink-0 px-1"
          title="Kéo để di chuyển"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/**
 * Vùng thả. Tự tính hợp lệ theo `canDrop` và hiện LÝ DO khi không hợp lệ —
 * không để người dùng thả rồi mới biết bị từ chối (plan §6.2).
 */
export function Droppable({
  target, active, data, children, className = '',
}: {
  target: DropTarget;
  active: DragItem | null;
  data: CatalogData;
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: targetId(target) });
  const check = active ? canDrop(active, target, data) : null;

  let ring = '';
  if (active && check) {
    if (check.ok) ring = isOver ? 'ring-2 ring-[var(--success)] bg-[var(--success-soft)]' : 'ring-1 ring-[var(--success)]/40';
    else if (isOver) ring = 'ring-2 ring-[var(--danger)] bg-[var(--danger-soft)] cursor-not-allowed';
  }

  return (
    <div
      ref={setNodeRef}
      className={`${className} ${ring} rounded transition-all`}
      title={active && check && !check.ok ? check.reason : undefined}
    >
      {children}
      {active && isOver && check && !check.ok && (
        <p className="text-[0.7rem] text-bad px-3 py-1">{check.reason}</p>
      )}
    </div>
  );
}
