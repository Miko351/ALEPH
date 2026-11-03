const box = document.querySelector('#metrics');
const approved = document.querySelector('#approved');
function addCard(label, value, source) {
  const card = document.createElement('article');
  card.className = 'panel';
  for (const [tag, text, className] of [['h3', label, ''], ['strong', value, ''], ['p', source, 'source']]) {
    const item = document.createElement(tag);
    item.textContent = text;
    item.className = className;
    card.append(item);
  }
  box.append(card);
}
try {
  const response = await fetch(new URL('records.json', import.meta.url));
  if (!response.ok) throw new Error('집계 파일을 열지 못했습니다.');
  const data = await response.json();
  const { ritual, attendance, submissions } = data.metrics;
  addCard('리추얼', `${ritual.days}일`, `${ritual.source} · ${ritual.first}~${ritual.last} · 아침 ${ritual.morning}건 · 마무리 ${ritual.evening}건`);
  addCard('출석', `${attendance.present}일 · ${attendance.displayedAttendanceRate}%`, `${attendance.source} · ${attendance.asOf} · 표시 훈련일 ${attendance.trainingDays}일(당일 포함), 출결 집계 ${attendance.finalizedDays}일`);
  if (submissions) addCard('과제 제출', `${submissions.count}건`, `내 제출 현황 · ${submissions.asOf}`);
  for (const item of data.approved) {
    const p = document.createElement('p');
    p.textContent = `${item.date} · ${item.ability} · ${item.sentence} (${item.source})`;
    approved.append(p);
  }
} catch {
  box.textContent = '기록 집계를 불러오지 못했습니다.';
}
