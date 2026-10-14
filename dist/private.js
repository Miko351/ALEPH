const feedback = document.getElementById('feedback');
const authPanel = document.getElementById('auth-panel');
const unlockedPanel = document.getElementById('unlocked-panel');
const noteList = document.getElementById('note-list');
const passkeyList = document.getElementById('passkey-list');
const { startRegistration, startAuthentication, browserSupportsWebAuthn } = window.SimpleWebAuthnBrowser || {};

function message(value, isError = false) {
  feedback.textContent = value;
  feedback.classList.toggle('error', isError);
}

async function api(action, data = {}, method = 'POST') {
  const url = method === 'GET' ? `/api/passkey?action=${encodeURIComponent(action)}` : '/api/passkey';
  const response = await fetch(url, {
    method, credentials: 'same-origin', cache: 'no-store',
    ...(method === 'POST' ? {
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, data }),
    } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `요청 실패 (${response.status})`);
  return result;
}

function showLocked() {
  authPanel.hidden = false;
  unlockedPanel.hidden = true;
  noteList.replaceChildren();
  passkeyList.replaceChildren();
  document.getElementById('account-label').textContent = '';
}

function makeNoteCard(note) {
  const article = document.createElement('article');
  article.className = 'note-card';
  const title = document.createElement('h3');
  title.textContent = note.title;
  const label = document.createElement('label');
  const fieldId = `note-${note.id}`;
  label.htmlFor = fieldId;
  label.textContent = '내 메모';
  const textarea = document.createElement('textarea');
  textarea.id = fieldId;
  textarea.maxLength = 1000;
  textarea.value = note.content;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = '변경 저장';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api('update-note', { id: note.id, content: textarea.value });
      message('내 메모를 저장했습니다.');
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  article.append(title, label, textarea, button);
  return article;
}

function makePasskeyItem(passkey, count) {
  const item = document.createElement('li');
  const detail = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = passkey.name;
  const date = document.createElement('small');
  date.textContent = `등록: ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(passkey.created_at))}`;
  detail.append(name, date);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = '삭제';
  button.disabled = count < 2;
  if (count < 2) button.title = '마지막 패스키는 삭제할 수 없습니다.';
  button.addEventListener('click', async () => {
    if (!window.confirm(`‘${passkey.name}’ 패스키를 삭제할까요?`)) return;
    button.disabled = true;
    try {
      await api('delete-passkey', { id: passkey.id });
      await refreshPasskeys();
      message('패스키를 삭제했습니다. 남은 패스키로 로그인할 수 있습니다.');
    } catch (error) {
      message(error.message, true);
      button.disabled = false;
    }
  });
  item.append(detail, button);
  return item;
}

async function refreshPasskeys() {
  const { passkeys } = await api('passkeys', {}, 'GET');
  passkeyList.replaceChildren(...passkeys.map((passkey) => makePasskeyItem(passkey, passkeys.length)));
}

async function showUnlocked() {
  const { username, notes } = await api('private', {}, 'GET');
  authPanel.hidden = true;
  unlockedPanel.hidden = false;
  document.getElementById('account-label').textContent = `${username} 계정의 내용만 표시합니다.`;
  noteList.replaceChildren(...notes.map(makeNoteCard));
  await refreshPasskeys();
}

async function cancelChallenge(challengeId) {
  if (!challengeId) return;
  await api('cancel-challenge', { challengeId }).catch(() => {});
}

function browserReady() {
  if (!window.isSecureContext || !browserSupportsWebAuthn?.()) {
    throw new Error('패스키를 지원하는 브라우저에서 HTTPS 또는 localhost 주소로 열어 주세요.');
  }
}

async function register(mode, data) {
  browserReady();
  let challengeId;
  try {
    const start = await api('registration-options', { mode, ...data });
    challengeId = start.challengeId;
    const response = await startRegistration({ optionsJSON: start.options });
    const notes = mode === 'new' ? [data.noteProject, data.noteTarget, data.noteReflection] : undefined;
    await api('registration-verify', { mode, challengeId, response, notes });
    challengeId = null;
    await showUnlocked();
    message(mode === 'add' ? '새 패스키를 등록했습니다.' : '패스키 등록을 마쳤습니다. 비공개 자리가 열렸습니다.');
  } catch (error) {
    await cancelChallenge(challengeId);
    if (error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || error.name === 'InvalidStateError') {
      throw new Error('이 저장 수단에는 이미 패스키가 등록되어 있습니다. 휴대폰이나 보안 키 등 다른 저장 수단을 선택해 주세요.');
    }
    if (error.name === 'NotAllowedError') throw new Error('패스키 등록을 취소했습니다. 계정과 패스키는 저장되지 않았습니다.');
    throw error;
  }
}

async function authenticate(username) {
  browserReady();
  let challengeId;
  try {
    const start = await api('authentication-options', { username });
    challengeId = start.challengeId;
    const response = await startAuthentication({ optionsJSON: start.options });
    await api('authentication-verify', { challengeId, response });
    challengeId = null;
    await showUnlocked();
    message('패스키 로그인에 성공했습니다.');
  } catch (error) {
    await cancelChallenge(challengeId);
    if (error.name === 'NotAllowedError') throw new Error('패스키 로그인을 취소했습니다.');
    throw error;
  }
}

function onSubmit(formId, action) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message('기기의 패스키 확인을 기다리는 중입니다…');
    try {
      await action(Object.fromEntries(new FormData(form)));
      form.reset();
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

onSubmit('register-form', (data) => register('new', data));
onSubmit('add-passkey-form', (data) => register('add', data));
onSubmit('login-form', (data) => authenticate(data.username));

document.getElementById('logout-button').addEventListener('click', async () => {
  try {
    await api('logout');
    showLocked();
    message('로그아웃했습니다. 같은 세션으로 비공개 자료를 다시 열 수 없습니다.');
  } catch (error) {
    message(error.message, true);
  }
});

api('status', {}, 'GET').then(async ({ authenticated }) => {
  if (authenticated) await showUnlocked();
  else showLocked();
}).catch((error) => {
  showLocked();
  message(error.message, true);
});
