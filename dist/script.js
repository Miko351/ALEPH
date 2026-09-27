function setExpanded(button, expanded) {
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (!panel) return;
  button.setAttribute('aria-expanded', String(expanded));
  panel.hidden = !expanded;
  const symbol = button.querySelector('.reveal-symbol');
  if (symbol) symbol.textContent = expanded ? '−' : '＋';
}

const evidenceButtons = [...document.querySelectorAll('.evidence-actions button[aria-controls]')];

function openEvidence(button) {
  evidenceButtons.forEach((candidate) => setExpanded(candidate, candidate === button));
}

document.querySelectorAll('button[aria-controls]').forEach((button) => {
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    if (expanded && evidenceButtons.includes(button)) openEvidence(button);
    else setExpanded(button, expanded);
  });
});

function revealEvidence(target, moveFocus) {
  const panel = target?.closest('.project-detail');
  if (!panel) return;
  const button = evidenceButtons.find((candidate) => candidate.getAttribute('aria-controls') === panel.id);
  if (!button) return;
  openEvidence(button);
  if (moveFocus) target.focus({ preventScroll: true });
}

document.querySelectorAll('.story-link[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => {
    revealEvidence(document.getElementById(link.hash.slice(1)), true);
  });
});

if (location.hash) revealEvidence(document.getElementById(location.hash.slice(1)), false);
window.addEventListener('hashchange', () => {
  if (location.hash) revealEvidence(document.getElementById(location.hash.slice(1)), false);
});
