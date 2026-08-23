import type { ExtractedFields } from './fb-booking-extractor';
import {
  firstMissingField,
  matchesConfirmationKeyword,
  type FbBookingDraft,
} from './fb-booking-draft';
import { normalizePhone } from './fb-soft-user';

/**
 * Phân loại một lượt trò chuyện — NƠI DUY NHẤT quyết định lượt đó đi đâu.
 *
 * ── Vì sao phải gom về một chỗ ──────────────────────────────────────────────
 *
 * Quyết định định tuyến từng nằm rải ở bốn nơi: bộ điều khiển webhook, chín
 * nhánh thoát sớm ở đầu bộ điều phối, hàm này, và một chốt nữa ở giữa luồng.
 * Mỗi lần thêm một nhánh là một lần phải nhớ hết chín nhánh kia — và thực tế đã
 * hỏng đúng như vậy nhiều lần:
 *
 *   • chốt "không mang thông tin mới" suýt nuốt luôn lượt xác nhận, khiến đơn
 *     không bao giờ được tạo;
 *   • "đổi thông tin" bị "câu hỏi" chặn trước, vì câu đổi thường kèm dấu hỏi;
 *   • "mô hình hỏng" bị hiểu thành "khách không muốn đặt".
 *
 * Không cái nào là lỗi khó. Chúng khó THẤY, vì thứ tự ưu tiên không đọc được ở
 * một chỗ nào cả. Bảng ở `classifyTurn` đọc từ trên xuống là ra toàn bộ luật.
 *
 * ── Hai pha ─────────────────────────────────────────────────────────────────
 *
 * Tệp này là pha MỘT: quyết định bằng luật, không gọi mô hình. Chỉ khi nó trả
 * `NEEDS_MODEL` thì bộ điều phối mới gọi mô hình — và nếu mô hình đọc xong mà
 * không rút được gì, lượt đó được xếp lại thành hỏi–đáp. Đó là đường leo thang
 * DUY NHẤT giữa hai pha.
 */

export type TurnIntent =
  /** Số điện thoại trùng tài khoản thật — luồng đặt lịch đóng cho phiên này. */
  | { kind: 'BLOCKED' }
  /** Khách muốn dừng hẳn hoặc làm lại từ đầu. */
  | { kind: 'CANCEL' }
  /** Đơn trước đã phát mã QR, khách muốn mở đơn mới. */
  | { kind: 'NEW_BOOKING' }
  /** Gõ xác nhận nhưng đơn nháp đã hết hạn. */
  | { kind: 'EXPIRED_CONFIRM' }
  /** Không có đơn nháp và không có dấu hiệu muốn đặt. */
  | { kind: 'NOT_BOOKING' }
  /** Khách xác nhận tạo đơn. */
  | { kind: 'CONFIRM' }
  /** Đọc được bằng luật — dùng luôn, không gọi mô hình. */
  | { kind: 'PROVIDE_INFO'; fields: ExtractedFields }
  /** Cần mô hình đọc ngôn ngữ tự nhiên. */
  | { kind: 'NEEDS_MODEL' }
  /** Khách hỏi chuyện khác — để đường hỏi–đáp trả lời. */
  | { kind: 'ASK_QUESTION' };

// ── Bộ nhận dạng bằng luật ───────────────────────────────────────────────────

/**
 * Dấu hiệu muốn đặt lịch. Cố ý RỘNG TAY: lọt một câu vào luồng rồi bị mô hình
 * gạt ra chỉ tốn một lượt gọi, còn chặn nhầm một khách muốn đặt là mất khách.
 */
const BOOKING_INTENT_HINTS = [
  'đặt',
  'dat san',
  'book',
  'giữ chỗ',
  'giu cho',
  'thuê xe',
  'thue xe',
  'chơi',
  'choi',
  'slot',
  'lịch',
  'lich',
  'mai',
  'hôm nay',
  'hom nay',
  'tối',
  'toi ',
  'giờ',
  'gio ',
  'thứ',
  'thu ',
  'cuối tuần',
  'cuoi tuan',
  'còn chỗ',
  'con cho',
];

/**
 * Dừng hẳn hoặc làm lại.
 *
 * Cố ý KHÔNG bắt "thôi" hay "dừng" đứng một mình: "thôi cho mình thuê xe của
 * quán" là đổi ý về hình thức chơi, bắt nhầm thành huỷ là xoá sạch thông tin
 * khách vừa khai.
 */
const CANCEL_PHRASES = [
  'huỷ',
  'hủy',
  'bắt đầu lại',
  'bat dau lai',
  'đặt lại từ đầu',
  'dat lai tu dau',
  'làm lại từ đầu',
  'lam lai tu dau',
  'không đặt nữa',
  'khong dat nua',
  'thôi không đặt',
  'thoi khong dat',
  'dừng lại',
  'dung lai',
];

/**
 * Sửa thông tin đã khai. Xét TRƯỚC câu hỏi, vì câu sửa gần như luôn kèm dấu
 * hỏi — "cho mình đổi sang 20h được không?".
 */
const MODIFICATION_HINTS = [
  'đổi',
  'doi ',
  'sửa',
  'sua ',
  'thay',
  'nhầm',
  'nham',
  'không phải',
  'khong phai',
  'sai rồi',
  'sai roi',
  'lại',
  'lai ',
];

/**
 * Khách đang HỎI chứ không trả lời.
 *
 * Có cả "tư vấn", "gợi ý", "nên chọn" — đây là những câu khách hỏi giữa chừng
 * mà trước đây không khớp từ khoá nào, nên bị đem đi phân tích như một câu trả
 * lời, phân tích hụt, rồi bot hỏi lại đúng câu cũ.
 */
const QUESTION_HINTS = [
  '?',
  'bao nhiêu',
  'bao nhieu',
  'mấy giờ',
  'may gio',
  'thế nào',
  'the nao',
  'có không',
  'khác không',
  'là gì',
  'la gi',
  'ở đâu',
  'o dau',
  'tư vấn',
  'tu van',
  'gợi ý',
  'goi y',
  'nên chọn',
  'nen chon',
];

function contains(text: string, hints: string[]): boolean {
  const normalized = text.trim().toLowerCase();
  return hints.some((hint) => normalized.includes(hint));
}

export function looksLikeBookingIntent(text: string): boolean {
  return contains(text, BOOKING_INTENT_HINTS);
}

/** "thuê xe của quán" / "mang xe cá nhân" — hai lựa chọn đóng. */
function parsePlayMode(text: string): 'RENTAL' | 'BYOC' | null {
  const t = text.trim().toLowerCase();
  if (
    /(thuê|thue|mượn|muon)\s*(xe)?/.test(t) &&
    !/mang|tự|tu\s|cá nhân|ca nhan|riêng|rieng/.test(t)
  ) {
    return 'RENTAL';
  }
  if (/(mang|tự|tu\s|cá nhân|ca nhan|riêng|rieng|byoc)/.test(t)) return 'BYOC';
  return null;
}

/** Số người chơi — chỉ nhận khi câu có đúng một con số hợp lý. */
function parsePlayerCount(text: string): number | null {
  const t = text.trim().toLowerCase();
  const words: Record<string, number> = {
    một: 1,
    mot: 1,
    hai: 2,
    ba: 3,
    bốn: 4,
    bon: 4,
    năm: 5,
    nam: 5,
    sáu: 6,
    sau: 6,
  };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return value;
  }
  const digits = t.match(/\b(\d{1,2})\b/g);
  if (digits?.length === 1) {
    const value = Number(digits[0]);
    if (value >= 1 && value <= 20) return value;
  }
  return null;
}

/** Tên người: câu ngắn, không chữ số, không phải câu hỏi. */
function looksLikeName(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 40 && !/\d/.test(t) && !contains(t, QUESTION_HINTS);
}

// ── Bảng quyết định ──────────────────────────────────────────────────────────

/**
 * Đọc từ trên xuống là ra toàn bộ luật định tuyến.
 *
 * Thứ tự ở đây LÀ thứ tự ưu tiên — đổi chỗ hai nhánh là đổi hành vi sản phẩm.
 */
export function classifyTurn(draft: FbBookingDraft | null, text: string): TurnIntent {
  // 1. Đã chặn vì trùng tài khoản thật — không mở lại trong phiên này.
  if (draft?.state === 'BLOCKED_REAL_ACCOUNT') return { kind: 'BLOCKED' };

  // 2. Lối thoát. Đứng trước mọi thứ, vì đây là cách duy nhất để khách rời khỏi
  //    một câu hỏi họ không muốn trả lời.
  if (draft && contains(text, CANCEL_PHRASES)) return { kind: 'CANCEL' };

  // 3. Đơn trước đã phát mã QR mà khách lại tỏ ý đặt tiếp → mở đơn mới. Thiếu
  //    nhánh này thì đơn nháp cũ nằm lì 30 phút và mọi tin nhắn đều rơi vào chỗ
  //    tóm tắt lại đơn cũ.
  if (
    draft?.state === 'AWAITING_PAYMENT' &&
    looksLikeBookingIntent(text) &&
    !matchesConfirmationKeyword(text)
  ) {
    return { kind: 'NEW_BOOKING' };
  }

  // 4. Xác nhận mà không còn đơn nháp — nói thẳng là hết hạn, đừng để rơi xuống
  //    hỏi–đáp rồi mô hình đọc lại bản tóm tắt cũ trong lịch sử và diễn tiếp.
  if (!draft && matchesConfirmationKeyword(text)) return { kind: 'EXPIRED_CONFIRM' };

  // 5–6. Chưa có đơn nháp: phải thấy dấu hiệu đặt lịch mới xét tiếp, và khi đó
  //      luôn cần mô hình vì chưa biết đang chờ trường nào.
  if (!draft) {
    return looksLikeBookingIntent(text) ? { kind: 'NEEDS_MODEL' } : { kind: 'NOT_BOOKING' };
  }

  // 7. Xác nhận tạo đơn.
  if (matchesConfirmationKeyword(text)) return { kind: 'CONFIRM' };

  // 8. Sửa thông tin — TRƯỚC câu hỏi, vì câu sửa thường mang dấu hỏi.
  if (contains(text, MODIFICATION_HINTS)) return { kind: 'NEEDS_MODEL' };

  // 9. Hỏi chuyện khác.
  if (contains(text, QUESTION_HINTS)) return { kind: 'ASK_QUESTION' };

  // 10. Câu trả lời cho trường đang chờ. Đọc được bằng luật thì không gọi mô
  //     hình; không chắc thì để mô hình đọc — ghi dữ liệu rác vào đơn nháp tệ
  //     hơn nhiều so với tốn một lượt gọi.
  switch (firstMissingField(draft)) {
    case 'phone': {
      const phone = normalizePhone(text);
      return phone ? { kind: 'PROVIDE_INFO', fields: { phone } } : { kind: 'NEEDS_MODEL' };
    }
    case 'playMode': {
      const playMode = parsePlayMode(text);
      return playMode ? { kind: 'PROVIDE_INFO', fields: { playMode } } : { kind: 'NEEDS_MODEL' };
    }
    case 'playerCount': {
      const playerCount = parsePlayerCount(text);
      return playerCount
        ? { kind: 'PROVIDE_INFO', fields: { playerCount } }
        : { kind: 'NEEDS_MODEL' };
    }
    case 'fullName':
      return looksLikeName(text)
        ? { kind: 'PROVIDE_INFO', fields: { fullName: text.trim() } }
        : { kind: 'NEEDS_MODEL' };
    case 'trackConfigId':
      // Bộ điều phối đối chiếu với danh sách sân thật; khớp hụt thì nó hỏi lại.
      return { kind: 'PROVIDE_INFO', fields: { trackName: text.trim() } };
    case 'vehicleIds':
      return { kind: 'PROVIDE_INFO', fields: { vehicleNames: [text.trim()] } };
    case 'slotStart':
      // Chỗ DUY NHẤT thật sự cần mô hình: đọc ngôn ngữ tự nhiên ra mốc thời gian.
      return { kind: 'NEEDS_MODEL' };
    default:
      return { kind: 'NEEDS_MODEL' };
  }
}
