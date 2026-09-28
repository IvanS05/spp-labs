/**
 * Клиентская часть (SPA): страница загружается один раз, дальше всё меняет этот скрипт.
 *
 * Ключи доступа хранятся в localStorage и уходят на сервер заголовком Authorization.
 * Ключ доступа живёт 15 минут: когда сервер отвечает «срок истёк», скрипт сам
 * меняет его по ключу обновления и повторяет запрос — пользователь этого не замечает.
 */

// Подписи для карточек. Значения те же, что проверяет сервер в validate().
const STATUSES = [
  { value: 'todo', label: 'К выполнению', tone: 'aqua' },
  { value: 'in_progress', label: 'В работе', tone: 'amber' },
  { value: 'done', label: 'Выполнено', tone: 'lime' },
];

const PRIORITIES = [
  { value: 'low', label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high', label: 'Высокий' },
];

const ROLES = [
  { value: 'user', label: 'Пользователь' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'admin', label: 'Администратор' },
];

// ------------------------------------------------------------ элементы DOM

const views = {
  auth: document.getElementById('view-auth'),
  forgot: document.getElementById('view-forgot'),
  reset: document.getElementById('view-reset'),
  list: document.getElementById('view-list'),
  form: document.getElementById('view-form'),
  sessions: document.getElementById('view-sessions'),
  admin: document.getElementById('view-admin'),
};

const notice = document.getElementById('notice');
const message = document.getElementById('message');
const topnav = document.getElementById('topnav');
const navAdmin = document.getElementById('nav-admin');
const who = document.getElementById('who');
const whoEmail = document.getElementById('who-email');
const whoRole = document.getElementById('who-role');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authSwitch = document.getElementById('auth-switch');
const forgotForm = document.getElementById('forgot-form');
const resetForm = document.getElementById('reset-form');
const summary = document.getElementById('summary');
const list = document.getElementById('list');
const form = document.getElementById('form');
const formTitle = document.getElementById('form-title');
const attachments = document.getElementById('attachments');
const files = document.getElementById('files');
const filesCount = document.getElementById('files-count');
const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const sessionList = document.getElementById('sessions');
const userList = document.getElementById('users');
const allSessionList = document.getElementById('all-sessions');

let accessKey = localStorage.getItem('spp.access') || '';
let refreshKey = localStorage.getItem('spp.refresh') || '';
let me = null; // вошедший пользователь: { id, email, role }
let registering = false; // форма входа сейчас работает как регистрация
let resetToken = ''; // ключ из ссылки в письме
let tasks = []; // последний список, полученный от сервера
let editing = null; // задача, открытая в форме; null — создаём новую

// --------------------------------------------------------------- ключи доступа

function saveKeys(data) {
  accessKey = data.accessToken;
  refreshKey = data.refreshToken;
  me = data.user;
  localStorage.setItem('spp.access', accessKey);
  localStorage.setItem('spp.refresh', refreshKey);
}

function forgetKeys() {
  accessKey = '';
  refreshKey = '';
  me = null;
  localStorage.removeItem('spp.access');
  localStorage.removeItem('spp.refresh');
}

/** Меняет истёкший ключ доступа на новый. false — придётся входить заново. */
async function renewKeys() {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshKey }),
  });
  if (!response.ok) {
    forgetKeys();
    showAuth();
    return false;
  }

  saveKeys(await response.json());
  return true;
}

// ------------------------------------------------------------ запросы к API

/**
 * Один запрос к серверу. Возвращает разобранный JSON,
 * а если сервер ответил кодом ошибки — бросает исключение с его текстом.
 */
async function api(method, url, body, retry = true) {
  const options = { method, headers: {} };
  if (accessKey) options.headers.Authorization = `Bearer ${accessKey}`;

  if (body instanceof FormData) {
    // Для multipart заголовок ставит сам браузер: ему нужно дописать туда границу блоков.
    options.body = body;
  } else if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json();

  // Сервер помечает полем expired именно просроченный ключ: его можно обновить и повторить.
  if (response.status === 401 && retry && data?.expired && refreshKey) {
    if (await renewKeys()) return api(method, url, body, false);
  }

  if (!response.ok) {
    const error = new Error(data?.error ?? 'Проверьте заполненные поля');
    error.status = response.status;
    error.fields = data?.errors; // ошибки по отдельным полям формы
    if (response.status === 401) {
      forgetKeys();
      showAuth();
    }
    throw error; // прерывает api
  }
  return data;
}

// ------------------------------------------------------------ вывод сообщений

function clearErrors() {
  notice.hidden = true;
  message.hidden = true;
  for (const box of document.querySelectorAll('[data-error]')) box.hidden = true;
  for (const field of document.querySelectorAll('[data-field]')) field.classList.remove('field--invalid');
}

/**
 * Ошибки по полям сервер присылает объектом { title: 'текст', ... }.
 * Ищем подписи только на видимом экране: поля email и password есть на
 * нескольких формах, и иначе ошибка ушла бы на спрятанную.
 */
function showFieldErrors(fields) {
  const screen = Object.values(views).find((view) => !view.hidden);

  for (const [name, text] of Object.entries(fields)) {
    const box = screen.querySelector(`[data-error="${name}"]`);
    if (!box) continue;
    box.textContent = text;
    box.hidden = false;
    box.closest('[data-field]')?.classList.add('field--invalid');
  }
}

/** Общая реакция на неудачный запрос: либо подписи у полей, либо баннер сверху. */
function showError(error) {
  if (error.fields) {
    showFieldErrors(error.fields);
    return;
  }
  notice.textContent = error.message;
  notice.hidden = false;
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

// --------------------------------------------------------------- мелочи вида

/** Текст пользователя попадает в innerHTML, поэтому спецсимволы обезвреживаем. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]
  ));
}

function labelOf(items, value) {
  return items.find((item) => item.value === value)?.label ?? value;
}

function toneOf(status) {
  return STATUSES.find((item) => item.value === status)?.tone ?? 'ghost';
}

/** «2026-09-20» -> «20.09.2026» */
function formatDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

/** «2026-09-20T10:15:00.000Z» -> «20.09.2026, 13:15» */
function formatMoment(value) {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** 5707577 -> «5.4 МБ» */
function formatBytes(bytes) {
  const units = ['Б', 'КБ', 'МБ'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

// ------------------------------------------------------------ экраны

function setScreen(name) {
  clearErrors();
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  for (const link of topnav.querySelectorAll('.topnav__link')) {
    link.classList.toggle('is-active', link.dataset.screen === name);
  }
}

/** Вид страницы до входа: меню и данные пользователя спрятаны. */
function showAuth() {
  topnav.hidden = true;
  who.hidden = true;
  setScreen('auth');
}

/** Вид страницы после входа. Раздел «Пользователи» показываем только администратору. */
function showApp() {
  topnav.hidden = false;
  who.hidden = false;
  whoEmail.textContent = me.email;
  whoRole.textContent = labelOf(ROLES, me.role);
  navAdmin.hidden = me.role !== 'admin';
}

/** Переход по меню: сначала забираем данные, потом показываем экран. */
async function go(name) {
  clearErrors();

  // "auth" и "forgot" доступны до входа — ключа доступа ещё нет,
  // поэтому запрос за ролью для них не делаем, иначе он сам вернёт 401.
  if (name === 'auth' || name === 'forgot') return setScreen(name);

  try {
    // Роль могли изменить, пока мы работаем, — перечитываем её при каждом переходе.
    me = await api('GET', '/api/auth/me');
    showApp();

    if (name === 'form') return openForm(null);
    if (name === 'list') await loadTasks();
    if (name === 'sessions') await loadSessions();
    if (name === 'admin') await loadAdmin();
    setScreen(name);
  } catch (error) {
    showError(error);
  }
}

for (const button of document.querySelectorAll('[data-screen]')) {
  button.addEventListener('click', () => go(button.dataset.screen));
}

// ------------------------------------------------------------ вход и регистрация

authSwitch.addEventListener('click', () => {
  registering = !registering;
  authTitle.textContent = registering ? 'Регистрация' : 'Вход в систему';
  authSubmit.textContent = registering ? 'Зарегистрироваться' : 'Войти';
  authSwitch.textContent = registering ? 'У меня уже есть аккаунт' : 'Регистрация';
  clearErrors();
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const body = {
    email: authForm.elements.email.value,
    password: authForm.elements.password.value,
  };

  try {
    if (registering) {
      await api('POST', '/api/auth/register', body);
      authSwitch.click(); // возвращаем форму в режим входа
      authForm.reset(); // пароль только что вводили — не оставляем его в поле
      showMessage('Учётная запись создана, теперь войдите');
      return;
    }

    saveKeys(await api('POST', '/api/auth/login', body));
    authForm.reset();
    showApp();
    await go('list');
  } catch (error) {
    showError(error);
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout', { refreshToken: refreshKey }).catch(() => {});
  forgetKeys();
  authForm.reset(); // следующий человек за этим компьютером не должен видеть чужой ввод
  showAuth();
});

// --------------------------------------------------- восстановление доступа

forgotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  try {
    const answer = await api('POST', '/api/auth/forgot', { email: forgotForm.elements.email.value });
    forgotForm.reset();
    setScreen('auth');
    showMessage(answer.message);
  } catch (error) {
    showError(error);
  }
});

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  try {
    await api('POST', '/api/auth/reset', {
      token: resetToken,
      password: resetForm.elements.password.value,
    });
    resetForm.reset();
    history.replaceState(null, '', '/'); // убираем ключ из адресной строки
    showAuth();
    showMessage('Пароль изменён, войдите с новым паролем');
  } catch (error) {
    showError(error);
  }
});

// ------------------------------------------------------------ список задач

/** Чужую задачу удаляет только администратор. */
function canDelete(task) {
  return me.role === 'admin' || task.ownerId === me.id;
}

function cardHtml(task) {
  const done = task.status === 'done';
  const chips = STATUSES.map((status) => `
    <button type="button" class="chip chip--${status.tone}${task.status === status.value ? ' is-current' : ''}"
            data-action="status" data-status="${status.value}" ${task.status === status.value ? 'disabled' : ''}>
      ${status.label}
    </button>`).join('');

  return `
    <article class="card card--${toneOf(task.status)}${done ? ' is-done' : ''}" data-id="${task.id}">
      <div class="card__head">
        <div class="card__title">
          <span class="card__name">${escapeHtml(task.title)}</span>
          <div class="card__badges">
            <span class="badge badge--${toneOf(task.status)}">${labelOf(STATUSES, task.status)}</span>
            <span class="badge badge--priority-${task.priority}">${labelOf(PRIORITIES, task.priority)}</span>
            ${task.attachments.length ? `<span class="badge badge--ghost">файлов: ${task.attachments.length}</span>` : ''}
            ${me.role === 'user' ? '' : `<span class="badge badge--ghost">${escapeHtml(task.ownerEmail ?? '—')}</span>`}
          </div>
        </div>
        <div class="card__due">
          ${task.dueDate
            ? `<span class="due">${formatDate(task.dueDate)}</span>`
            : '<span class="due due--none">без срока</span>'}
        </div>
      </div>

      ${task.description ? `<p class="card__text">${escapeHtml(task.description)}</p>` : ''}

      <div class="card__actions">
        <div class="statusgroup">${chips}</div>
        <div class="card__links">
          <button type="button" class="link" data-action="edit">Изменить</button>
          ${canDelete(task) ? '<button type="button" class="link link--danger" data-action="delete">Удалить</button>' : ''}
        </div>
      </div>
    </article>`;
}

function renderList() {
  summary.textContent = tasks.length > 0 ? `Всего задач: ${tasks.length}` : '';
  list.innerHTML = tasks.length > 0
    ? tasks.map(cardHtml).join('')
    : `<div class="empty">
         <p class="empty__title">Здесь пока пусто</p>
         <p class="empty__text">Создайте первую задачу — она появится в списке без перезагрузки страницы.</p>
       </div>`;
}

async function loadTasks() {
  tasks = await api('GET', '/api/tasks');
  renderList();
}

// Карточки перерисовываются целиком, поэтому слушаем клики на всём списке сразу.
list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const id = button.closest('.card').dataset.id;
  clearErrors();

  try {
    if (button.dataset.action === 'status') {
      await api('PATCH', `/api/tasks/${id}/status`, { status: button.dataset.status });
      await loadTasks();
    }
    if (button.dataset.action === 'edit') {
      openForm(await api('GET', `/api/tasks/${id}`));
    }
    if (button.dataset.action === 'delete') {
      if (!confirm('Удалить задачу вместе с прикреплёнными файлами?')) return;
      await api('DELETE', `/api/tasks/${id}`);
      await loadTasks();
    }
  } catch (error) {
    showError(error);
  }
});

// ------------------------------------------------------------ форма и файлы

function renderFiles() {
  filesCount.textContent = editing.attachments.length;
  files.innerHTML = editing.attachments.map((file) => `
    <li class="file">
      <span class="file__body">
        <!-- Ссылкой файл не забрать: серверу нужен заголовок с ключом, поэтому кнопка -->
        <button type="button" class="file__name link" data-download="${file.id}">
          ${escapeHtml(file.originalName)}
        </button>
        <span class="file__meta">${formatBytes(file.size)}</span>
      </span>
      <button type="button" class="link link--danger" data-file="${file.id}">Удалить</button>
    </li>`).join('');
}

function openForm(task) {
  editing = task;
  formTitle.textContent = task ? 'Редактирование задачи' : 'Новая задача';
  form.elements.title.value = task?.title ?? '';
  form.elements.description.value = task?.description ?? '';
  form.elements.status.value = task?.status ?? 'todo';
  form.elements.priority.value = task?.priority ?? 'normal';
  form.elements.dueDate.value = task?.dueDate ?? '';

  // Прикрепить файл можно только к задаче, которая уже есть в базе.
  attachments.hidden = !task;
  if (task) renderFiles();

  setScreen('form');
}

// Сохранение задачи: данные уходят в JSON.
form.addEventListener('submit', async (event) => {
  event.preventDefault(); // без этой строки браузер отправил бы форму сам и перезагрузил страницу
  clearErrors();

  const body = {
    title: form.elements.title.value,
    description: form.elements.description.value,
    status: form.elements.status.value,
    priority: form.elements.priority.value,
    dueDate: form.elements.dueDate.value,
  };

  try {
    if (editing) await api('PUT', `/api/tasks/${editing.id}`, body);
    else await api('POST', '/api/tasks', body);

    await loadTasks();
    setScreen('list');
  } catch (error) {
    showError(error);
  }
});

// Загрузка файлов: тело запроса — multipart/form-data.
uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const data = new FormData();
  for (const file of fileInput.files) data.append('attachments', file);

  try {
    editing = await api('POST', `/api/tasks/${editing.id}/attachments`, data);
    fileInput.value = ''; // сбрасываем выбор, иначе те же файлы уйдут второй раз
    renderFiles();
    await loadTasks(); // в карточке изменилось число файлов
  } catch (error) {
    showError(error);
  }
});

/** Скачивание: файл забираем запросом с ключом и отдаём браузеру уже готовым. */
async function downloadFile(file) {
  const response = await fetch(`/api/tasks/${editing.id}/attachments/${file.id}`, {
    headers: { Authorization: `Bearer ${accessKey}` },
  });
  if (!response.ok) throw new Error('Не удалось скачать файл');

  const link = document.createElement('a');
  link.href = URL.createObjectURL(await response.blob());
  link.download = file.originalName;
  link.click();
  URL.revokeObjectURL(link.href);
}

files.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-file], [data-download]');
  if (!button) return;
  clearErrors();

  try {
    if (button.dataset.download) {
      await downloadFile(editing.attachments.find((file) => file.id === button.dataset.download));
      return;
    }

    await api('DELETE', `/api/tasks/${editing.id}/attachments/${button.dataset.file}`);
    editing = await api('GET', `/api/tasks/${editing.id}`);
    renderFiles();
    await loadTasks();
  } catch (error) {
    showError(error);
  }
});

// ------------------------------------------------------ активные подключения

function sessionHtml(session) {
  return `
    <article class="card" data-id="${session.id}">
      <div class="card__head">
        <div class="card__title">
          <span class="card__name">${escapeHtml(session.email ?? session.ip)}</span>
          <div class="card__badges">
            ${session.email ? `<span class="badge badge--ghost">${escapeHtml(session.ip)}</span>` : ''}
            ${session.current ? '<span class="badge badge--aqua">текущее</span>' : ''}
          </div>
        </div>
        <div class="card__due">
          <span class="due">до ${formatMoment(session.expiresAt)}</span>
        </div>
      </div>
      <p class="card__text">${escapeHtml(session.userAgent)}</p>
      <div class="card__actions">
        <span class="file__meta">вход ${formatMoment(session.createdAt)}, активность ${formatMoment(session.lastSeenAt)}</span>
        <div class="card__links">
          <button type="button" class="link link--danger" data-close="${session.id}">Закрыть</button>
        </div>
      </div>
    </article>`;
}

async function loadSessions() {
  const items = await api('GET', '/api/auth/sessions');
  sessionList.innerHTML = items.map(sessionHtml).join('');
}

sessionList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-close]');
  if (!button) return;
  clearErrors();

  try {
    await api('DELETE', `/api/auth/sessions/${button.dataset.close}`);
    // Закрыли текущее подключение — ключи больше не действуют.
    if (button.closest('.card').querySelector('.badge--aqua')) {
      forgetKeys();
      showAuth();
      return;
    }
    await loadSessions();
  } catch (error) {
    showError(error);
  }
});

// ------------------------------------------------ пользователи (только admin)

function userHtml(user) {
  const options = ROLES.map((role) => `
    <option value="${role.value}" ${user.role === role.value ? 'selected' : ''}>${role.label}</option>`).join('');

  return `
    <article class="card" data-id="${user.id}">
      <div class="card__head">
        <div class="card__title">
          <span class="card__name">${escapeHtml(user.email)}</span>
        </div>
        <div class="card__links">
          <select class="role" data-role="${user.id}" ${user.id === me.id ? 'disabled' : ''}>${options}</select>
        </div>
      </div>
    </article>`;
}

async function loadAdmin() {
  const [people, items] = await Promise.all([
    api('GET', '/api/admin/users'),
    api('GET', '/api/admin/sessions'),
  ]);
  userList.innerHTML = people.map(userHtml).join('');
  allSessionList.innerHTML = items.map(sessionHtml).join('');
}

// Роль меняется сразу при выборе в списке.
userList.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-role]');
  if (!select) return;
  clearErrors();

  try {
    await api('PATCH', `/api/admin/users/${select.dataset.role}/role`, { role: select.value });
    showMessage('Роль изменена');
  } catch (error) {
    showError(error);
    await loadAdmin(); // возвращаем список в то состояние, которое на сервере
  }
});

allSessionList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-close]');
  if (!button) return;
  clearErrors();

  try {
    await api('DELETE', `/api/admin/sessions/${button.dataset.close}`);
    await loadAdmin();
  } catch (error) {
    showError(error);
  }
});

// ------------------------------------------------------------------- запуск

const resetFromLink = new URLSearchParams(location.search).get('reset');

if (resetFromLink) {
  // Пришли по ссылке из письма — показываем форму нового пароля.
  resetToken = resetFromLink;
  setScreen('reset');
} else if (accessKey) {
  // Ключ сохранён с прошлого раза: проверяем, что он ещё живой.
  api('GET', '/api/auth/me')
    .then((user) => {
      me = user;
      showApp();
      return go('list');
    })
    .catch(() => showAuth());
} else {
  showAuth();
}
