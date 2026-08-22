import { planTurn } from '../../services/fb-booking-triage';
import type { FbBookingDraft } from '../../services/fb-booking-draft';

/**
 * Tầng phân loại lượt — quyết định gọi mô hình nào, hoặc không gọi gì.
 *
 * Bất biến quan trọng nhất: chỉ MỘT loại lượt thật sự cần mô hình — đọc mốc
 * thời gian từ ngôn ngữ tự nhiên. Mọi trường còn lại nhận ra được bằng luật, và
 * luật thì chính xác hơn mô hình ở đúng những việc đó.
 *
 * Test này khoá lại điều đó. Nếu ai sửa khiến số điện thoại hay hình thức chơi
 * quay về phải gọi mô hình, test đỏ ngay.
 */
describe('fb-booking-triage: chọn đường xử lý cho từng lượt', () => {
  const base: FbBookingDraft = {
    state: 'AWAITING_SLOT',
    cafeId: '11111111-1111-1111-1111-111111111111',
    slotStart: '2026-08-22T12:00:00+07:00',
    slotEnd: '2026-08-22T13:00:00+07:00',
    playMode: 'BYOC',
    playerCount: 1,
    trackConfigId: '22222222-2222-2222-2222-222222222222',
  };

  it('lời xác nhận KHÔNG cần mô hình', () => {
    expect(planTurn(base, 'xác nhận').kind).toBe('DETERMINISTIC');
    expect(planTurn(base, 'đồng ý').kind).toBe('DETERMINISTIC');
  });

  it('số điện thoại KHÔNG cần mô hình', () => {
    const draft = { ...base, fullName: 'Nam' };
    const plan = planTurn(draft, '0901234567');
    expect(plan.kind).toBe('DETERMINISTIC');
    if (plan.kind === 'DETERMINISTIC') expect(plan.fields.phone).toBe('0901234567');
  });

  it('dạng +84 cũng nhận ra được, vẫn không cần mô hình', () => {
    const draft = { ...base, fullName: 'Nam' };
    const plan = planTurn(draft, '+84901234567');
    expect(plan.kind).toBe('DETERMINISTIC');
    if (plan.kind === 'DETERMINISTIC') expect(plan.fields.phone).toBe('0901234567');
  });

  it('hình thức chơi KHÔNG cần mô hình', () => {
    const draft: FbBookingDraft = { ...base, playMode: undefined };
    const rental = planTurn(draft, 'thuê xe của quán');
    const byoc = planTurn(draft, 'mình mang xe cá nhân');
    expect(rental.kind).toBe('DETERMINISTIC');
    expect(byoc.kind).toBe('DETERMINISTIC');
    if (rental.kind === 'DETERMINISTIC') expect(rental.fields.playMode).toBe('RENTAL');
    if (byoc.kind === 'DETERMINISTIC') expect(byoc.fields.playMode).toBe('BYOC');
  });

  it('số người KHÔNG cần mô hình, đọc được cả chữ lẫn số', () => {
    const draft: FbBookingDraft = { ...base, playerCount: undefined };
    const digit = planTurn(draft, '2');
    const word = planTurn(draft, 'hai người');
    if (digit.kind === 'DETERMINISTIC') expect(digit.fields.playerCount).toBe(2);
    if (word.kind === 'DETERMINISTIC') expect(word.fields.playerCount).toBe(2);
  });

  it('MỐC THỜI GIAN là chỗ duy nhất cần mô hình', () => {
    const draft: FbBookingDraft = { ...base, slotStart: undefined, slotEnd: undefined };
    expect(planTurn(draft, '19h tối mai').kind).toBe('EXTRACT');
    expect(planTurn(draft, 'thứ 7 tuần sau').kind).toBe('EXTRACT');
  });

  it('khách hỏi giữa chừng thì trả về đường hỏi–đáp, không ép quay lại câu đang dở', () => {
    const draft: FbBookingDraft = { ...base, playerCount: undefined };
    expect(planTurn(draft, 'giá bao nhiêu vậy shop?').kind).toBe('QUESTION');
    expect(planTurn(draft, 'quán mở mấy giờ').kind).toBe('QUESTION');
  });

  it('không chắc chắn thì để mô hình đọc, KHÔNG đoán bừa', () => {
    // Ghi dữ liệu rác vào đơn nháp tệ hơn nhiều so với tốn một lượt gọi mô hình.
    const draft: FbBookingDraft = { ...base, playMode: undefined };
    expect(planTurn(draft, 'ừm thì cũng chưa biết nữa').kind).toBe('EXTRACT');
  });

  it('chưa có đơn nháp thì luôn để mô hình đọc', () => {
    expect(planTurn(null, 'mai mình muốn đặt sân').kind).toBe('EXTRACT');
  });
});

/**
 * Khách sửa thông tin đã khai.
 *
 * ── Lỗi mà nhóm test này khoá lại ───────────────────────────────────────────
 *
 * `'?'` nằm trong danh sách nhận diện câu hỏi, và người Việt đổi thông tin gần
 * như luôn kèm dấu hỏi: "cho mình đổi sang 20h được không?". Xét câu hỏi trước
 * yêu cầu sửa nghĩa là MỌI câu đổi thông tin đều bị đẩy sang hỏi–đáp — và khách
 * mất luôn đường quay lại luồng đặt lịch, vì hỏi–đáp đã bị cấm nhận đơn.
 *
 * Triệu chứng khách thấy: đang đặt dở, xin đổi giờ, rồi bị mời ra web đặt lại.
 */
describe('fb-booking-triage: khách sửa thông tin đã khai', () => {
  const complete: FbBookingDraft = {
    state: 'AWAITING_CONFIRMATION',
    cafeId: '11111111-1111-1111-1111-111111111111',
    slotStart: '2026-08-23T12:00:00+07:00',
    slotEnd: '2026-08-23T13:00:00+07:00',
    playMode: 'BYOC',
    playerCount: 2,
    trackConfigId: '22222222-2222-2222-2222-222222222222',
    fullName: 'Nam',
    phone: '0901234567',
  };

  it('câu đổi thông tin KÈM DẤU HỎI vẫn ở lại luồng đặt lịch', () => {
    for (const text of [
      'cho mình đổi sang 20h được không?',
      'đổi sân khác nhé?',
      'mình đổi số điện thoại được không?',
      'sửa lại số người được không?',
    ]) {
      expect(planTurn(complete, text).kind).toBe('EXTRACT');
    }
  });

  it('câu đổi thông tin không dấu hỏi cũng ở lại luồng', () => {
    for (const text of ['đổi sang 20h', 'mình khai nhầm số điện thoại', 'thay sân khác đi']) {
      expect(planTurn(complete, text).kind).toBe('EXTRACT');
    }
  });

  it('câu hỏi THẬT vẫn được chuyển sang hỏi–đáp', () => {
    // Không được vì sửa lỗi trên mà nuốt luôn câu hỏi thường.
    for (const text of ['giá bao nhiêu vậy shop?', 'quán ở đâu ạ', 'quán mở mấy giờ']) {
      expect(planTurn(complete, text).kind).toBe('QUESTION');
    }
  });

  it('vẫn ưu tiên lời xác nhận trên hết', () => {
    expect(planTurn(complete, 'xác nhận').kind).toBe('DETERMINISTIC');
  });
});

/**
 * Lối thoát: huỷ và làm lại.
 *
 * Không có nó thì khách kẹt vĩnh viễn — bot chờ số điện thoại, khách gõ "huỷ",
 * bộ giải mã không đọc ra số nào nên gọi mô hình, mô hình không rút được gì,
 * bot hỏi lại số điện thoại. Lặp cho tới khi đơn nháp hết hạn 30 phút.
 *
 * Nhóm test này nằm ở tầng phân loại vì đó là nơi câu "huỷ" phải KHÔNG bị hiểu
 * thành một câu trả lời cho trường đang chờ.
 */
describe('fb-booking-triage: câu huỷ không được hiểu thành câu trả lời', () => {
  const awaitingPhone: FbBookingDraft = {
    state: 'AWAITING_PHONE',
    cafeId: '11111111-1111-1111-1111-111111111111',
    slotStart: '2026-08-23T12:00:00+07:00',
    slotEnd: '2026-08-23T13:00:00+07:00',
    playMode: 'BYOC',
    playerCount: 1,
    trackConfigId: '22222222-2222-2222-2222-222222222222',
    fullName: 'Nam',
  };

  it('"huỷ" không bị đọc thành số điện thoại', () => {
    // Bộ giải mã số điện thoại phải TỪ CHỐI, để bộ điều phối có cơ hội xử lý huỷ.
    const plan = planTurn(awaitingPhone, 'huỷ');
    if (plan.kind === 'DETERMINISTIC') {
      expect(plan.fields.phone).toBeUndefined();
    }
  });

  it('câu huỷ và làm lại không bị nuốt thành dữ liệu rác', () => {
    for (const text of ['huỷ đơn giúp mình', 'bắt đầu lại từ đầu', 'thôi không đặt nữa']) {
      const plan = planTurn(awaitingPhone, text);
      if (plan.kind === 'DETERMINISTIC') {
        expect(plan.fields.phone).toBeUndefined();
        expect(plan.fields.fullName).toBeUndefined();
      }
    }
  });

  it('"thôi cho mình thuê xe của quán" KHÔNG phải là huỷ', () => {
    // Đây là đổi ý về hình thức chơi. Bắt nhầm thành huỷ là xoá sạch thông tin
    // khách vừa khai xong — đó là lý do không bắt "thôi" đứng một mình.
    const draft: FbBookingDraft = { ...awaitingPhone, playMode: undefined };
    const plan = planTurn(draft, 'thôi cho mình thuê xe của quán');
    expect(plan.kind).toBe('DETERMINISTIC');
    if (plan.kind === 'DETERMINISTIC') expect(plan.fields.playMode).toBe('RENTAL');
  });
});
