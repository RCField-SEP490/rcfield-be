import { CLIENT_SCRIPT, STYLE, renderContestLab } from '../../dev-tools/contest-lab.template';

/**
 * Trang Contest Lab dựng bằng chuỗi, nên hai lỗi dưới đây không có gì bắt được
 * lúc chạy — trang vẫn trả về 200, chỉ là không làm gì cả:
 *
 *  1. Một dấu backtick lạc trong phần JS sẽ đóng sớm `String.raw`, làm hỏng cả
 *     tệp. TypeScript có báo, nhưng chỉ khi ai đó nhớ chạy nó.
 *  2. Nhúng <script> nội tuyến sẽ bị chính sách bảo mật nội dung của ứng dụng
 *     (`script-src 'self'`) chặn thẳng, và trang chết lặng.
 */
describe('trang Contest Lab', () => {
  it('không nhúng script nội tuyến — CSP của ứng dụng chỉ cho script cùng nguồn', () => {
    const html = renderContestLab();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).toContain('<script src="/dev-tools/contest-lab.js">');
    expect(html).toContain('href="/dev-tools/contest-lab.css"');
  });

  it('phần JS không chứa backtick — sẽ đóng sớm chuỗi String.raw bao quanh nó', () => {
    expect(CLIENT_SCRIPT).not.toContain('`');
  });

  it('trả về đủ ba phần và trang có gắn đủ các ô nhập', () => {
    const html = renderContestLab();
    for (const id of ['pEmail', 'pPwd', 'aEmail', 'aPwd', 'athPwd', 'cCafe', 'cTrack']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(STYLE.length).toBeGreaterThan(100);
    expect(CLIENT_SCRIPT).toContain('loadTrackTypesForCafe');
  });

  it('mọi ô mà phần JS đụng tới đều có mặt trong HTML', () => {
    // Sắp xếp lại bố cục là chuyển các khối HTML qua lại giữa hai cột, và rất
    // dễ đánh rơi một ô. Mất ô thì `$('id')` trả null, dòng đầu tiên chạm vào
    // nó ném lỗi, và trang chết lặng — không log, không lỗi mạng.
    const html = renderContestLab();
    const ids = Array.from(
      new Set([...CLIENT_SCRIPT.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((m) => m[1])),
    );
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
  });

  it('thẻ div đóng mở cân nhau', () => {
    // Lệch một thẻ là cả phần sau bị hút vào trong khối trước đó — bố cục vỡ
    // mà trình duyệt vẫn dựng ra được, nên nhìn qua không biết hỏng ở đâu.
    const html = renderContestLab();
    expect((html.match(/<div\b/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
  });

  it('khoá mở trang được gắn vào cả CSS lẫn JS', () => {
    // Trình duyệt tải hai tệp con bằng lời gọi riêng và không tự mang theo khoá
    // của trang cha. Quên truyền tiếp thì trang mở ra 200 nhưng trắng trơn —
    // không lỗi mạng, không log, chỉ là không có gì chạy.
    const html = renderContestLab('?key=abc123');
    expect(html).toContain('href="/dev-tools/contest-lab.css?key=abc123"');
    expect(html).toContain('<script src="/dev-tools/contest-lab.js?key=abc123">');
  });

  it('loại sân đọc theo chi nhánh, không đọc danh mục toàn hệ thống', () => {
    // Lấy từ /track-types thì loại sân chi nhánh đã tắt vẫn hiện ra, chọn vào
    // là tạo giải bị từ chối với CONTEST_TRACK_TYPE_UNAVAILABLE.
    expect(CLIENT_SCRIPT).toContain("'/cafes/' + cafeId + '/track-configs'");
    expect(CLIENT_SCRIPT).not.toContain("sel: 'cTrack', path: '/track-types'");
  });
});
