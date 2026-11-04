const periods = [
  { label: '2024년 전체', scale: '전체', year: 2024, size: 0.858, regions: 17 },
  { label: '2025년 전체', scale: '전체', year: 2025, size: 0.846, growth: 0.211, regions: 17 },
  { label: '2024년 1~9월', scale: '1~9월', year: 2024, size: 0.839, regions: 15 },
  { label: '2025년 1~9월', scale: '1~9월', year: 2025, size: 0.825, growth: 0.111, regions: 15 },
  { label: '2026년 1~9월', scale: '1~9월', year: 2026, size: 0.882, growth: 0.218, regions: 15 },
];

// 기간 순서대로 외지인 방문(만 건)과 관광소비(억 원)를 담은 가상 사례.
const examples = {
  '가람시': [[120, 210], [132, 214], [87, 154], [96, 157], [112, 153]],
  '나래시': [[75, 130], [79, 150], [54, 91], [57, 105], [58, 117]],
  '마루시': [[96, 170], [91, 168], [71, 123], [68, 121], [74, 126]],
};
const element = id => document.getElementById(id);
const form = element('compare');
const first = element('first');
const second = element('second');
const period = element('period');
const results = element('results');
const error = element('error');
const growth = form.querySelector('[value="growth"]');
const number = new Intl.NumberFormat('ko-KR');
const percent = new Intl.NumberFormat('ko-KR', {
  style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
});

for (const name of Object.keys(examples)) {
  first.add(new Option(name, name));
  second.add(new Option(name, name));
}
second.selectedIndex = 1;
periods.forEach((item, index) => period.add(new Option(item.label, String(index))));
period.value = '4';

function render() {
  const index = Number(period.value);
  const selection = periods[index];
  const names = [first.value, second.value];
  const previous = selection
    ? periods.findIndex(item => item.scale === selection.scale && item.year === selection.year - 1)
    : -1;
  growth.disabled = previous < 0;
  if (growth.disabled && growth.checked) {
    growth.checked = false;
    form.querySelector('[value="size"]').checked = true;
  }

  const valid = period.value !== '' && selection && names.every(name => Object.hasOwn(examples, name));
  const duplicate = names[0] === names[1];
  results.hidden = !valid || duplicate;
  error.hidden = !results.hidden;
  if (results.hidden) {
    error.textContent = duplicate ? '서로 다른 지역 두 곳을 선택해 주세요.' : '지역과 기간을 다시 선택해 주세요.';
    return;
  }

  const isGrowth = growth.checked;
  const rows = names.map(name => examples[name][index].map((value, metric) => {
    if (!isGrowth) return value;
    const baseline = examples[name][previous][metric];
    return (value - baseline) / baseline;
  }));
  element('result-title').textContent = isGrowth
    ? periods[previous].label + ' → ' + selection.label
    : selection.label + ' 규모';
  element('visits-label').textContent = isGrowth ? '방문 증가율' : '방문 (만 건)';
  element('spend-label').textContent = isGrowth ? '관광소비 증가율' : '관광소비 (억 원)';
  const formatter = isGrowth ? percent : number;
  element('values').replaceChildren(...rows.map((row, index) => {
    const tr = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = names[index];
    tr.append(heading);
    for (const value of row) {
      const cell = document.createElement('td');
      cell.textContent = formatter.format(value);
      tr.append(cell);
    }
    return tr;
  }));
  const describe = (metric, label) => {
    const difference = rows[0][metric] - rows[1][metric];
    if (difference === 0) return label + '은 두 지역이 같습니다.';
    return label + '은 ' + names[difference > 0 ? 0 : 1] + '가 더 높습니다.';
  };
  element('comparison').textContent = describe(0, isGrowth ? '방문 증가율' : '방문 규모')
    + ' ' + describe(1, isGrowth ? '관광소비 증가율' : '관광소비 규모');
  element('research').textContent = isGrowth
    ? '논문에서 방문 증가율과 관광소비 증가율의 관계는 약했습니다. 증가율은 전년의 같은 기간을 기준으로 계산합니다.'
    : '논문에서는 방문 규모가 큰 지역일수록 관광소비 규모도 큰 경향이 있었습니다. 두 지표의 지역별 순위는 다를 수 있습니다.'
      + (previous < 0 ? ' 이 기간은 전년 자료가 없어 증가율을 비교할 수 없습니다.' : '');
  const coefficient = isGrowth ? selection.growth : selection.size;
  const table = isGrowth ? '표 5' : (selection.scale === '전체' ? '표 1' : '표 3');
  element('research-source').textContent = '과제 10 논문 ' + table + ' · '
    + selection.regions + '개 지역의 순위상관 ' + coefficient.toFixed(3);
}
form.addEventListener('change', render);
render();
