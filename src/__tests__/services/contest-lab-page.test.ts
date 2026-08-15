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

  it('loại sân đọc theo chi nhánh, không đọc danh mục toàn hệ thống', () => {
    // Lấy từ /track-types thì loại sân chi nhánh đã tắt vẫn hiện ra, chọn vào
    // là tạo giải bị từ chối với CONTEST_TRACK_TYPE_UNAVAILABLE.
    expect(CLIENT_SCRIPT).toContain("'/cafes/' + cafeId + '/track-configs'");
    expect(CLIENT_SCRIPT).not.toContain("sel: 'cTrack', path: '/track-types'");
  });
});
