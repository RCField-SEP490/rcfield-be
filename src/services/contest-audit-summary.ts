/**
 * Builds one concise Vietnamese sentence describing a contest audit log entry,
 * so operators can read the contest timeline without decoding raw payloads.
 * Unknown (or seed-only) event types fall back to the raw event type string.
 */

export type ContestAuditSummaryInput = {
  eventType: string;
  actorRole?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string | null;
  metadata?: unknown;
  registrationId?: string | null;
  matchId?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function shortId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 8) : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function registrationRef(log: ContestAuditSummaryInput): string {
  const short = shortId(log.registrationId);
  return short ? `đăng ký #${short}` : 'đăng ký';
}

function matchRef(log: ContestAuditSummaryInput): string {
  const short = shortId(log.matchId);
  return short ? `trận #${short}` : 'trận';
}

function withReason(text: string, reason?: string | null): string {
  const trimmed = reason?.trim();
  return trimmed ? `${text} — lý do: ${trimmed}` : text;
}

export function buildContestAuditSummary(log: ContestAuditSummaryInput): string {
  const before = asRecord(log.beforeJson);
  const after = asRecord(log.afterJson);
  const metadata = asRecord(log.metadata);

  switch (log.eventType) {
    case 'contest.created': {
      const name = readString(after, 'name');
      return name ? `Tạo contest "${name}"` : 'Tạo contest mới';
    }
    case 'contest.updated': {
      const beforeName = readString(before, 'name');
      const afterName = readString(after, 'name');
      if (beforeName && afterName && beforeName !== afterName) {
        return `Cập nhật contest: đổi tên "${beforeName}" → "${afterName}"`;
      }
      return afterName ? `Cập nhật thông tin contest "${afterName}"` : 'Cập nhật thông tin contest';
    }
    case 'contest.opened':
      return 'Mở đăng ký contest';
    case 'contest.closed':
      return 'Đóng đăng ký contest';
    case 'contest.cancelled':
      return withReason('Hủy contest', log.reason);
    case 'contest.auto_closed':
      return 'Hệ thống tự động đóng đăng ký contest';
    case 'registration.created':
      return `Tạo ${registrationRef(log)} tham gia contest`;
    case 'registration.approved':
      return `Duyệt ${registrationRef(log)}`;
    case 'registration.rejected':
      return withReason(`Từ chối ${registrationRef(log)}`, log.reason);
    case 'registration.cancelled': {
      if (metadata.trigger === 'booking_payment_timeout') {
        const short = shortId(log.registrationId);
        return `Đăng ký${short ? ` #${short}` : ''} tự hủy vì booking thuê xe hết hạn thanh toán`;
      }
      return withReason(`Hủy ${registrationRef(log)}`, log.reason);
    }
    case 'registration.disqualified':
      return withReason(`Hủy tư cách thi đấu của ${registrationRef(log)}`, log.reason);
    case 'registration.checked_in':
      return `Check-in ${registrationRef(log)}`;
    case 'registration.entry_fee_marked_paid': {
      const source = readString(after, 'payment_source');
      return `Xác nhận đã thu phí tham gia của ${registrationRef(log)}${source ? ` (nguồn: ${source})` : ''}`;
    }
    case 'registration.entry_fee_waived':
      return `Miễn phí tham gia cho ${registrationRef(log)}`;
    case 'booking.contest_rental_cancelled': {
      const bookingShort = shortId(metadata.booking_id);
      return `Hủy booking thuê xe chưa thanh toán${bookingShort ? ` #${bookingShort}` : ''} của ${registrationRef(log)}`;
    }
    case 'booking.contest_rental_retained': {
      const bookingShort = shortId(metadata.booking_id);
      return `Giữ nguyên booking thuê xe${bookingShort ? ` #${bookingShort}` : ''} (đã thanh toán hoặc đã sử dụng) khi hủy ${registrationRef(log)}`;
    }
    case 'booking.vehicle_checked_out': {
      const bookingShort = shortId(metadata.booking_id);
      return `Xuất xe thuê${bookingShort ? ` cho booking #${bookingShort}` : ''} của ${registrationRef(log)}`;
    }
    case 'contest.matches_generated': {
      const matchCount = readNumber(after, 'generated_match_count');
      const driverCount = readNumber(after, 'registration_count');
      const format = readString(after, 'format');
      return `Tạo ${matchCount ?? '?'} trận đấu cho ${driverCount ?? '?'} tay đua (format ${format ?? 'không rõ'})`;
    }
    case 'contest.final_bracket_generated': {
      const finalistsCount = readNumber(after, 'finalists_count');
      return `Tạo vòng chung kết với ${finalistsCount ?? '?'} finalists`;
    }
    case 'match.participants_updated': {
      const count = asArray(after.participants).length;
      return `Cập nhật danh sách thi đấu của ${matchRef(log)} (${count} người)`;
    }
    case 'match.results_submitted': {
      const beforeStatus = readString(before, 'status');
      const afterStatus = readString(after, 'status');
      const transitionNote =
        beforeStatus && afterStatus ? ` (${beforeStatus} → ${afterStatus})` : '';
      return `Nhập kết quả ${matchRef(log)}${transitionNote}`;
    }
    case 'match.results_corrected': {
      const forceCascade = metadata.force_cascade === true;
      return `Sửa kết quả ${matchRef(log)}${forceCascade ? ' (force cascade)' : ''}`;
    }
    case 'match.advanced': {
      const winnerCount = asArray(after.winners).length;
      const bye = after.bye === true;
      return `Đưa ${winnerCount} người thắng của ${matchRef(log)} vào trận tiếp theo${bye ? ' (bye)' : ''}`;
    }
    case 'contest.leaderboard_published': {
      const entryCount = asArray(after.entries).length;
      return `Công bố bảng xếp hạng với ${entryCount} entries`;
    }
    case 'race_records.synced': {
      const synced = readNumber(metadata, 'synced_count') ?? 0;
      const superseded = readNumber(metadata, 'superseded_count') ?? 0;
      return `Đồng bộ race records: ${synced} bản ghi mới, ${superseded} bản ghi bị thay thế`;
    }
    case 'contest.staff_assigned': {
      const staffShort = shortId(after.staff_id);
      return `Phân công nhân viên${staffShort ? ` #${staffShort}` : ''} vào contest`;
    }
    case 'contest.staff_unassigned': {
      const staffShort = shortId(after.staff_id);
      return `Gỡ phân công nhân viên${staffShort ? ` #${staffShort}` : ''} khỏi contest`;
    }
    case 'contest.participant_banned': {
      const userShort = shortId(after.user_id);
      return withReason(
        `Cấm người chơi${userShort ? ` #${userShort}` : ''} tham gia contest`,
        log.reason,
      );
    }
    case 'contest.participant_unbanned': {
      const userShort = shortId(after.user_id);
      return `Gỡ lệnh cấm người chơi${userShort ? ` #${userShort}` : ''}`;
    }
    default:
      return log.eventType;
  }
}
