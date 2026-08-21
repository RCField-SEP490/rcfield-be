import type { ExtractedFields } from './fb-booking-extractor';
import {
  firstMissingField,
  matchesConfirmationKeyword,
  type FbBookingDraft,
} from './fb-booking-draft';
import { normalizePhone } from './fb-soft-user';

/**
 * Phân loại một lượt trước khi quyết định gọi mô hình nào — hoặc không gọi gì.
 *
 * ── Vì sao tầng này tồn tại ─────────────────────────────────────────────────
 *
 * Trước đây mọi lượt thuộc luồng đặt lịch đều gọi mô hình chính để trích xuất,
 * kể cả khi câu trả lời của khách là "0901234567" hay "thuê xe". Đọc một dãy số
 * thành số điện thoại không cần tới mô hình ngôn ngữ; biểu thức chính quy làm
 * việc đó chính xác hơn, nhanh hơn, và miễn phí.
 *
 * ── Nguyên tắc quyết định ───────────────────────────────────────────────────
 *
 * Backend LUÔN biết nó đang chờ trường nào — `firstMissingField` nói ra điều đó
 * một cách xác định. Nên câu hỏi "lượt này cần gì" không phải chuyện phải đoán:
 *
 *   • Trường có dạng nhận ra được bằng luật (số điện thoại, hình thức chơi,
 *     số người, lời xác nhận) → giải mã tại chỗ, KHÔNG gọi mô hình.
 *   • Trường cần hiểu ngôn ngữ tự nhiên — mà thực chất chỉ có MỘT: mốc thời
 *     gian ("19h tối mai", "thứ 7 tuần sau") → gọi mô hình CHÍNH. Đây là chỗ
 *     đọc sai một ngày là giữ chỗ nhầm hôm.
 *   • Khách hỏi một câu giữa chừng ("giá bao nhiêu", "có xe nào rẻ hơn không")
 *     → trả về đường hỏi–đáp sẵn có, nơi đã có đủ công cụ tra cứu và cơ chế
 *     chọn mô hình theo độ chắc chắn.
 *
 * Kết quả: phần lớn lượt trong một cuộc đặt lịch không tốn lượt gọi mô hình nào.
 */

export type TurnPlan =
  /** Giải mã được bằng luật — dùng luôn `fields`, không gọi mô hình. */
  | { kind: 'DETERMINISTIC'; fields: ExtractedFields }
  /** Cần mô hình chính đọc ngôn ngữ tự nhiên. */
  | { kind: 'EXTRACT' }
  /** Không phải câu trả lời cho việc đặt lịch — trả về đường hỏi–đáp. */
  | { kind: 'QUESTION' };

/** Dấu hiệu khách đang HỎI chứ không trả lời. */
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
];

function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return QUESTION_HINTS.some((hint) => normalized.includes(hint));
}

/** "thuê xe của quán" / "mang xe cá nhân" — hai lựa chọn đóng, nhận ra bằng từ khoá. */
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

/** Số người chơi — chỉ nhận khi câu ngắn và có đúng một con số hợp lý. */
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

/** Tên người: câu ngắn, không chứa chữ số, không phải câu hỏi. */
function looksLikeName(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 40 && !/\d/.test(t) && !looksLikeQuestion(t);
}

/**
 * Quyết định lượt này xử lý thế nào.
 *
 * Không bao giờ trả `DETERMINISTIC` khi chưa chắc chắn — sai ở đây là ghi dữ
 * liệu rác vào đơn nháp mà không ai kiểm lại. Nghi ngờ thì để mô hình đọc.
 */
export function planTurn(draft: FbBookingDraft | null, text: string): TurnPlan {
  // Lời xác nhận nhận ra bằng tập từ khoá đóng, không cần mô hình.
  if (matchesConfirmationKeyword(text)) return { kind: 'DETERMINISTIC', fields: {} };

  // Khách hỏi giữa chừng thì phải được trả lời bằng dữ liệu thật, không phải bị
  // ép quay lại câu hỏi đang dở.
  if (draft && looksLikeQuestion(text)) return { kind: 'QUESTION' };

  if (!draft) return { kind: 'EXTRACT' };

  switch (firstMissingField(draft)) {
    case 'phone': {
      const phone = normalizePhone(text);
      return phone ? { kind: 'DETERMINISTIC', fields: { phone } } : { kind: 'EXTRACT' };
    }
    case 'playMode': {
      const playMode = parsePlayMode(text);
      return playMode ? { kind: 'DETERMINISTIC', fields: { playMode } } : { kind: 'EXTRACT' };
    }
    case 'playerCount': {
      const playerCount = parsePlayerCount(text);
      return playerCount ? { kind: 'DETERMINISTIC', fields: { playerCount } } : { kind: 'EXTRACT' };
    }
    case 'fullName':
      return looksLikeName(text)
        ? { kind: 'DETERMINISTIC', fields: { fullName: text.trim() } }
        : { kind: 'EXTRACT' };
    case 'trackConfigId':
      // Tên sân do khách gõ được đối chiếu với danh sách thật ở bộ điều phối;
      // khớp được thì không cần mô hình, không khớp thì bộ điều phối hỏi lại.
      return { kind: 'DETERMINISTIC', fields: { trackName: text.trim() } };
    case 'vehicleIds':
      return { kind: 'DETERMINISTIC', fields: { vehicleNames: [text.trim()] } };
    case 'slotStart':
      // Chỗ DUY NHẤT thật sự cần mô hình: đọc ngôn ngữ tự nhiên ra mốc thời gian.
      return { kind: 'EXTRACT' };
    default:
      return { kind: 'EXTRACT' };
  }
}
