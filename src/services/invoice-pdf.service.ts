import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';

interface VfsInstance {
  writeFileSync(name: string, content: Buffer): void;
}

interface PdfMakeInstance {
  virtualfs: VfsInstance;
  addFonts(fonts: Record<string, unknown>): void;
  createPdf(docDefinition: TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfMake = require('pdfmake') as PdfMakeInstance;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs = require('pdfmake/build/vfs_fonts') as Record<string, string>;

// Write fonts into the virtual filesystem so pdfmake can resolve them by path
const fontMap: Record<string, string> = {
  'Roboto-Regular.ttf': vfs['Roboto-Regular.ttf'],
  'Roboto-Medium.ttf': vfs['Roboto-Medium.ttf'],
  'Roboto-Italic.ttf': vfs['Roboto-Italic.ttf'],
  'Roboto-MediumItalic.ttf': vfs['Roboto-MediumItalic.ttf'],
};
for (const [name, b64] of Object.entries(fontMap)) {
  pdfMake.virtualfs.writeFileSync(name, Buffer.from(b64, 'base64'));
}

pdfMake.addFonts({
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
});

function vnd(amount: number): string {
  return amount.toLocaleString('vi-VN') + ' ₫';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

export interface InvoiceData {
  invoiceNumber: string; // short booking ref
  issuedAt: Date;
  txnRef: string;
  // Seller
  cafeName: string;
  cafeAddress: string;
  cafePhone: string | null;
  // Buyer
  customerName: string;
  customerEmail: string;
  // Booking info
  slotStart: Date;
  slotEnd: Date;
  playMode: string; // 'RENTAL' | 'BYOC'
  bookingMode: string; // human-readable label
  // Line items
  lineItems: Array<{
    description: string;
    qty: number;
    unitPrice: number;
    total: number;
  }>;
  totalAmount: number;
  depositAmount: number; // shown in orange note
}

export function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const slotLabel = `${formatDateTime(data.slotStart)} – ${data.slotEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}`;
  const modeLabel = data.playMode === 'RENTAL' ? 'Thuê xe tại quán' : 'Mang xe cá nhân (BYOC)';

  const itemRows: TableCell[][] = [
    [
      { text: 'STT', style: 'tableHeader', alignment: 'center' } as TableCell,
      { text: 'Dịch vụ', style: 'tableHeader' } as TableCell,
      { text: 'SL', style: 'tableHeader', alignment: 'center' } as TableCell,
      { text: 'Thành tiền', style: 'tableHeader', alignment: 'right' } as TableCell,
    ],
    ...data.lineItems.map((item, i): TableCell[] => [
      { text: String(i + 1), alignment: 'center', fontSize: 9 } as TableCell,
      { text: item.description, fontSize: 9 } as TableCell,
      { text: String(item.qty), alignment: 'center', fontSize: 9 } as TableCell,
      { text: vnd(item.total), alignment: 'right', fontSize: 9 } as TableCell,
    ]),
  ];

  const docDef: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1a1a1a' },
    styles: {
      header: { fontSize: 20, bold: true, color: '#111827' },
      subheader: { fontSize: 11, bold: true, color: '#374151' },
      label: { fontSize: 8, color: '#6b7280', bold: true },
      value: { fontSize: 9, color: '#111827' },
      tableHeader: { fontSize: 9, bold: true, fillColor: '#f3f4f6', color: '#374151' },
      totalLabel: { fontSize: 10, bold: true },
      totalValue: { fontSize: 11, bold: true, color: '#111827' },
      invoiceTitle: { fontSize: 13, bold: true, color: '#374151', alignment: 'right' },
      statusBadge: { fontSize: 9, bold: true, color: '#059669' },
    },
    content: [
      // ── Header bar ──────────────────────────────────────────────────────────
      {
        columns: [
          {
            stack: [
              { text: 'RCField', style: 'header' },
              {
                text: 'Hệ thống đặt sân xe RC',
                fontSize: 9,
                color: '#6b7280',
                margin: [0, 2, 0, 0],
              },
            ],
            width: '*',
          },
          {
            stack: [{ text: 'HÓA ĐƠN DỊCH VỤ', style: 'invoiceTitle' }],
            width: 'auto',
          },
        ],
        margin: [0, 0, 0, 8],
      },
      // thin separator
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: '#e5e7eb' },
        ],
        margin: [0, 0, 0, 12],
      },

      // ── Seller / Invoice meta side-by-side ──────────────────────────────────
      {
        columns: [
          {
            width: '55%',
            stack: [
              { text: 'BÊN BÁN', style: 'label', margin: [0, 0, 0, 3] },
              { text: data.cafeName, style: 'subheader', margin: [0, 0, 0, 2] },
              { text: data.cafeAddress, style: 'value', margin: [0, 0, 0, 2] },
              ...(data.cafePhone
                ? [{ text: `SĐT: ${data.cafePhone}`, style: 'value' as const }]
                : []),
            ],
          },
          {
            width: '45%',
            stack: [
              { text: 'THÔNG TIN HÓA ĐƠN', style: 'label', margin: [0, 0, 0, 3] },
              {
                columns: [
                  { text: 'Số hóa đơn:', style: 'label', width: 'auto' },
                  { text: `  #${data.invoiceNumber.toUpperCase()}`, style: 'value' },
                ],
                margin: [0, 0, 0, 2],
              },
              {
                columns: [
                  { text: 'Ngày phát hành:', style: 'label', width: 'auto' },
                  { text: `  ${formatDate(data.issuedAt)}`, style: 'value' },
                ],
                margin: [0, 0, 0, 2],
              },
              {
                columns: [
                  { text: 'Trạng thái:', style: 'label', width: 'auto' },
                  { text: '  ĐÃ THANH TOÁN', style: 'statusBadge' },
                ],
                margin: [0, 0, 0, 2],
              },
              {
                columns: [
                  { text: 'Mã GD:', style: 'label', width: 'auto' },
                  { text: `  ${data.txnRef}`, fontSize: 8, color: '#6b7280' },
                ],
              },
            ],
          },
        ],
        margin: [0, 0, 0, 12],
      },

      // ── Buyer ───────────────────────────────────────────────────────────────
      {
        fillColor: '#f9fafb',
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: 'BÊN MUA', style: 'label', margin: [0, 0, 0, 3] },
                  { text: data.customerName, style: 'subheader', margin: [0, 0, 0, 2] },
                  { text: data.customerEmail, style: 'value' },
                ],
                margin: [8, 8, 8, 8],
                border: [false, false, false, false],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
        },
        margin: [0, 0, 0, 12],
      },

      // ── Booking info ────────────────────────────────────────────────────────
      { text: 'THÔNG TIN ĐẶT SÂN', style: 'label', margin: [0, 0, 0, 4] },
      {
        columns: [
          {
            width: '50%',
            stack: [
              {
                columns: [
                  { text: 'Thời gian:', style: 'label', width: 70 },
                  { text: slotLabel, style: 'value' },
                ],
                margin: [0, 0, 0, 2],
              },
            ],
          },
          {
            width: '50%',
            stack: [
              {
                columns: [
                  { text: 'Chế độ chơi:', style: 'label', width: 70 },
                  { text: modeLabel, style: 'value' },
                ],
                margin: [0, 0, 0, 2],
              },
            ],
          },
        ],
        margin: [0, 0, 0, 12],
      },

      // ── Line items table ────────────────────────────────────────────────────
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 30, 80],
          body: itemRows,
        },
        layout: {
          hLineColor: () => '#e5e7eb',
          vLineColor: () => '#e5e7eb',
          hLineWidth: (i: number) => (i === 0 || i === 1 ? 1 : 0.5),
          vLineWidth: () => 0.5,
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 0, 0, 0],
      },

      // ── Total row ───────────────────────────────────────────────────────────
      {
        table: {
          widths: ['*', 80],
          body: [
            [
              {
                text: 'Tổng cộng',
                style: 'totalLabel',
                alignment: 'right',
                border: [false, false, false, false],
              },
              {
                text: vnd(data.totalAmount),
                style: 'totalValue',
                alignment: 'right',
                fillColor: '#f3f4f6',
                border: [false, false, false, false],
              },
            ],
          ],
        },
        layout: {
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 12],
      },

      // ── Deposit note (only if deposit > 0) ─────────────────────────────────
      ...(data.depositAmount > 0
        ? [
            {
              table: {
                widths: ['*'],
                body: [
                  [
                    {
                      stack: [
                        {
                          text: `⚠  Tiền cọc ${vnd(data.depositAmount)} sẽ được hoàn trả sau khi check-out thành công.`,
                          fontSize: 9,
                          color: '#92400e',
                        },
                      ],
                      margin: [8, 6, 8, 6],
                      border: [false, false, false, false],
                    },
                  ],
                ],
              },
              layout: {
                hLineWidth: () => 0,
                vLineWidth: () => 0,
                fillColor: () => '#fffbeb',
              },
              margin: [0, 0, 0, 16],
            } as Content,
          ]
        : [{ text: ' ', margin: [0, 0, 0, 16] } as Content]),

      // ── Footer ──────────────────────────────────────────────────────────────
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' },
        ],
        margin: [0, 0, 0, 8],
      },
      {
        text: 'Cảm ơn bạn đã chọn RCField. Mọi thắc mắc vui lòng liên hệ chi nhánh trực tiếp.',
        fontSize: 8,
        color: '#9ca3af',
        alignment: 'center',
      },
    ],
  };

  return pdfMake.createPdf(docDef).getBuffer();
}
