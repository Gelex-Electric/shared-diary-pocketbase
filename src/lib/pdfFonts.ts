/**
 * Nạp font Times (Tinos) vào pdfmake — dùng chung cho phiếu ca trực và lịch trực tháng.
 * Tải một lần mỗi phiên; các lần sau trả về ngay.
 */
import pdfMake from 'pdfmake/build/pdfmake';

const timesUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Regular.ttf';
const timesBdUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Bold.ttf';
const timesBiUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-BoldItalic.ttf';
const timesIUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Italic.ttf';

let fontsLoaded = false;

export const loadFontsToVfs = async () => {
  if (fontsLoaded) return;
  const entries: [string, string][] = [
    ['times.ttf', timesUrl],
    ['timesbd.ttf', timesBdUrl],
    ['timesbi.ttf', timesBiUrl],
    ['timesi.ttf', timesIUrl],
  ];
  await Promise.all(entries.map(async ([name, url]) => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    (pdfMake as any).virtualfs.writeFileSync(name, new Uint8Array(buf));
  }));
  pdfMake.fonts = {
    Times: { normal: 'times.ttf', bold: 'timesbd.ttf', italics: 'timesi.ttf', bolditalics: 'timesbi.ttf' }
  };
  fontsLoaded = true;
};

export { pdfMake };
