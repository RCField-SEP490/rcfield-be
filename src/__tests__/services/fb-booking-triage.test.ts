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
