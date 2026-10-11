import { getDb } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { importInitialDataToOwner } from '../src/initial-data.js';
import { loadSnapshot } from '../src/model.js';

const args = process.argv.slice(2);
const usernameIndex = args.indexOf('--username');
const username = usernameIndex >= 0 ? args[usernameIndex + 1]?.trim().toLowerCase() : '';
const apply = args.includes('--apply');

if (!/^[a-z0-9_-]{3,40}$/.test(username) || args.some((arg) => !['--username', '--apply', username].includes(arg))) {
  process.stderr.write('사용법: node scripts/import-t06-records.mjs --username <가입한 아이디> [--apply]\n');
  process.exitCode = 2;
} else {
  let db;
  try {
    db = getDb();
    await ensureSchema(db);
    const account = (await db.execute({
      sql: 'SELECT id, username FROM users WHERE username = ?', args: [username],
    })).rows[0];
    if (!account) throw new Error('가입한 계정을 찾을 수 없습니다. 같은 DB에 가입했는지 확인해 주세요.');
    const marker = (await db.execute({
      sql: 'SELECT name FROM bootstrap_runs WHERE name = ?', args: ['t07-legacy-claim-v1'],
    })).rows[0];
    const unowned = (await db.execute('SELECT COUNT(*) AS total FROM plans WHERE owner_id IS NULL')).rows[0].total;
    process.stdout.write(`대상 아이디: ${account.username}\n이전 방식: ${Number(unowned) ? `주인 없는 기존 계획 ${unowned}건 연결` : '초기 자료 파일에서 복원'}\n`);
    if (marker) throw new Error('기존 기록은 이미 한 계정으로 이전되었습니다. 다시 실행하지 않습니다.');
    if (!apply) {
      process.stdout.write('미리보기만 했습니다. 대상 계정과 DB를 확인한 뒤 같은 명령 끝에 --apply를 붙이세요.\n');
    } else {
      const result = await importInitialDataToOwner(db, account.id);
      const snapshot = await loadSnapshot(db, account.id);
      process.stdout.write(`이전 완료: 계획 ${result.movedPlans}건. 현재 계정의 계획 ${snapshot.plans.length}건, 할 일 ${snapshot.tasks.length}건, 실행 기록 ${snapshot.work_logs.length}건.\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (db) await db.close();
  }
}
