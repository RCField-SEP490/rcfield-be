import { AppDataSource } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Cafe } from '../models/cafe.entity';
import { AppError, BookingMode, BookingSource } from '../types';
import { createBooking } from './booking.service';
import {
  acknowledgePriceChange,
  isConfirmationTurn,
  matchesConfirmationKeyword,
  loadDraft,
  saveDraft,
  type FbBookingDraft,
} from './fb-booking-draft';
import { extractBookingFields } from './fb-booking-extractor';
import { normalizePhone, resolveFacebookSoftUser } from './fb-soft-user';
import { getVerifiedBankSettings } from './payment-method-resolver';
import { createCheckoutUrl } from './payment.service';
import { uploadQrForMessenger } from './fb-qr-image';

/**
 * Bộ điều phối luồng đặt lịch qua Facebook Messenger.
 *
 * ── Ai cầm quyền tạo đơn ────────────────────────────────────────────────────
 *
 * Backend, không phải mô hình ngôn ngữ. Mô hình chỉ được cấp các công cụ CHỈ ĐỌC
 * (tra chỗ trống, liệt kê xe, báo giá) và một bộ trích xuất thông tin. Hàm tạo
 * đơn nằm ở đây, ngoài tầm với của nó.
 *
 * Đây là ràng buộc CẤU TRÚC chứ không phải lời dặn trong prompt: không có cách
 * nào để mô hình gọi tới `createBooking` kể cả khi nó muốn.
 *
 * ── Quan hệ với luồng hỏi–đáp sẵn có ────────────────────────────────────────
 *
 * `tryHandleBookingTurn` trả `null` nghĩa là "lượt này không thuộc luồng đặt
 * lịch" — bộ điều khiển webhook cứ chạy tiếp đường hỏi–đáp bình thường. Nhờ vậy
 * việc thêm tính năng này không đụng gì tới hành vi trả lời câu hỏi đã có.
 */

/** Kết quả một lượt thuộc luồng đặt lịch. */
export interface BookingTurnResult {
  /** Chữ để gửi cho khách. */
  text: string;
  /** URL trang thanh toán — có thì gửi kèm nút bấm. */
  paymentUrl?: string;
  /** URL công khai của ảnh QR — có thì gửi thêm một tin ảnh. */
  qrImageUrl?: string;
}

export interface BookingTurnContext {
  cafeId: string;
  pageId: string;
  psid: string;
  text: string;
}

/** Số slot mặc định khi khách không nói rõ chơi bao lâu. */
const DEFAULT_SLOT_COUNT = 1;

function loginUrl(): string {
  return new URL('/login', env.frontendUrl).toString();
}

/**
 * Chi nhánh đã sẵn sàng nhận đặt lịch qua Messenger chưa.
 *
 * Kiểm NGAY khi khách bộc lộ ý định, không phải ở bước cuối.
 * `buildBankTransferCheckout` ném `PAYMENT_METHOD_UNAVAILABLE` khi chi nhánh
 * chưa cấu hình tài khoản nhận tiền — mà lúc đó khách đã khai xong tên, số điện
 * thoại, khung giờ và chọn xe. Bắt họ đi hết quãng đường đó rồi mới báo là hỏng
 * thì tệ hơn nhiều so với từ chối ngay từ câu đầu.
 */
async function cafeCanAcceptBookings(cafeId: string): Promise<boolean> {
  const settings = await getVerifiedBankSettings(cafeId);
  return Boolean(settings?.bankBin && settings.accountNumber && settings.accountName);
}

/** Ghi các trường vừa rút được vào đơn nháp, sau khi backend tự kiểm lại từng cái. */
async function mergeExtracted(
  draft: FbBookingDraft,
  extracted: Awaited<ReturnType<typeof extractBookingFields>>,
  cafe: Cafe,
): Promise<FbBookingDraft> {
  const next: FbBookingDraft = { ...draft };

  if (extracted.fullName?.trim()) next.fullName = extracted.fullName.trim();

  // Số điện thoại: chỉ nhận khi CHUẨN HOÁ ĐƯỢC. Mô hình hoàn toàn có thể trả về
  // một chuỗi trông giống số điện thoại nhưng không phải.
  if (extracted.phone) {
    const normalized = normalizePhone(extracted.phone);
    if (normalized) next.phone = normalized;
  }

  if (extracted.email?.includes('@')) next.email = extracted.email.trim();
  if (extracted.declinedEmail) next.email = undefined;

  if (extracted.playerCount && extracted.playerCount > 0 && extracted.playerCount <= 20) {
    next.playerCount = Math.floor(extracted.playerCount);
  }

  if (extracted.playMode === 'RENTAL' || extracted.playMode === 'BYOC') {
    next.playMode = extracted.playMode;
  }

  // Khung giờ: bỏ nếu nằm trong quá khứ. Mô hình suy "tối nay" ra một mốc đã
  // trôi qua là chuyện bình thường khi khách nhắn lúc nửa đêm.
  if (extracted.slotStart) {
    const start = new Date(extracted.slotStart);
    if (!Number.isNaN(start.getTime()) && start.getTime() > Date.now()) {
      const slotCount =
        extracted.slotCount && extracted.slotCount > 0 ? extracted.slotCount : DEFAULT_SLOT_COUNT;
      next.slotStart = start.toISOString();
      next.slotEnd = new Date(
        start.getTime() + slotCount * cafe.slotDurationMinutes * 60_000,
      ).toISOString();
    }
  }

  return next;
}

/** Bước tiếp theo cần hỏi gì. Trả `null` nghĩa là đã đủ trường. */
function nextQuestion(
  draft: FbBookingDraft,
): { state: FbBookingDraft['state']; text: string } | null {
  if (!draft.slotStart) {
    return { state: 'AWAITING_SLOT', text: 'Bạn muốn chơi vào ngày giờ nào ạ?' };
  }
  if (!draft.playMode) {
    return {
      state: 'AWAITING_PLAY_MODE',
      text: 'Bạn thuê xe của quán hay mang xe cá nhân tới ạ?',
    };
  }
  if (!draft.playerCount) {
    return { state: 'AWAITING_PLAY_MODE', text: 'Có mấy bạn cùng chơi ạ?' };
  }
  if (draft.playMode === BookingMode.RENTAL && (!draft.vehicleIds || !draft.vehicleIds.length)) {
    return { state: 'AWAITING_VEHICLES', text: 'Bạn muốn thuê xe nào ạ?' };
  }
  if (!draft.fullName) {
    return { state: 'AWAITING_NAME', text: 'Cho mình xin tên của bạn ạ?' };
  }
  if (!draft.phone) {
    return { state: 'AWAITING_PHONE', text: 'Cho mình xin số điện thoại để giữ chỗ ạ?' };
  }
  return null;
}

function summarize(draft: FbBookingDraft, cafeName: string): string {
  const fmt = (iso?: string) =>
    iso
      ? new Intl.DateTimeFormat('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        }).format(new Date(iso))
      : '';

  return [
    'Mình tóm tắt đơn nhé:',
    ``,
    `Chi nhánh: ${cafeName}`,
    `Thời gian: ${fmt(draft.slotStart)} — ${fmt(draft.slotEnd)}`,
    `Số người: ${draft.playerCount}`,
    `Hình thức: ${draft.playMode === BookingMode.RENTAL ? 'Thuê xe của quán' : 'Mang xe cá nhân'}`,
    ``,
    'Bạn gõ "xác nhận" để mình giữ chỗ nhé!',
  ].join('\n');
}

/**
 * Xử lý một lượt thuộc luồng đặt lịch.
 *
 * Trả `null` khi lượt này KHÔNG thuộc luồng đặt lịch — bộ điều khiển webhook
 * chạy tiếp đường hỏi–đáp bình thường.
 */
export async function tryHandleBookingTurn(
  ctx: BookingTurnContext,
): Promise<BookingTurnResult | null> {
  const existing = await loadDraft(ctx.pageId, ctx.psid);

  // Đơn nháp đã bị chặn vì trùng tài khoản thật: luồng đặt lịch đóng lại cho số
  // điện thoại đó, nhưng AI vẫn trả lời hỏi–đáp bình thường.
  if (existing?.state === 'BLOCKED_REAL_ACCOUNT') return null;

  const extracted = await extractBookingFields(ctx.text, existing);

  // Chưa có đơn nháp và khách cũng không tỏ ý muốn đặt → không phải việc của
  // luồng này.
  if (!existing && !extracted.wantsToBook) return null;

  const cafe = await AppDataSource.getRepository(Cafe).findOne({ where: { id: ctx.cafeId } });
  if (!cafe) return null;

  if (!(await cafeCanAcceptBookings(ctx.cafeId))) {
    logger.warn('FbBooking', 'chi nhánh chưa cấu hình tài khoản nhận tiền', { cafeId: ctx.cafeId });
    return {
      text: 'Hiện chi nhánh chưa nhận đặt lịch qua Messenger ạ. Bạn liên hệ trực tiếp quán giúp mình nhé!',
    };
  }

  const draft: FbBookingDraft = existing ?? { state: 'AWAITING_SLOT', cafeId: ctx.cafeId };
  const next = await mergeExtracted(draft, extracted, cafe);

  // ── Khách đồng ý mức giá mới sau khi giá đổi ──────────────────────────────
  //
  // Đơn đã được tạo ở lượt trước và đang giữ chỗ, chỉ còn thiếu bước phát mã QR.
  // `isConfirmationTurn` cố ý trả `false` ở đây (đơn đã tồn tại), nên nhánh này
  // phải đứng TRƯỚC nó.
  if (next.priceChanged && next.createdBookingId && matchesConfirmationKeyword(ctx.text)) {
    return issueCheckout(ctx, acknowledgePriceChange(next), next.createdBookingId, cafe.name);
  }

  // ── Lượt xác nhận ─────────────────────────────────────────────────────────
  if (isConfirmationTurn(next, ctx.text)) {
    return finalizeBooking(ctx, next, cafe.name);
  }

  // Khách nói chuyện khác trong lúc đang chờ đồng ý giá mới — giữ nguyên cờ để
  // lời xác nhận cũ không bị dùng lại cho mức giá họ chưa chấp nhận.
  if (next.priceChanged) {
    await saveDraft(ctx.pageId, ctx.psid, next);
    return {
      text: `Bạn gõ "xác nhận" nếu đồng ý mức giá ${next.quotedTotal?.toLocaleString('vi-VN')}đ nhé, hoặc cho mình biết bạn muốn đổi gì ạ.`,
    };
  }

  // ── Chưa đủ trường: hỏi tiếp ──────────────────────────────────────────────
  const question = nextQuestion(next);
  if (question) {
    next.state = question.state;
    await saveDraft(ctx.pageId, ctx.psid, next);
    return { text: question.text };
  }

  // ── Đủ trường: hỏi email tuỳ chọn một lần, rồi tóm tắt ─────────────────────
  if (!next.email && !extracted.declinedEmail && next.state !== 'AWAITING_CONFIRMATION') {
    next.state = 'AWAITING_CONFIRMATION';
    await saveDraft(ctx.pageId, ctx.psid, next);
    return {
      text: `${summarize(next, cafe.name)}\n\n(Bạn muốn nhận email xác nhận thì cho mình xin địa chỉ, không thì bỏ qua cũng được ạ.)`,
    };
  }

  next.state = 'AWAITING_CONFIRMATION';
  await saveDraft(ctx.pageId, ctx.psid, next);
  return { text: summarize(next, cafe.name) };
}

/**
 * Phát hành phiên thanh toán cho một đơn đã tồn tại: sinh mã QR và gửi cho khách.
 *
 * Tách riêng vì có HAI đường dẫn tới đây — tạo đơn xong xuôi, và khách đồng ý
 * mức giá mới sau khi giá đổi. Gộp vào `finalizeBooking` thì đường thứ hai phải
 * tạo lại đơn, mà đơn đã tồn tại rồi.
 */
async function issueCheckout(
  ctx: BookingTurnContext,
  draft: FbBookingDraft,
  bookingId: string,
  cafeName: string,
): Promise<BookingTurnResult> {
  // ⚠️ 'bank_transfer', KHÔNG BAO GIỜ 'mock'. Cổng mock xác nhận đơn ngay trong
  // lời gọi này, trước cả khi mã QR được sinh ra — bước quét mã và bấm thanh
  // toán sẽ thành trang trí. Xem research.md D1.
  const checkout = await createCheckoutUrl(bookingId, '127.0.0.1', undefined, 'bank_transfer');

  const qr = checkout.bank_transfer?.qr_image_data_url
    ? await uploadQrForMessenger(checkout.bank_transfer.qr_image_data_url, bookingId)
    : null;

  // Ghi định danh ảnh để móc nối xác nhận dọn được sau khi khách trả tiền.
  if (qr) {
    await AppDataSource.query(
      `UPDATE bookings SET snapshot = COALESCE(snapshot, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [bookingId, JSON.stringify({ fb_qr_public_id: qr.publicId })],
    );
  }

  await saveDraft(ctx.pageId, ctx.psid, {
    ...draft,
    state: 'AWAITING_PAYMENT',
    createdBookingId: bookingId,
    priceChanged: false,
  });

  const expiresAt = checkout.bank_transfer?.expires_at
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(checkout.bank_transfer.expires_at))
    : null;

  return {
    text: [
      `Đã giữ chỗ cho bạn tại ${cafeName}!`,
      ``,
      `Số tiền: ${checkout.total_amount.toLocaleString('vi-VN')}đ`,
      ...(expiresAt ? [`Thanh toán trước: ${expiresAt}`] : []),
      ``,
      `Quét mã QR hoặc bấm nút bên dưới để thanh toán nhé.`,
    ].join('\n'),
    paymentUrl: checkout.payment_url ?? undefined,
    qrImageUrl: qr?.url,
  };
}

/**
 * Tạo đơn thật.
 *
 * Chỉ tới được đây khi `isConfirmationTurn` đã đúng — tức là đủ trường, đúng
 * trạng thái, và khách đã gõ xác nhận sau khi xem tóm tắt.
 */
async function finalizeBooking(
  ctx: BookingTurnContext,
  draft: FbBookingDraft,
  cafeName: string,
): Promise<BookingTurnResult> {
  // Gõ trùng: trả lại đúng đơn cũ, không tạo đơn mới.
  if (draft.createdBookingId) {
    return { text: 'Đơn của bạn đã được giữ chỗ rồi ạ, bạn thanh toán theo link mình gửi nhé!' };
  }

  const resolution = await resolveFacebookSoftUser({
    phone: draft.phone!,
    fullName: draft.fullName!,
    email: draft.email,
  });

  if (resolution.outcome === 'INVALID_PHONE') {
    const retry: FbBookingDraft = { ...draft, phone: undefined, state: 'AWAITING_PHONE' };
    await saveDraft(ctx.pageId, ctx.psid, retry);
    return { text: 'Số điện thoại chưa đúng định dạng ạ, bạn cho mình xin lại nhé?' };
  }

  if (resolution.outcome === 'BLOCKED_REAL_ACCOUNT') {
    await saveDraft(ctx.pageId, ctx.psid, { ...draft, state: 'BLOCKED_REAL_ACCOUNT' });
    return {
      text: [
        'Số điện thoại này đã có tài khoản RCField rồi ạ.',
        '',
        `Bạn đăng nhập tại đây để đặt bằng tài khoản của mình nhé: ${loginUrl()}`,
      ].join('\n'),
    };
  }

  const customer = resolution.user;

  try {
    // Đi qua ĐÚNG đường tạo đơn hiện hành — mọi luật đặt lịch (giờ hoạt động,
    // bội số khung giờ, sức chứa, xung đột giải đấu, phạm vi gói thuê bao) đều
    // được áp y hệt các kênh khác.
    const created = await createBooking(customer.id, {
      cafe_id: ctx.cafeId,
      play_mode: draft.playMode === 'BYOC' ? BookingMode.BYOC : BookingMode.RENTAL,
      slot_start: draft.slotStart!,
      slot_end: draft.slotEnd!,
      vehicle_ids: draft.vehicleIds ?? [],
      participants: [],
      fnb_items: [],
      track_config_id: draft.trackConfigId,
      source: BookingSource.FACEBOOK,
      // Không dùng lại đơn PENDING sẵn có: đơn đó có thể thuộc một phiên trò
      // chuyện khác của cùng tài khoản mềm.
      skipPendingReuse: true,
    });

    // Danh tính Facebook — móc nối gửi tin xác nhận đọc từ đây sau khi khách
    // thanh toán. Ghi vào `snapshot` chứ không thêm cột.
    await AppDataSource.query(
      `UPDATE bookings
          SET snapshot = COALESCE(snapshot, '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
      [
        created.booking_id,
        JSON.stringify({
          fb_psid: ctx.psid,
          fb_page_id: ctx.pageId,
          ...(draft.email ? { contact_email: draft.email } : {}),
        }),
      ],
    );

    // ⚠️ 'bank_transfer', KHÔNG BAO GIỜ 'mock'. Cổng mock xác nhận đơn ngay
    // trong lời gọi này, trước cả khi mã QR được sinh ra — bước quét mã và bấm
    // thanh toán sẽ thành trang trí. Xem research.md D1.
    // ── Giá đổi giữa lúc báo giá và lúc xác nhận (FR-037) ───────────────────
    //
    // `createBooking` áp lại nhân hệ số giá theo khung giờ tại thời điểm gọi,
    // nên tổng tiền có thể khác con số khách vừa nhìn thấy. KHÔNG được gửi mã
    // QR trong trường hợp đó — làm vậy là thu một mức giá khách chưa từng đồng ý.
    //
    // Đơn vẫn giữ nguyên (đang PENDING, chỗ và xe đã giữ) để khách không mất
    // chỗ trong lúc cân nhắc. Không đồng ý thì đơn tự hết hạn theo cơ chế sẵn có.
    if (draft.quotedTotal !== undefined && created.total_amount !== draft.quotedTotal) {
      await saveDraft(ctx.pageId, ctx.psid, {
        ...draft,
        state: 'AWAITING_CONFIRMATION',
        createdBookingId: created.booking_id,
        priceChanged: true,
        previousQuotedTotal: draft.quotedTotal,
        quotedTotal: created.total_amount,
      });

      logger.info('FbBooking', 'giá đổi giữa báo giá và xác nhận', {
        bookingId: created.booking_id,
        quoted: draft.quotedTotal,
        actual: created.total_amount,
      });

      return {
        text: [
          `Giá khung giờ này vừa thay đổi ạ.`,
          ``,
          `Giá báo lúc nãy: ${draft.quotedTotal.toLocaleString('vi-VN')}đ`,
          `Giá hiện tại: ${created.total_amount.toLocaleString('vi-VN')}đ`,
          ``,
          `Bạn gõ "xác nhận" lần nữa nếu đồng ý mức giá mới nhé.`,
        ].join('\n'),
      };
    }

    return issueCheckout(ctx, draft, created.booking_id, cafeName);
  } catch (err) {
    // Tra lại thất bại vì chỗ hoặc xe vừa bị lấy mất. Giữ lại phần còn hợp lệ
    // của đơn nháp, chỉ hỏi lại phần đã hỏng (FR-036).
    if (err instanceof AppError) {
      const cleaned: FbBookingDraft =
        err.code === 'VEHICLE_UNAVAILABLE' || err.code === 'SLOT_LOCKED'
          ? { ...draft, vehicleIds: undefined, state: 'AWAITING_VEHICLES' }
          : {
              ...draft,
              slotStart: undefined,
              slotEnd: undefined,
              vehicleIds: undefined,
              state: 'AWAITING_SLOT',
            };
      await saveDraft(ctx.pageId, ctx.psid, cleaned);

      logger.info('FbBooking', 'tạo đơn thất bại, giữ lại đơn nháp', {
        code: err.code,
        psid: ctx.psid,
      });
      return { text: `Xin lỗi bạn, ${err.message.toLowerCase()}. Bạn chọn lại giúp mình nhé?` };
    }

    logger.error('FbBooking', 'lỗi ngoài dự kiến khi tạo đơn', err);
    return { text: 'Xin lỗi, hệ thống đang bận. Bạn thử lại sau ít phút nhé!' };
  }
}
