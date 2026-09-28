(() => {
  'use strict';

  const MAX_ALERT = 5;
  const MAX_RECORDED_SECONDS = 25;
  const RECORD_KEY = 'greenhouse-scene-test-record-v1';
  const RUNS_KEY = 'greenhouse-play-history-v1';
  const MAX_SAVED_RUNS = 100;
  const qaParam = new URLSearchParams(location.search).get('qa');
  const qaMode = qaParam === 'before' || qaParam === 'after' ? qaParam : null;
  const CHASE_ALERT = qaMode === 'before' ? 2 : 1;
  const requestedMode = new URLSearchParams(location.search).get('mode');
  const mode = qaMode ? 'tutorial' : ['tutorial', 'easy', 'normal', 'hard'].includes(requestedMode) ? requestedMode : 'easy';
  const MODE_CONFIGS = {
    tutorial: { label: '튜토리얼', duration: 25, requiredSamples: 3, times: [4, 10, 16, 22] },
    easy: { label: '이지', duration: 25, requiredSamples: 3, times: [3, 8, 13, 18, 23] },
    normal: { label: '노말', duration: 22, requiredSamples: 5, times: [2.6, 5.7, 8.8, 11.9, 15, 18, 21.1] },
    hard: { label: '하드', duration: 18, requiredSamples: 6, startingAlert: 3, times: [1.8, 3.7, 5.7, 7.6, 9.6, 11.5, 13.5, 15.4, 17.4] }
  };
  const modeConfig = MODE_CONFIGS[mode];
  const DURATION = modeConfig.duration;
  const REQUIRED_SAMPLES = modeConfig.requiredSamples;
  const STARTING_ALERT = modeConfig.startingAlert ?? 1;
  const routes = [
    [
      { at: 4, good: 'up', creature: 'patrol' },
      { at: 10, good: 'down', creature: 'chase' },
      { at: 16, good: 'up', creature: 'patrol' },
      { at: 22, good: 'down', creature: 'chase' }
    ],
    [
      { at: 4, good: 'down', creature: 'patrol' },
      { at: 10, good: 'up', creature: 'chase' },
      { at: 16, good: 'down', creature: 'patrol' },
      { at: 22, good: 'up', creature: 'chase' }
    ],
    [
      { at: 4, good: 'up', creature: 'patrol' },
      { at: 10, good: 'up', creature: 'chase' },
      { at: 16, good: 'down', creature: 'patrol' },
      { at: 22, good: 'down', creature: 'chase' }
    ]
  ];
  const goodPatterns = [
    ['up', 'down', 'up', 'down', 'down', 'up', 'down', 'up', 'down'],
    ['down', 'up', 'down', 'up', 'up', 'down', 'up', 'down', 'up'],
    ['up', 'up', 'down', 'down', 'up', 'down', 'up', 'up', 'down']
  ];

  function routeFor(index) {
    if (mode === 'tutorial') return routes[index];
    return modeConfig.times.map((at, eventIndex) => ({
      at,
      good: goodPatterns[index][eventIndex],
      creature: eventIndex % 2 === 0 && !(mode === 'hard' && eventIndex === 8) ? 'patrol' : 'chase'
    }));
  }

  const ui = {
    sample: document.getElementById('sample-value'), sampleGoal: document.getElementById('sample-goal'),
    pageNote: document.getElementById('page-note'), rulesDuration: document.getElementById('rules-duration'),
    alert: document.getElementById('alert-value'), state: document.getElementById('game-state'),
    modeName: document.getElementById('mode-name'), hudGoal: document.getElementById('hud-goal-text'),
    rulesSamples: document.getElementById('rules-samples'), rulesStartAlert: document.getElementById('rules-start-alert'),
    recapSamples: document.getElementById('recap-samples'),
    nextTime: document.getElementById('next-time'), nextTitle: document.getElementById('next-title'),
    creatureForecast: document.getElementById('creature-forecast'),
    routeUp: document.getElementById('route-up'), routeDown: document.getElementById('route-down'),
    routeUpResult: document.getElementById('route-up-result'), routeDownResult: document.getElementById('route-down-result'),
    routeUpAlert: document.getElementById('route-up-alert'), routeDownAlert: document.getElementById('route-down-alert'),
    eventReport: document.getElementById('event-report'), eventNumber: document.getElementById('event-number'),
    eventPath: document.getElementById('event-path'), eventTechAction: document.getElementById('event-tech-action'),
    eventTechSample: document.getElementById('event-tech-sample'), eventTechAlert: document.getElementById('event-tech-alert'),
    eventCreatureAction: document.getElementById('event-creature-action'), eventCreatureAlert: document.getElementById('event-creature-alert'),
    eventTotal: document.getElementById('event-total'),
    upButton: document.getElementById('up-button'), downButton: document.getElementById('down-button'),
    pause: document.getElementById('pause-button'), restart: document.getElementById('restart-button'),
    motion: document.getElementById('motion-button'), inputCount: document.getElementById('input-count'),
    record: document.getElementById('record-value'), qaLabel: document.getElementById('qa-mode'), opening: document.getElementById('opening'),
    openingTitle: document.getElementById('opening-title'), openingCopy: document.getElementById('opening-copy'),
    openingKicker: document.querySelector('.opening-kicker'), start: document.getElementById('start-button'),
    back: document.getElementById('back-link'),
    tutorialTip: document.getElementById('tutorial-tip'), tutorialCount: document.getElementById('tutorial-count'),
    tutorialTitle: document.getElementById('tutorial-title'), tutorialCopy: document.getElementById('tutorial-copy'),
    tutorialNext: document.getElementById('tutorial-next'), tutorialSkip: document.getElementById('tutorial-skip'),
    rulesButton: document.getElementById('rules-button'), rulesDialog: document.getElementById('rules-dialog'),
    rulesClose: document.getElementById('rules-close'),
    historyButton: document.getElementById('history-button'), historyDialog: document.getElementById('history-dialog'),
    historyClose: document.getElementById('history-close'), historyBody: document.getElementById('history-body'),
    historyProgress: document.getElementById('history-progress'), historyComparison: document.getElementById('history-comparison'),
    leaveDialog: document.getElementById('leave-dialog'), leaveCancel: document.getElementById('leave-cancel'),
    gateLayer: document.getElementById('gate-layer'), tech: document.getElementById('tech-actor'),
    specimen: document.getElementById('specimen-actor'),
    upperGlow: document.getElementById('upper-glow'),
    lowerGlow: document.getElementById('lower-glow')
  };

  function loadRecord() {
    try {
      const value = JSON.parse(localStorage.getItem(RECORD_KEY) || 'null');
      if (value && Number.isInteger(value.rounds) && value.rounds >= 0 && value.rounds < 1000000 &&
          Number.isInteger(value.wins) && value.wins >= 0 && value.wins <= value.rounds &&
          Number.isInteger(value.best) && value.best >= 0 && value.best <= MODE_CONFIGS.hard.times.length) return value;
    } catch { /* 손상된 기록은 기본값으로 되돌린다. */ }
    return { rounds: 0, wins: 0, best: 0 };
  }

  function saveRecord() {
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(record)); }
    catch { /* 저장이 불가능해도 현재 판은 계속 진행한다. */ }
  }

  function loadRuns() {
    try {
      const value = JSON.parse(localStorage.getItem(RUNS_KEY) || 'null');
      if (!Array.isArray(value)) return [];
      return value.filter(run => run &&
        ([2, 3].includes(run.rulesVersion) ? ['easy', 'normal', 'hard'].includes(run.mode) :
          (run.rulesVersion === undefined || run.rulesVersion === 1) && ['normal', 'before', 'after'].includes(run.mode)) &&
        ['won', 'alert', 'samples'].includes(run.reason) &&
        Number.isInteger(run.samples) && run.samples >= 0 && run.samples <= ([2, 3].includes(run.rulesVersion) ? MODE_CONFIGS[run.mode].times.length : 4) &&
        Number.isInteger(run.alert) && run.alert >= 0 && run.alert <= MAX_ALERT &&
        typeof run.seconds === 'number' && Number.isFinite(run.seconds) && run.seconds >= 0 &&
        run.seconds <= (run.rulesVersion === 3 ? MODE_CONFIGS[run.mode].duration : MAX_RECORDED_SECONDS) &&
        Number.isInteger(run.chaseAlert) && run.chaseAlert >= 1 && run.chaseAlert <= 2 &&
        Number.isInteger(run.routeIndex) && run.routeIndex >= 0 && run.routeIndex < routes.length &&
        Number.isInteger(run.finishedAt) && run.finishedAt > 0 && run.finishedAt <= 8640000000000000
      ).slice(-MAX_SAVED_RUNS);
    } catch { return []; }
  }

  function saveRuns() {
    try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs)); return true; }
    catch { return false; }
  }

  let record = loadRecord();
  let runs = loadRuns();
  let runsSaved = true;
  let routeIndex = qaMode || mode === 'tutorial' ? 0 : record.rounds % routes.length;
  let route = routeFor(routeIndex);
  let phase = 'ready';
  let elapsed = 0;
  let cursor = 0;
  let samples = 0;
  let alert = STARTING_ALERT;
  let signal = 'up';
  let commands = 0;
  let flips = 0;
  let frame = 0;
  let lastFrame = 0;
  let pauseReason = '';
  let rulesWasPlaying = false;
  let historyWasPlaying = false;
  let leaveWasPlaying = false;
  let eventReportUntil = 0;
  let lastEventSummary = '';
  let guideStage = '';
  let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gates = [];

  function gateX(event) {
    return 9 + 83.5 * event.at / DURATION;
  }

  function buildGates() {
    ui.gateLayer.replaceChildren();
    gates.length = 0;
    route.forEach((event, index) => {
      const pair = {};
      for (const actor of ['tech', 'specimen']) {
        const gate = document.createElement('span');
        gate.className = `gate gate--${actor}`;
        gate.style.left = `${gateX(event)}%`;
        gate.style.top = actor === 'tech' ? '34%' : '74%';
        const plate = document.createElement('em');
        plate.textContent = String(index + 1).padStart(2, '0');
        const item = document.createElement('span');
        item.className = 'gate-item';
        gate.append(plate, item);
        ui.gateLayer.append(gate);
        pair[actor] = { gate, item };
      }
      gates.push(pair);
    });
  }

  function updateRouteChoice(row, resultNode, alertNode, event, signalDirection) {
    const good = signalDirection === event.good;
    const alertChange = good ? 1 : -2;
    const creatureChange = event.creature === 'patrol' ? -1 : CHASE_ALERT;
    const totalChange = alertChange + creatureChange;
    const projectedAlert = Math.min(MAX_ALERT, Math.max(0, alert + totalChange));
    resultNode.textContent = good ? '표본 +1' : '빈 길';
    alertNode.textContent = `내 ${alertChange > 0 ? '+' : ''}${alertChange} · 합계 ${totalChange > 0 ? '+' : ''}${totalChange} · 경보 ${alert}→${projectedAlert}${projectedAlert >= MAX_ALERT ? ' 실패' : ''}`;
    alertNode.classList.toggle('is-reduction', totalChange <= 0);
    row.classList.toggle('is-good', good);
    row.classList.toggle('is-bad', !good);
  }

  function updateActors() {
    const techX = Math.min(93, 9 + 84 * elapsed / DURATION);
    const event = route[cursor];
    const previousAt = cursor === 0 ? 0 : route[cursor - 1].at;
    const startX = cursor === 0 ? 8 : gateX(route[cursor - 1]);
    const endX = event ? gateX(event) : 93;
    const segmentEnd = event ? event.at : DURATION;
    const progress = Math.min(1, Math.max(0, (elapsed - previousAt) / (segmentEnd - previousAt)));
    const chasing = event?.creature === 'chase';
    const travel = chasing ? 1 - Math.pow(1 - progress, 3) : progress;
    const patrolSway = !chasing && !reduceMotion && phase === 'playing' ? Math.sin(elapsed * 3) * 0.35 : 0;
    const specimenX = Math.min(93, startX + (endX - startX) * travel + patrolSway);
    ui.tech.style.left = `${techX}%`;
    ui.specimen.style.left = `${specimenX}%`;
    ui.tech.style.top = '34%';
    ui.upperGlow.style.left = `${techX}%`;
    ui.upperGlow.style.top = '34%';
    ui.lowerGlow.style.left = `${specimenX}%`;
    const mode = chasing ? 'chase' : 'patrol';
    ui.specimen.dataset.mode = mode;
  }

  function updateRecord() {
    ui.record.textContent = `최고 표본 ${record.best}개 · 탈출 ${record.wins}회`;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function updateHistory() {
    const before = runs.filter(run => run.mode === 'before').slice(-10);
    const after = runs.filter(run => run.mode === 'after').slice(-10);
    ui.historyProgress.textContent = `비교 전 ${before.length}/10 · 비교 후 ${after.length}/10`;
    if (before.length === 10 && after.length === 10) {
      const wins = group => group.filter(run => run.reason === 'won').length;
      const alertFails = group => group.filter(run => run.reason === 'alert').length;
      ui.historyComparison.textContent = `고정 경로 · 추적 경보만 +2 → +1. 성공 ${wins(before)}/10 → ${wins(after)}/10, 경보 실패 ${alertFails(before)} → ${alertFails(after)}판, 표본 중앙값 ${median(before.map(run => run.samples))} → ${median(after.map(run => run.samples))}개, 종료 시간 중앙값 ${median(before.map(run => run.seconds)).toFixed(1)} → ${median(after.map(run => run.seconds)).toFixed(1)}초. 최종 일반 설정은 추적 경보 +1.`;
    } else {
      ui.historyComparison.textContent = '두 설정 모두 같은 경로입니다. 추적 경보만 비교 전 +2, 비교 후 +1로 바뀝니다. 각 설정으로 10판씩 완료하면 비교 결과가 표시됩니다.';
    }
    if (!runsSaved) ui.historyComparison.textContent += ' 현재 브라우저에 기록을 저장할 수 없어 재접속 후 유지되지 않을 수 있습니다.';
    ui.historyBody.replaceChildren();
    if (runs.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = '완료한 판이 없습니다.';
      row.append(cell);
      ui.historyBody.append(row);
    } else {
      const labels = { easy: '이지', normal: '노말', hard: '하드', before: '비교 전', after: '비교 후' };
      const reasons = { won: '성공', alert: '경보 5', samples: '표본 부족' };
      runs.slice().reverse().forEach((run, index) => {
        const row = document.createElement('tr');
        const label = run.mode === 'normal' && ![2, 3].includes(run.rulesVersion) ? '기존 4관문'
          : run.rulesVersion === 2 && ['normal', 'hard'].includes(run.mode) ? `${labels[run.mode]} (이전 25초)` : labels[run.mode];
        for (const value of [runs.length - index, label, `${run.samples}개`, `${run.seconds.toFixed(1)}초`, `${run.alert}/5`, reasons[run.reason]]) {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          row.append(cell);
        }
        ui.historyBody.append(row);
      });
    }
  }

  function render() {
    document.body.dataset.phase = phase;
    document.body.dataset.effects = reduceMotion ? 'off' : 'on';
    ui.sample.textContent = String(samples);
    ui.alert.textContent = String(alert);
    const stateText = ({ ready: '대기 중', playing: '진행 중', paused: pauseReason || '일시정지', won: '탈출 성공', lost: '봉쇄 실패' })[phase];
    if (ui.state.textContent !== stateText) ui.state.textContent = stateText;
    ui.inputCount.textContent = `명령 ${commands}회 · 전환 ${flips}회`;
    ui.upButton.disabled = phase !== 'playing' && guideStage !== 'input';
    ui.downButton.disabled = phase !== 'playing';
    ui.upButton.setAttribute('aria-pressed', String(signal === 'up'));
    ui.downButton.setAttribute('aria-pressed', String(signal === 'down'));
    ui.pause.disabled = (phase !== 'playing' && phase !== 'paused') || !ui.tutorialTip.hidden;
    ui.pause.classList.toggle('is-paused', phase === 'paused');
    ui.pause.setAttribute('aria-label', phase === 'paused' ? '재개, P 키' : '일시정지, P 키');

    const event = route[cursor];
    ui.routeUp.classList.toggle('is-selected', signal === 'up');
    ui.routeDown.classList.toggle('is-selected', signal === 'down');
    if (event && phase !== 'won' && phase !== 'lost') {
      ui.nextTime.textContent = `${Math.max(0, event.at - elapsed).toFixed(1)}초`;
      ui.nextTitle.textContent = `${cursor + 1}번 관문`;
      ui.creatureForecast.textContent = event.creature === 'patrol'
        ? '괴생물 예고 · 자동 순찰 · 경보 -1' : `괴생물 예고 · 자동 추적 · 경보 +${CHASE_ALERT}`;
      ui.creatureForecast.classList.toggle('is-chase', event.creature === 'chase');
      updateRouteChoice(ui.routeUp, ui.routeUpResult, ui.routeUpAlert, event, 'up');
      updateRouteChoice(ui.routeDown, ui.routeDownResult, ui.routeDownAlert, event, 'down');
    } else {
      ui.nextTime.textContent = '—';
      ui.nextTitle.textContent = phase === 'playing' ? '출구로 이동 중' : '작전 종료';
      ui.creatureForecast.textContent = '괴생물 예고 종료';
      ui.creatureForecast.classList.remove('is-chase');
      for (const [row, result, alertChange] of [
        [ui.routeUp, ui.routeUpResult, ui.routeUpAlert],
        [ui.routeDown, ui.routeDownResult, ui.routeDownAlert]
      ]) {
        row.classList.remove('is-good', 'is-bad');
        alertChange.classList.remove('is-reduction');
        result.textContent = '—';
        alertChange.textContent = '예상 경보 —';
      }
    }
    gates.forEach((pair, index) => {
      for (const { gate } of Object.values(pair)) gate.classList.toggle('is-next', index === cursor && phase !== 'won' && phase !== 'lost');
    });
    ui.eventReport.hidden = elapsed >= eventReportUntil || phase === 'ready';
    updateActors();
  }

  function showEffect(node, label, change, favorablePositive = false) {
    node.textContent = change === 0 ? `${label} 변화 없음` : `${label} ${change > 0 ? '+' : ''}${change} ${change > 0 ? '↑' : '↓'}`;
    node.classList.toggle('is-benefit', change !== 0 && (change > 0) === favorablePositive);
    node.classList.toggle('is-harm', change !== 0 && (change > 0) !== favorablePositive);
  }

  function finish(result) {
    const won = result === 'won';
    phase = won ? 'won' : 'lost';
    cancelAnimationFrame(frame);
    frame = 0;
    if (mode !== 'tutorial' || qaMode) {
      record.rounds += 1;
      if (won) record.wins += 1;
      record.best = Math.max(record.best, samples);
      saveRecord();
      runs.push({
        mode: qaMode || mode, rulesVersion: qaMode ? 1 : 3, chaseAlert: CHASE_ALERT, routeIndex,
        samples, alert, seconds: Number(elapsed.toFixed(1)), reason: result,
        commands, finishedAt: Date.now()
      });
      runs = runs.slice(-MAX_SAVED_RUNS);
      runsSaved = saveRuns();
      updateRecord();
      updateHistory();
    }
    ui.openingKicker.textContent = won ? 'SECTOR CLEARED' : 'CONTAINMENT FAILED';
    ui.openingTitle.textContent = ({ won: '탈출 성공!', alert: '경보 5 · 즉시 실패', samples: '표본 부족 · 시간 종료' })[result];
    const explanation = ({
      won: `${DURATION}초가 끝났을 때 표본 ${REQUIRED_SAMPLES}개 이상과 경보 4 이하를 지켰습니다.`,
      alert: `경보가 5에 도달해 ${DURATION}초가 끝나기 전에 종료됐습니다.`,
      samples: `${DURATION}초가 끝났지만 표본을 ${REQUIRED_SAMPLES}개 모으지 못했습니다.`
    })[result];
    ui.openingCopy.textContent = `${explanation} 이번 판: 표본 ${samples}/${REQUIRED_SAMPLES} · 경보 ${alert}/5 · 전환 ${flips}회.${lastEventSummary ? ` ${lastEventSummary}` : ''}${mode === 'tutorial' && !qaMode ? ' 연습 기록은 저장되지 않습니다.' : ''}`;
    ui.opening.hidden = false;
    render();
    ui.openingTitle.focus({ preventScroll: true });
  }

  function resolveEvent(event, index) {
    const good = signal === event.good;
    const creaturePatrol = event.creature === 'patrol';
    const beforeSamples = samples;
    const beforeAlert = alert;
    const { tech, specimen } = gates[index];
    tech.gate.classList.add(good ? 'is-good' : 'is-bad');
    specimen.gate.classList.add(creaturePatrol ? 'is-good' : 'is-bad');
    if (creaturePatrol) specimen.item.classList.add('is-safe');
    if (good) { samples += 1; tech.item.classList.add('is-collected'); }
    const techAlertChange = good ? 1 : -2;
    const creatureAlertChange = creaturePatrol ? -1 : CHASE_ALERT;
    const alertChange = techAlertChange + creatureAlertChange;
    const rawAlert = beforeAlert + alertChange;
    alert = Math.min(MAX_ALERT, Math.max(0, rawAlert));
    ui.eventNumber.textContent = `${index + 1}번 관문 결과`;
    ui.eventReport.dataset.side = index < route.length / 2 ? 'right' : 'left';
    ui.eventPath.textContent = `${signal === 'up' ? '↑ 위쪽' : '↓ 아래쪽'} 길 선택`;
    ui.eventTechAction.textContent = good ? '표본 길 통과' : '빈 길 통과';
    showEffect(ui.eventTechSample, '표본', good ? 1 : 0, true);
    showEffect(ui.eventTechAlert, '경보', techAlertChange);
    ui.eventCreatureAction.textContent = `자동 ${creaturePatrol ? '순찰' : '추적'}`;
    showEffect(ui.eventCreatureAlert, '경보', creatureAlertChange);
    const limitNote = rawAlert < 0 ? ' (경보는 0 아래로 내려가지 않음)' : rawAlert > MAX_ALERT ? ' (최대 경보 5 적용)' : '';
    ui.eventTotal.textContent = `표본 ${beforeSamples} → ${samples} · 경보 ${beforeAlert} → ${alert}${limitNote}`;
    lastEventSummary = `마지막 관문: ${signal === 'up' ? '위쪽' : '아래쪽'} 길 · 탐사원 ${good ? '표본 +1, 경보 +1' : '표본 +0, 경보 -2'} · 괴생물 ${creaturePatrol ? '순찰 -1' : `추적 +${CHASE_ALERT}`} · 실제 경보 ${beforeAlert}→${alert}.`;
    eventReportUntil = elapsed + (mode === 'hard' ? 1.2 : mode === 'normal' ? 1.8 : 3.2);
    ui.eventReport.hidden = false;
    if (alert >= MAX_ALERT) finish('alert');
  }

  function tick(now) {
    if (phase !== 'playing') return;
    elapsed = Math.min(DURATION, elapsed + Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    while (cursor < route.length && route[cursor].at <= elapsed && phase === 'playing') {
      resolveEvent(route[cursor], cursor);
      cursor += 1;
      if (mode === 'tutorial' && !qaMode && cursor === 1 && phase === 'playing' && guideStage === 'await-result') {
        pauseGame('결과 확인 중');
        showGuide('result');
      }
    }
    if (phase === 'playing' && elapsed >= DURATION) {
      finish(samples >= REQUIRED_SAMPLES ? 'won' : 'samples');
    }
    if (phase === 'playing') {
      render();
      frame = requestAnimationFrame(tick);
    }
  }

  function startGame() {
    cancelAnimationFrame(frame);
    routeIndex = qaMode || mode === 'tutorial' ? 0 : record.rounds % routes.length;
    route = routeFor(routeIndex);
    phase = 'playing';
    elapsed = 0;
    cursor = 0;
    samples = 0;
    alert = STARTING_ALERT;
    signal = mode === 'tutorial' && !qaMode ? 'down' : 'up';
    commands = 0;
    flips = 0;
    eventReportUntil = 0;
    lastEventSummary = '';
    pauseReason = '';
    ui.opening.hidden = true;
    ui.eventReport.hidden = true;
    ui.tutorialTip.hidden = true;
    guideStage = '';
    buildGates();
    if (mode === 'tutorial' && !qaMode) {
      phase = 'paused';
      pauseReason = '튜토리얼 안내';
      showGuide('goal');
    } else {
      render();
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
      ui.upButton.focus({ preventScroll: true });
    }
  }

  function showGuide(stage) {
    guideStage = stage;
    const guides = {
      goal: ['1/4', '작전 목표', '25초 동안 표본 3개 이상을 모으세요. 경보가 5가 되면 즉시 실패합니다.', '다음'],
      input: ['2/4', '길을 바꿔 보세요', '괴생물 예고와 두 길의 예상 경보를 보고, 위쪽 길 버튼이나 ↑ 키를 눌러 표본 길을 선택해 보세요. 지금은 시간이 흐르지 않습니다.', ''],
      ready: ['3/4', '관문으로 이동', '길 선택은 다음 관문에 도착할 때 확정됩니다. 시작하면 첫 관문까지 4초입니다.', '작전 진행'],
      result: ['4/4', '방금 일어난 일', '중앙 결과에서 내 길 선택·표본·경보와 괴생물의 행동을 따로 확인하세요. 남은 관문은 직접 판단해 보세요.', '남은 관문 진행']
    };
    const [count, title, copy, button] = guides[stage];
    ui.tutorialCount.textContent = `튜토리얼 ${count}`;
    ui.tutorialTitle.textContent = title;
    ui.tutorialCopy.textContent = copy;
    ui.tutorialNext.textContent = button;
    ui.tutorialNext.hidden = stage === 'input';
    ui.tutorialTip.hidden = false;
    render();
    (stage === 'input' ? ui.upButton : ui.tutorialNext).focus({ preventScroll: true });
  }

  function resumeGuide(stage) {
    guideStage = stage;
    ui.tutorialTip.hidden = true;
    phase = 'playing';
    pauseReason = '';
    lastFrame = performance.now();
    render();
    frame = requestAnimationFrame(tick);
    ui.upButton.focus({ preventScroll: true });
  }

  function nextGuide() {
    if (guideStage === 'goal') showGuide('input');
    else if (guideStage === 'ready') resumeGuide('await-result');
    else if (guideStage === 'result') resumeGuide('done');
  }

  function selectSignal(direction) {
    const guidedInput = mode === 'tutorial' && guideStage === 'input' && phase === 'paused';
    if (phase !== 'playing' && !guidedInput) return;
    if (guidedInput && direction !== 'up') return;
    commands += 1;
    if (signal !== direction) {
      signal = direction;
      flips += 1;
    }
    render();
    if (guidedInput) showGuide('ready');
  }

  function pauseGame(reason = '') {
    if (phase !== 'playing') return;
    phase = 'paused';
    pauseReason = reason;
    cancelAnimationFrame(frame);
    frame = 0;
    render();
  }

  function togglePause() {
    if (!ui.tutorialTip.hidden) return;
    if (phase === 'playing') pauseGame();
    else if (phase === 'paused') {
      phase = 'playing';
      pauseReason = '';
      lastFrame = performance.now();
      render();
      frame = requestAnimationFrame(tick);
    }
  }

  function toggleMotion() {
    reduceMotion = !reduceMotion;
    ui.motion.setAttribute('aria-pressed', String(reduceMotion));
    ui.motion.textContent = reduceMotion ? '움직임 줄이기: 켜짐' : '움직임 줄이기';
    render();
  }

  function openRules() {
    rulesWasPlaying = phase === 'playing';
    if (rulesWasPlaying) pauseGame('규칙 확인 중');
    ui.rulesDialog.showModal();
    ui.rulesClose.focus({ preventScroll: true });
  }

  function openHistory() {
    historyWasPlaying = phase === 'playing';
    if (historyWasPlaying) pauseGame('기록 확인 중');
    updateHistory();
    ui.historyDialog.showModal();
    ui.historyClose.focus({ preventScroll: true });
  }

  ui.start.addEventListener('click', startGame);
  ui.tutorialNext.addEventListener('click', nextGuide);
  ui.tutorialSkip.addEventListener('click', () => resumeGuide('done'));
  ui.back.addEventListener('click', event => {
    if (phase !== 'playing' && phase !== 'paused') return;
    event.preventDefault();
    leaveWasPlaying = phase === 'playing';
    if (leaveWasPlaying) pauseGame('나가기 확인 중');
    ui.leaveDialog.showModal();
    ui.leaveCancel.focus({ preventScroll: true });
  });
  ui.leaveCancel.addEventListener('click', () => ui.leaveDialog.close());
  ui.leaveDialog.addEventListener('close', () => {
    if (leaveWasPlaying && phase === 'paused') togglePause();
    leaveWasPlaying = false;
    ui.back.focus({ preventScroll: true });
  });
  ui.upButton.addEventListener('click', () => selectSignal('up'));
  ui.downButton.addEventListener('click', () => selectSignal('down'));
  ui.pause.addEventListener('click', togglePause);
  ui.restart.addEventListener('click', startGame);
  ui.motion.addEventListener('click', toggleMotion);
  ui.historyButton.addEventListener('click', openHistory);
  ui.historyClose.addEventListener('click', () => ui.historyDialog.close());
  ui.historyDialog.addEventListener('close', () => {
    if (historyWasPlaying && phase === 'paused' && pauseReason === '기록 확인 중') togglePause();
    historyWasPlaying = false;
    ui.historyButton.focus({ preventScroll: true });
  });
  ui.rulesButton.addEventListener('click', openRules);
  ui.rulesClose.addEventListener('click', () => ui.rulesDialog.close());
  ui.rulesDialog.addEventListener('close', () => {
    if (rulesWasPlaying && phase === 'paused' && pauseReason === '규칙 확인 중') togglePause();
    rulesWasPlaying = false;
    ui.rulesButton.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (ui.rulesDialog.open || ui.historyDialog.open || ui.leaveDialog.open) return;
    if ((event.code === 'ArrowUp' || event.code === 'ArrowDown') && (phase === 'playing' || guideStage === 'input')) {
      event.preventDefault();
      if (guideStage === 'input' && event.code !== 'ArrowUp') return;
      const direction = event.code === 'ArrowUp' ? 'up' : 'down';
      selectSignal(direction);
      (direction === 'up' ? ui.upButton : ui.downButton).focus({ preventScroll: true });
    } else if (event.code === 'KeyP' && (phase === 'playing' || phase === 'paused')) {
      event.preventDefault();
      togglePause();
    } else if (event.code === 'KeyR') {
      event.preventDefault();
      startGame();
    }
  });
  window.addEventListener('blur', () => pauseGame('화면 이탈'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame('화면 이탈');
  });

  ui.motion.setAttribute('aria-pressed', String(reduceMotion));
  ui.pageNote.textContent = `${modeConfig.label} · ${DURATION}초 안에 탐사원의 길을 선택하고 괴생물의 추적을 피하세요`;
  ui.modeName.textContent = `${qaMode ? '비교 검사' : modeConfig.label} · 탈출 조건`;
  ui.hudGoal.textContent = `표본 ${REQUIRED_SAMPLES}개 이상 · 경보 4 이하`;
  ui.sampleGoal.textContent = `/ ${REQUIRED_SAMPLES}`;
  ui.rulesSamples.textContent = `표본 ${REQUIRED_SAMPLES}개 이상`;
  ui.rulesDuration.textContent = `${DURATION}초`;
  ui.rulesStartAlert.textContent = String(STARTING_ALERT);
  ui.recapSamples.textContent = `표본 ${REQUIRED_SAMPLES}개 이상`;
  if (reduceMotion) ui.motion.textContent = '움직임 줄이기: 켜짐';
  document.querySelectorAll('[data-chase-value]').forEach(node => { node.textContent = String(CHASE_ALERT); });
  if (qaMode) {
    ui.qaLabel.hidden = false;
    ui.qaLabel.textContent = `비교 ${qaMode === 'before' ? '전' : '후'} · 고정 경로 · 추적 경보 +${CHASE_ALERT}`;
  }
  updateRecord();
  updateHistory();
  startGame();
  if (document.hidden) pauseGame('화면 이탈');
})();
