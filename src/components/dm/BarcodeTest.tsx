/**
 * TRANG THỬ QUÉT MÃ VẠCH — `/thu-ma-vach` (user yêu cầu 27/10/2026: thử bằng điện thoại
 * trên staging trước khi gắn vào hộp "Thêm từ danh sách").
 *
 * Chỉ ĐỌC: không đăng nhập, không gọi PocketBase, không ghi gì, ảnh không lưu (chỉ giữ
 * ảnh thu nhỏ trong bộ nhớ trang để đối chiếu, tải lại trang là mất).
 * Hai cách: chụp / chọn ảnh và quét trực tiếp bằng camera. Mã vạch trước; không ra thì OCR số in trên nhãn
 * (`plateOcr.ts`, user chốt 27/10/2026).
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanLine, ScanText, Square, Trash2 } from 'lucide-react';
import { scanBarcodeFile, scanBarcodeFrame, type BarcodeHit } from '../../lib/dm/barcodeScan';
import { typeFromSerial } from '../../lib/dm/plateParse';
import { readSerialByOcr } from '../../lib/dm/plateOcr';
import { ASSET_LABEL } from '../../lib/dm/types';

interface Row {
  key: number;
  source: 'ảnh' | 'camera';
  name: string;
  thumb?: string;
  hits: BarcodeHit[];
  note: string;
  error?: string;
}

const guess = (text: string) => {
  const t = typeFromSerial(text.replace(/\s/g, ''));
  return t ? ASSET_LABEL[t] : '';
};

async function thumbOf(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = 240 / Math.max(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.7);
}

export default function BarcodeTest() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState('');
  const [live, setLive] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const keyRef = useRef(0);

  const add = (r: Omit<Row, 'key'>) => setRows(rs => [{ ...r, key: ++keyRef.current }, ...rs]);

  /** Mã vạch trước; không ra thì OCR số in trên nhãn (user chốt 27/10/2026). */
  async function processImage(f: Blob, name: string, source: Row['source'], prefix: string) {
    try {
      const [scan, thumb] = await Promise.all([scanBarcodeFile(f), thumbOf(f)]);
      const size = `${scan.width}×${scan.height}`;
      if (scan.hits.length) {
        add({ source, name, thumb, hits: scan.hits, note: `${size} · mã vạch ${scan.ms} ms · lượt: ${scan.pass}` });
        return;
      }
      const ocr = await readSerialByOcr(f, s => setBusy(`${prefix} Không thấy mã vạch — ${s}`));
      add({
        source, name, thumb,
        hits: ocr.serial ? [{ format: 'Số in trên nhãn', text: ocr.serial, engine: 'OCR', agreed: ocr.agreed }] : [],
        note: `${size} · mã vạch không đọc được · OCR ${ocr.ms} ms (bước 1: ${ocr.pass1 || '—'}, bước 2: ${ocr.pass2 || '—'})`,
      });
    } catch (e) {
      add({ source, name, hits: [], note: '', error: String((e as Error)?.message ?? e) });
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      const prefix = `Ảnh ${i + 1}/${list.length}:`;
      setBusy(`${prefix} đang đọc mã vạch…`);
      await processImage(list[i], list[i].name, 'ảnh', prefix);
    }
    setBusy('');
  }

  /** Quét trực tiếp không ra mã vạch: chụp khung hiện tại (độ phân giải camera) rồi đọc như ảnh — có OCR. */
  async function snapFrame() {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.95));
    if (!blob) return;
    setLive(false);
    setBusy('Khung camera: đang đọc mã vạch…');
    await processImage(blob, 'Khung camera', 'camera', 'Khung camera:');
    setBusy('');
  }

  // Quét trực tiếp: mở camera sau, đọc ~3 khung/giây đến khi thấy mã thì dừng.
  useEffect(() => {
    if (!live) return;
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setLiveMsg('Đưa mã vạch vào giữa khung, giữ yên…');
        let n = 0;
        while (!stop) {
          const hits = await scanBarcodeFrame(v).catch(() => []);
          n++;
          if (hits.length) {
            add({ source: 'camera', name: `Khung ${n}`, hits, note: `${v.videoWidth}×${v.videoHeight} · sau ${n} khung` });
            navigator.vibrate?.(80);
            setLive(false);
            break;
          }
          setLiveMsg(`Đang tìm mã… (${n} khung, camera ${v.videoWidth}×${v.videoHeight})`);
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) {
        setLiveMsg(`Không mở được camera: ${String((e as Error)?.message ?? e)}`);
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [live]);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="vl-card p-4 space-y-2">
          <h1 className="text-lg font-semibold flex items-center gap-2"><ScanLine className="w-5 h-5 text-accent" /> Thử quét mã vạch nhãn thiết bị</h1>
          <p className="text-sm text-dim">
            Trang thử, chỉ đọc — không ghi dữ liệu, không lưu ảnh. Chụp nhãn công tơ / TI / GP-03 để xem mã vạch đọc ra số gì.
            Nên chụp gần (10–15 cm, mã vạch chiếm ít nhất 1/3 bề ngang ảnh), đủ sáng, mã vạch nằm ngang, không loá nilon.
            Dùng ảnh gốc của camera — ảnh đã gửi qua Zalo/chat bị nén thường không đọc được.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <label className="vl-btn vl-btn-primary cursor-pointer">
              <Camera className="w-4 h-4" /> Chụp ảnh
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { void onFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="vl-btn vl-btn-secondary cursor-pointer">
              <ImagePlus className="w-4 h-4" /> Chọn ảnh có sẵn
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={e => { void onFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <button type="button" className={`vl-btn ${live ? 'vl-btn-danger' : 'vl-btn-secondary'}`} onClick={() => setLive(l => !l)}>
              {live ? <><Square className="w-4 h-4" /> Dừng quét</> : <><ScanLine className="w-4 h-4" /> Quét trực tiếp</>}
            </button>
            {rows.length > 0 && (
              <button type="button" className="vl-btn vl-btn-secondary" onClick={() => setRows([])}>
                <Trash2 className="w-4 h-4" /> Xoá kết quả
              </button>
            )}
          </div>
          {busy && <p className="text-sm text-accent">{busy}</p>}
        </div>

        {live && (
          <div className="vl-card p-3 space-y-2">
            <div className="relative">
              <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black" />
              <div className="pointer-events-none absolute inset-x-[10%] top-1/2 -translate-y-1/2 h-1/3 border-2 border-accent rounded" />
            </div>
            <p className="text-sm text-dim">{liveMsg}</p>
            <button type="button" className="vl-btn vl-btn-secondary" onClick={() => void snapFrame()}>
              <ScanText className="w-4 h-4" /> Không ra mã vạch? Chụp khung này để đọc số in (OCR)
            </button>
          </div>
        )}

        {rows.map(r => (
          <div key={r.key} className="vl-card p-3 flex gap-3">
            {r.thumb && <img src={r.thumb} alt="" className="w-20 h-20 object-cover rounded-lg shrink-0" />}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-xs text-dim break-all">{r.source === 'ảnh' ? '📷' : '🎥'} {r.name} {r.note && `· ${r.note}`}</div>
              {r.error ? (
                <div className="text-sm text-bad">Lỗi: {r.error}</div>
              ) : r.hits.length === 0 ? (
                <span className="vl-badge vl-badge-warning">Không đọc được mã vạch</span>
              ) : r.hits.map(h => (
                <div key={h.text} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold break-all">{h.text}</span>
                  <span className="vl-badge vl-badge-info">{h.format}</span>
                  <span className="vl-badge vl-badge-primary">{h.engine}{h.votes ? ` · ${h.votes} dòng` : ''}</span>
                  {h.engine === 'OCR' && (h.agreed
                    ? <span className="vl-badge vl-badge-success">2 bước OCR khớp</span>
                    : <span className="vl-badge vl-badge-warning">Kiểm tra lại số No</span>)}
                  {guess(h.text) && <span className="vl-badge vl-badge-success">{guess(h.text)}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
