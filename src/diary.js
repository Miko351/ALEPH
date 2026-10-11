import { InputError, todaySeoul } from './model.js';

const one = (result) => result.rows[0] ?? null;
const trimmed = (value, label, max) => {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > max) throw new InputError(`${label}은(는) 1~${max}자로 입력해 주세요.`);
  return result;
};
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function readDiary(db, ownerId) {
  const [configResult, daysResult, changeResult] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM diary_config WHERE owner_id = ?', args: [ownerId] }),
    db.execute({ sql: 'SELECT * FROM diary_days WHERE owner_id = ? ORDER BY day_kst', args: [ownerId] }),
    db.execute({ sql: 'SELECT * FROM diary_rule_changes WHERE owner_id = ?', args: [ownerId] }),
  ]);
  const days = daysResult.rows.map((row) => ({ ...row }));
  const values = days.map((row) => row.value).filter((value) => value !== null);
  const total = round2(values.reduce((sum, value) => sum + Number(value), 0));
  return {
    config: one(configResult),
    days,
    rule_change: one(changeResult),
    total,
    average: values.length ? round2(total / values.length) : null,
    counted_days: values.length,
  };
}

export async function setDiaryConfig(db, input, ownerId, at = new Date()) {
  const data = {
    question: trimmed(input.question, '질문', 300),
    metric_name: trimmed(input.metric_name, '지표 이름', 100),
    unit: trimmed(input.unit, '단위', 40),
    plan_rule: trimmed(input.plan_rule, '처음 계획 규칙', 500),
  };
  const fixed = {
    calculation_rule: '각 날짜의 입력값을 합산하고 값이 있는 날짜 수로 나누어 평균을 구한다.',
    missing_rule: '값이 없으면 빈 값으로 기록하고 합계·평균 계산에서 제외한다.',
    duplicate_rule: '같은 Asia/Seoul 날짜에는 한 건만 허용하고 중복 저장은 거절한다.',
    outlier_rule: '튀는 값도 그대로 계산에 포함하고 이유를 메모에 남긴다.',
    rounding_rule: '입력값과 합계·평균은 소수 둘째 자리까지 표시한다.',
    week_start: '월요일',
  };
  const result = await db.execute({
    sql: `INSERT OR IGNORE INTO diary_config
      (owner_id, question, metric_name, unit, calculation_rule, missing_rule, duplicate_rule,
       outlier_rule, rounding_rule, week_start, plan_rule, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [ownerId, data.question, data.metric_name, data.unit, fixed.calculation_rule,
      fixed.missing_rule, fixed.duplicate_rule, fixed.outlier_rule, fixed.rounding_rule,
      fixed.week_start, data.plan_rule, at.toISOString()],
  });
  if (!Number(result.rowsAffected)) throw new InputError('첫날 기준은 이미 고정되었습니다.', 409);
  return readDiary(db, ownerId);
}

export async function saveDiaryDay(db, input, ownerId, at = new Date()) {
  const rawValue = input.value;
  const value = rawValue === '' || rawValue === null || rawValue === undefined ? null : Number(rawValue);
  if (value !== null && (!Number.isFinite(value) || value < 0 || round2(value) !== value)) {
    throw new InputError('값은 0 이상의 숫자로 소수 둘째 자리까지 입력해 주세요.');
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 1000) throw new InputError('메모는 1000자 이하로 입력해 주세요.');
  const day = todaySeoul(at);
  const tx = await db.transaction('write');
  try {
    const config = one(await tx.execute({ sql: 'SELECT owner_id FROM diary_config WHERE owner_id = ?', args: [ownerId] }));
    if (!config) throw new InputError('먼저 1일차 질문과 지표를 고정해 주세요.');
    const days = (await tx.execute({ sql: 'SELECT day_kst FROM diary_days WHERE owner_id = ? ORDER BY day_kst', args: [ownerId] })).rows;
    if (days.some((row) => row.day_kst === day)) throw new InputError('오늘 기록은 이미 있습니다. 같은 날짜에는 한 건만 남깁니다.', 409);
    if (days.length >= 5) throw new InputError('5일 기록을 완료했습니다.', 409);
    if (days.length === 2) {
      const change = one(await tx.execute({ sql: 'SELECT owner_id FROM diary_rule_changes WHERE owner_id = ?', args: [ownerId] }));
      if (!change) throw new InputError('3일차를 기록하기 전에 계획 규칙 한 가지를 바꿔 주세요.', 409);
    }
    await tx.execute({
      sql: 'INSERT INTO diary_days (owner_id, day_kst, value, note, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [ownerId, day, value, note, at.toISOString()],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
  return readDiary(db, ownerId);
}

export async function changeDiaryRule(db, input, ownerId, at = new Date()) {
  const nextRule = trimmed(input.next_rule, '바꾼 계획 규칙', 500);
  const reason = trimmed(input.reason, '바꾼 이유', 500);
  const tx = await db.transaction('write');
  try {
    const config = one(await tx.execute({ sql: 'SELECT plan_rule FROM diary_config WHERE owner_id = ?', args: [ownerId] }));
    const days = (await tx.execute({ sql: 'SELECT day_kst FROM diary_days WHERE owner_id = ? ORDER BY day_kst', args: [ownerId] })).rows;
    if (!config || days.length !== 2) throw new InputError('계획 규칙은 2일차 기록 뒤, 3일차 기록 전에만 바꿀 수 있습니다.', 409);
    if (nextRule === config.plan_rule) throw new InputError('이전 규칙과 다른 규칙을 적어 주세요.');
    const result = await tx.execute({
      sql: `INSERT OR IGNORE INTO diary_rule_changes
        (owner_id, previous_rule, next_rule, reason, day1_kst, day2_kst, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [ownerId, config.plan_rule, nextRule, reason, days[0].day_kst, days[1].day_kst, at.toISOString()],
    });
    if (!Number(result.rowsAffected)) throw new InputError('계획 규칙은 이미 한 번 바꿨습니다.', 409);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
  return readDiary(db, ownerId);
}

export const diaryActions = {
  'diary.config': setDiaryConfig,
  'diary.day': saveDiaryDay,
  'diary.rule': changeDiaryRule,
};
