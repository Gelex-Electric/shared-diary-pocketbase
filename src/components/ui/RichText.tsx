/** Ô soạn richtext gọn + khối hiển thị — quy tắc nội dung ở `lib/richText.ts`. */
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Check, X, type LucideIcon } from 'lucide-react';
import { normalizeRichText, richTextToHtml, sanitizeRichText } from '../../lib/richText';

const TOOLS: { command: string; icon: LucideIcon; title: string }[] = [
  { command: 'bold', icon: Bold, title: 'Đậm (Ctrl+B)' },
  { command: 'italic', icon: Italic, title: 'Nghiêng (Ctrl+I)' },
  { command: 'underline', icon: Underline, title: 'Gạch chân (Ctrl+U)' },
  { command: 'insertUnorderedList', icon: List, title: 'Danh sách chấm' },
  { command: 'insertOrderedList', icon: ListOrdered, title: 'Danh sách số' },
];

export function RichTextEditor({ value, onChange, placeholder }: {
  value: string; onChange: (html: string) => void; placeholder?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');

  // Chỉ ghi lại DOM khi giá trị đổi từ ngoài (mở việc khác), không thì con trỏ nhảy về đầu.
  useEffect(() => {
    const el = box.current;
    if (el && normalizeRichText(el.innerHTML) !== value) el.innerHTML = richTextToHtml(value);
  }, [value]);

  const emit = () => { if (box.current) onChange(normalizeRichText(box.current.innerHTML)); };

  const exec = (command: string, arg?: string) => {
    box.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const openLink = () => {
    const sel = window.getSelection();
    savedRange.current = sel?.rangeCount && box.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setUrl('');
    setLinking(true);
  };

  const applyLink = () => {
    const raw = url.trim();
    setLinking(false);
    if (!raw) return;
    const href = /^(https?:|mailto:)/i.test(raw) ? raw : `https://${raw}`;
    box.current?.focus();
    const range = savedRange.current;
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    if (range && !range.collapsed) exec('createLink', href);
    else {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = raw;
      exec('insertHTML', `${sanitizeRichText(a.outerHTML)}&nbsp;`);
    }
  };

  const onLinkKey = (e: KeyboardEvent) => {
    // Enter trong ô link không được nộp form của hộp thoại.
    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
    if (e.key === 'Escape') { e.preventDefault(); setLinking(false); }
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) exec('insertHTML', sanitizeRichText(html));
    else exec('insertText', e.clipboardData.getData('text/plain'));
  };

  return (
    <div className="vl-richtext-editor">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] p-1">
        {TOOLS.map(({ command, icon: Icon, title }) => (
          <button key={command} type="button" title={title} aria-label={title}
            // Giữ vùng đang bôi đen khi bấm nút.
            onMouseDown={e => e.preventDefault()} onClick={() => exec(command)}
            className="vl-btn vl-btn-secondary vl-btn-sm">
            <Icon className="w-4 h-4" />
          </button>
        ))}
        <button type="button" title="Chèn link" aria-label="Chèn link"
          onMouseDown={e => e.preventDefault()} onClick={openLink}
          className="vl-btn vl-btn-secondary vl-btn-sm">
          <Link2 className="w-4 h-4" />
        </button>
        {linking && (
          <div className="flex flex-1 min-w-[12rem] items-center gap-1">
            <input autoFocus value={url} onChange={e => setUrl(e.target.value)} onKeyDown={onLinkKey}
              placeholder="https://…" className="vl-richtext-url" />
            <button type="button" title="Chèn" aria-label="Chèn" onClick={applyLink} className="vl-btn vl-btn-primary vl-btn-sm"><Check className="w-4 h-4" /></button>
            <button type="button" title="Huỷ" aria-label="Huỷ" onClick={() => setLinking(false)} className="vl-btn vl-btn-secondary vl-btn-sm"><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>
      <div ref={box} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
        data-placeholder={placeholder} onInput={emit} onPaste={onPaste}
        className="vl-richtext vl-richtext-input" />
    </div>
  );
}

export function RichTextView({ value, className = '' }: { value: string; className?: string }) {
  return <div className={`vl-richtext ${className}`} dangerouslySetInnerHTML={{ __html: richTextToHtml(value) }} />;
}
