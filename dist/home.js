(() => {
  'use strict';

  const RUNS_KEY = 'greenhouse-play-history-v1';
  const gateCounts = { easy: 5, normal: 7, hard: 9 };
  const durations = { easy: 25, normal: 22, hard: 18 };
  const labels = { easy: '이지', normal: '노말', hard: '하드', before: '비교 전', after: '비교 후' };
  const reasons = { won: '성공', alert: '경보 5', samples: '표본 부족' };
  const modeDialog = document.getElementById('mode-dialog');
  const historyDialog = document.getElementById('landing-history-dialog');
  const historyBody = document.getElementById('landing-history-body');

  function loadRuns() {
    try {
      const value = JSON.parse(localStorage.getItem(RUNS_KEY) || 'null');
      if (!Array.isArray(value)) return [];
      return value.filter(run => run &&
        ([2, 3].includes(run.rulesVersion) ? Object.hasOwn(gateCounts, run.mode) :
          (run.rulesVersion === undefined || run.rulesVersion === 1) && ['normal', 'before', 'after'].includes(run.mode)) &&
        ['won', 'alert', 'samples'].includes(run.reason) &&
        Number.isInteger(run.samples) && run.samples >= 0 && run.samples <= ([2, 3].includes(run.rulesVersion) ? gateCounts[run.mode] : 4) &&
        Number.isInteger(run.alert) && run.alert >= 0 && run.alert <= 5 &&
        typeof run.seconds === 'number' && Number.isFinite(run.seconds) && run.seconds >= 0 &&
        run.seconds <= (run.rulesVersion === 3 ? durations[run.mode] : 25) &&
        Number.isInteger(run.chaseAlert) && run.chaseAlert >= 1 && run.chaseAlert <= 2 &&
        Number.isInteger(run.routeIndex) && run.routeIndex >= 0 && run.routeIndex < 3 &&
        Number.isInteger(run.finishedAt) && run.finishedAt > 0 && run.finishedAt <= 8640000000000000
      ).slice(-100);
    } catch { return []; }
  }

  function showHistory() {
    const runs = loadRuns();
    const counts = Object.fromEntries(Object.keys(gateCounts).map(key => [key, runs.filter(run => run.mode === key && [2, 3].includes(run.rulesVersion)).length]));
    document.getElementById('landing-history-summary').textContent = runs.length
      ? `저장된 판 ${runs.length}개 · 이지 ${counts.easy} · 노말 ${counts.normal} · 하드 ${counts.hard}`
      : '완료한 판이 없습니다.';
    historyBody.replaceChildren();
    if (!runs.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = '완료한 판이 없습니다.';
      row.append(cell);
      historyBody.append(row);
    } else {
      runs.slice().reverse().forEach((run, index) => {
        const row = document.createElement('tr');
        const label = run.mode === 'normal' && ![2, 3].includes(run.rulesVersion) ? '기존 4관문'
          : run.rulesVersion === 2 && ['normal', 'hard'].includes(run.mode) ? `${labels[run.mode]} (이전 25초)` : labels[run.mode];
        for (const value of [runs.length - index, label, `${run.samples}개`, `${run.seconds.toFixed(1)}초`, `${run.alert}/5`, reasons[run.reason]]) {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          row.append(cell);
        }
        historyBody.append(row);
      });
    }
    historyDialog.showModal();
    document.getElementById('landing-history-close').focus({ preventScroll: true });
  }

  document.getElementById('choose-mode').addEventListener('click', () => modeDialog.showModal());
  document.getElementById('mode-close').addEventListener('click', () => modeDialog.close());
  document.getElementById('landing-history').addEventListener('click', showHistory);
  document.getElementById('landing-history-close').addEventListener('click', () => historyDialog.close());
  if (new URLSearchParams(location.search).get('choose') === '1') modeDialog.showModal();
})();
