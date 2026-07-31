import { In } from 'typeorm';
import { randomBytes } from 'crypto';
import { AppDataSource } from '../../config/database';
import { Cafe } from '../../models/cafe.entity';
import { ContestMatch } from '../../models/contest-match.entity';
import { ContestMatchParticipant } from '../../models/contest-match-participant.entity';
import { ContestRegistration } from '../../models/contest-registration.entity';
import { ContestFormat } from '../../models/contest-format.entity';
import { ContestTemplate } from '../../models/contest-template.entity';
import { ContestType } from '../../models/contest-type.entity';
import { Contest } from '../../models/contest.entity';
import { AppError, ContestMatchStatus, UserRole } from '../../types';
import { assertContestOperator } from '../contest.helpers';
import { Viewer } from '../cafe.service';
import { CreateRegistrationBody } from './types';

export async function resolveCatalogOrThrow(
  contestTypeId: string,
  contestFormatId: string,
  contestTemplateId: string,
) {
  const [contestType, contestFormat, contestTemplate] = await Promise.all([
    AppDataSource.getRepository(ContestType).findOne({
      where: { id: contestTypeId, isActive: true },
    }),
    AppDataSource.getRepository(ContestFormat).findOne({
      where: { id: contestFormatId, isActive: true },
    }),
    AppDataSource.getRepository(ContestTemplate).findOne({
      where: { id: contestTemplateId, isActive: true },
    }),
  ]);

  if (!contestType) throw new AppError('Contest type không hợp lệ', 400, 'CONTEST_TYPE_INVALID');
  if (!contestFormat)
    throw new AppError('Contest format không hợp lệ', 400, 'CONTEST_FORMAT_INVALID');
  if (!contestTemplate)
    throw new AppError('Contest template không hợp lệ', 400, 'CONTEST_TEMPLATE_INVALID');
  if (
    contestTemplate.contestTypeId !== contestType.id ||
    contestTemplate.contestFormatId !== contestFormat.id
  ) {
    throw new AppError(
      'Contest template không khớp với type/format đã chọn',
      400,
      'CONTEST_TEMPLATE_MISMATCH',
    );
  }

  return { contestType, contestFormat, contestTemplate };
}

export async function resolveProviderBranchesOrThrow(providerId: string, cafeIds: string[]) {
  const cafes = await AppDataSource.getRepository(Cafe).findBy({ id: In(cafeIds) });
  if (cafes.length !== cafeIds.length) {
    throw new AppError('Có chi nhánh không tồn tại', 400, 'CAFE_NOT_FOUND');
  }
  for (const cafe of cafes) {
    if (cafe.providerId !== providerId) {
      throw new AppError(
        'Chi nhánh không thuộc provider hiện tại',
        400,
        'CONTEST_BRANCH_FORBIDDEN',
      );
    }
    if (cafe.status !== 'ACTIVE') {
      throw new AppError(
        'Contest chỉ được gắn với chi nhánh ACTIVE',
        400,
        'CONTEST_BRANCH_INACTIVE',
      );
    }
  }
  return cafes;
}

export function getRuntimeFormatFromCatalog(contestFormatCode: string) {
  return contestFormatCode === 'TIME_TRIAL' ? 'TIME_TRIAL' : 'KNOCKOUT';
}

export function stripRuntimeManagedConfig(config: Record<string, unknown> | null | undefined) {
  const nextConfig = { ...(config ?? {}) };
  delete nextConfig.format;
  delete nextConfig.runtime_format;
  delete nextConfig.resource_locks;
  return nextConfig;
}

export async function assertContestProviderOrAssignedStaff(contestId: string, viewer: Viewer) {
  return assertContestOperator(contestId, viewer);
}

export async function resolveContestProviderIdForViewer(
  viewer: Viewer,
  contest?: Contest,
): Promise<string> {
  if (viewer.role === UserRole.PROVIDER) return viewer.userId;
  if (contest?.providerId) return contest.providerId;
  throw new AppError('Không xác định được provider của contest', 400, 'PROVIDER_NOT_RESOLVED');
}

export function buildByocMetadata(body: CreateRegistrationBody) {
  return {
    vehicle_name: body.byoc_vehicle_name ?? null,
    vehicle_brand: body.byoc_vehicle_brand ?? null,
    vehicle_class: body.byoc_vehicle_class ?? null,
    notes: body.byoc_vehicle_notes ?? null,
  };
}

export async function generateUniqueCheckInCode(
  manager: import('typeorm').EntityManager,
  maxAttempts = 5,
): Promise<string> {
  const repo = manager.getRepository(ContestRegistration);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    const existing = await repo.findOne({ where: { checkInCode: code } });
    if (!existing) return code;
  }
  throw new AppError('Không thể tạo mã check-in duy nhất', 500, 'CHECK_IN_CODE_GENERATION_FAILED');
}

export async function removeRegistrationFromActiveMatches(registrationId: string) {
  const participantRepo = AppDataSource.getRepository(ContestMatchParticipant);
  const matchRepo = AppDataSource.getRepository(ContestMatch);
  const participants = await participantRepo.find({ where: { registrationId } });

  for (const participant of participants) {
    const match = await matchRepo.findOne({ where: { id: participant.matchId } });
    if (!match || match.status === ContestMatchStatus.COMPLETED) continue;

    await participantRepo.remove(participant);

    const remainingCount = await participantRepo.count({ where: { matchId: match.id } });
    if (match.status === ContestMatchStatus.READY && remainingCount === 0) {
      match.status = ContestMatchStatus.DRAFT;
      await matchRepo.save(match);
    }
  }
}
