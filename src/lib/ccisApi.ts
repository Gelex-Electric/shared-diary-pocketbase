/**
 * ccisApi — gọi web service HĐĐT của GELEX (muabandien.gelex-electric.com)
 * để lấy thẳng XML hóa đơn điện tử, KHÔNG cần tải file về rồi upload.
 *
 * Đi qua proxy `/ccis` (cấu hình trong server.ts) để tránh CORS.
 * Chuỗi gọi: GetDepartment → GetFigureBook(dept,year,month)
 *            → GetBill(term,month,year,figureBookId) → GetXML(...) ⇒ chuỗi XML hóa đơn.
 *
 * Dịch vụ là SOAP 1.2 (application/soap+xml); không cần xác thực.
 */

const SOAP_URL = '/ccis/Service_HDDT.asmx';
const NS = 'http://tempuri.org/';

export interface Department {
  DepartmentId: number;
  DepartmentLevel: number;
  DepartmentName: string;
  Taxcode: string;
  DepartmentCode: string;
}

export interface FigureBook {
  FigureBookId: number;
  DepartmentId: number;
  BookCode: string;
  BookName: string;
  Term: number;
  Month: number;
  Year: number;
  BookType: string;
}

export interface Bill {
  BillId: string;        // decimal — giữ dạng chuỗi để khỏi mất chính xác
  BillType: string;
  DepartmentId: number;
  FigureBookId: number;
  Month: number;
  Year: number;
  CustomerCode: string;
  CustomerName: string;
  ElectricityMeterNumber: string;
}

const esc = (v: string | number) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const envelope = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
  `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
  `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
  `<soap12:Body>${inner}</soap12:Body></soap12:Envelope>`;

async function soapCall(actionInner: string): Promise<Document> {
  const res = await fetch(SOAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: envelope(actionInner),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi gọi dịch vụ HĐĐT`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Phản hồi SOAP không hợp lệ');
  }
  // Bắt SOAP Fault nếu có
  const fault = doc.getElementsByTagName('soap:Reason')[0] || doc.getElementsByTagName('faultstring')[0];
  if (fault && fault.textContent) throw new Error(fault.textContent.trim());
  return doc;
}

// getElementsByTagNameNS không ổn định với namespace ngầm → tự tìm theo localName
const findAll = (root: Document | Element, localName: string): Element[] => {
  const out: Element[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) out.push(all[i]);
  }
  return out;
};
const text = (parent: Element, localName: string): string => {
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return (all[i].textContent || '').trim();
  }
  return '';
};
const num = (parent: Element, localName: string): number => {
  const t = text(parent, localName);
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};

export async function getDepartments(): Promise<Department[]> {
  const doc = await soapCall(`<GetDepartment xmlns="${NS}" />`);
  return findAll(doc, 'Administrator_DepartmentViewModels').map(el => ({
    DepartmentId: num(el, 'DepartmentId'),
    DepartmentLevel: num(el, 'DepartmentLevel'),
    DepartmentName: text(el, 'DepartmentName'),
    Taxcode: text(el, 'Taxcode'),
    DepartmentCode: text(el, 'DepartmentCode'),
  }));
}

export async function getFigureBooks(departmentId: number, year: number, month: number): Promise<FigureBook[]> {
  const doc = await soapCall(
    `<GetFigureBook xmlns="${NS}">` +
    `<departmentId>${esc(departmentId)}</departmentId>` +
    `<Year>${esc(year)}</Year><Month>${esc(month)}</Month></GetFigureBook>`,
  );
  return findAll(doc, 'Category_FigureBookModel').map(el => ({
    FigureBookId: num(el, 'FigureBookId'),
    DepartmentId: num(el, 'DepartmentId'),
    BookCode: text(el, 'BookCode'),
    BookName: text(el, 'BookName'),
    Term: num(el, 'Term'),
    Month: num(el, 'Month'),
    Year: num(el, 'Year'),
    BookType: text(el, 'BookType'),
  }));
}

export async function getBills(term: number, month: number, year: number, figureBookId: number): Promise<Bill[]> {
  const doc = await soapCall(
    `<GetBill xmlns="${NS}">` +
    `<term>${esc(term)}</term><month>${esc(month)}</month>` +
    `<year>${esc(year)}</year><figureBookId>${esc(figureBookId)}</figureBookId></GetBill>`,
  );
  return findAll(doc, 'Bill_ElectricityBillModel').map(el => ({
    BillId: text(el, 'BillId'),
    BillType: text(el, 'BillType'),
    DepartmentId: num(el, 'DepartmentId'),
    FigureBookId: num(el, 'FigureBookId'),
    Month: num(el, 'Month'),
    Year: num(el, 'Year'),
    CustomerCode: text(el, 'CustomerCode'),
    CustomerName: text(el, 'CustomerName'),
    ElectricityMeterNumber: text(el, 'ElectricityMeterNumber'),
  }));
}

export async function getXML(
  billType: string, billId: string, departmentId: number,
  month: number, year: number, figureBookId: number,
): Promise<string> {
  const doc = await soapCall(
    `<GetXML xmlns="${NS}">` +
    `<vBillType>${esc(billType)}</vBillType><vBillId>${esc(billId)}</vBillId>` +
    `<vDepartmentId>${esc(departmentId)}</vDepartmentId>` +
    `<vMonth>${esc(month)}</vMonth><vYear>${esc(year)}</vYear>` +
    `<vFigureBookId>${esc(figureBookId)}</vFigureBookId></GetXML>`,
  );
  const result = findAll(doc, 'GetXMLResult')[0];
  return result ? (result.textContent || '').trim() : '';
}

export interface FetchProgress {
  phase: 'departments' | 'books' | 'bills' | 'xml' | 'done';
  done: number;
  total: number;
  label?: string;
}

/**
 * Lấy toàn bộ XML hóa đơn của một tháng/năm: duyệt mọi đơn vị → mọi sổ → mọi hóa đơn.
 * Trả về danh sách { fileName, xml } để parse như khi upload file.
 */
export async function fetchAllInvoiceXml(
  year: number,
  month: number,
  onProgress?: (p: FetchProgress) => void,
): Promise<{ items: { fileName: string; xml: string }[]; errors: string[] }> {
  const errors: string[] = [];
  const items: { fileName: string; xml: string }[] = [];

  onProgress?.({ phase: 'departments', done: 0, total: 1, label: 'Lấy danh sách đơn vị…' });
  const departments = await getDepartments();

  // Gom mọi (dept, book) trước để biết tổng số sổ
  const deptBooks: { dept: Department; book: FigureBook }[] = [];
  for (let i = 0; i < departments.length; i++) {
    const dept = departments[i];
    onProgress?.({ phase: 'books', done: i, total: departments.length, label: `Lấy sổ: ${dept.DepartmentName}` });
    try {
      const books = await getFigureBooks(dept.DepartmentId, year, month);
      books.forEach(book => deptBooks.push({ dept, book }));
    } catch (e: any) {
      errors.push(`Sổ [${dept.DepartmentName}]: ${e?.message || 'lỗi'}`);
    }
  }

  // Gom mọi hóa đơn
  const billJobs: { dept: Department; book: FigureBook; bill: Bill }[] = [];
  for (let i = 0; i < deptBooks.length; i++) {
    const { dept, book } = deptBooks[i];
    onProgress?.({ phase: 'bills', done: i, total: deptBooks.length, label: `Lấy hóa đơn: ${book.BookName || book.BookCode}` });
    try {
      const bills = await getBills(book.Term, month, year, book.FigureBookId);
      bills.forEach(bill => billJobs.push({ dept, book, bill }));
    } catch (e: any) {
      errors.push(`Hóa đơn [${book.BookCode}]: ${e?.message || 'lỗi'}`);
    }
  }

  // Lấy XML từng hóa đơn
  for (let i = 0; i < billJobs.length; i++) {
    const { dept, book, bill } = billJobs[i];
    onProgress?.({ phase: 'xml', done: i, total: billJobs.length, label: `XML: ${bill.CustomerName || bill.CustomerCode || bill.BillId}` });
    try {
      const xml = await getXML(bill.BillType, bill.BillId, dept.DepartmentId, month, year, book.FigureBookId);
      if (xml) {
        const name = `${bill.CustomerCode || 'HD'}_${bill.ElectricityMeterNumber || bill.BillId}_${month}-${year}.xml`;
        items.push({ fileName: name, xml });
      } else {
        errors.push(`XML trống: ${bill.CustomerName || bill.BillId}`);
      }
    } catch (e: any) {
      errors.push(`XML [${bill.CustomerName || bill.BillId}]: ${e?.message || 'lỗi'}`);
    }
  }

  onProgress?.({ phase: 'done', done: billJobs.length, total: billJobs.length });
  return { items, errors };
}
