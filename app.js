import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const app = document.getElementById('app');

const SUPABASE_URL = 'https://uvzcejnzaiiomqppeqcr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2emNlam56YWlpb21xcHBlcWNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTI2NTcsImV4cCI6MjEwMzM4ODY1N30.0e1xFT3aEnH7akjL2MvKmamgC-9vwE-45bkY1Q5B95U';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let me = null;
let groups = [];
let currentId = null;
let adminMessages = [];
let mode = 'login';

// Accounts are username + password only — no email address is ever collected,
// shown or mailed. Supabase Auth still needs an email-shaped identifier, so we
// derive a private one from the username. That domain is not a real mailbox and
// nothing is ever sent to it (email confirmation must stay OFF in the project).
const USERNAME_DOMAIN = 'chathub.local';

function showError(msg) {
  const el = document.getElementById('error');
  if (el) el.textContent = msg || '';
}

function byId(id) {
  return document.getElementById(id);
}

function normalizeUsername(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/^@/, '');
}

function validateUsername(username) {
  if (username.length < 3 || username.length > 20) return 'Username must be 3–20 characters.';
  if (!/^[a-z0-9_.]+$/.test(username)) return 'Username can only use letters, numbers, dots and underscores.';
  if (!/^[a-z0-9]/.test(username) || !/[a-z0-9]$/.test(username)) return 'Username must start and end with a letter or number.';
  if (username.includes('..')) return 'Username cannot contain two dots in a row.';
  return null;
}

function usernameToEmail(username) {
  return `${username}@${USERNAME_DOMAIN}`;
}

// "kai@chathub.local" -> "kai"; a legacy real address is returned untouched.
function handleFromEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  const suffix = `@${USERNAME_DOMAIN}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

// Names written before this change (or by a DB trigger that copies the auth
// email) can hold an address instead of a username — never show one.
function displayLabel(name, username) {
  const value = String(name ?? '').trim();
  return !value || value.includes('@') ? username : value;
}

function friendlyAuthError(error) {
  const msg = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  if (code === 'user_already_exists' || msg.includes('already registered') || msg.includes('already been registered')) {
    return new Error('That username is already taken. Try another one.');
  }
  if (msg.includes('invalid login credentials') || msg.includes('email not confirmed') || msg.includes('user not found')) {
    return new Error('Wrong username or password.');
  }
  if (msg.includes('password should be at least')) {
    return new Error('Password must be at least 6 characters.');
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return new Error('Too many attempts. Wait a minute and try again.');
  }
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) {
    return new Error('That username is not valid.');
  }
  return error instanceof Error ? error : new Error(error?.message || 'Something went wrong.');
}

// Username sign-up only works while email confirmation is disabled on the
// project. Check first so we fail with a clear message instead of silently
// creating an unconfirmed account nobody can ever sign in to. A positive answer
// is cached; a negative one is re-checked so the very next attempt succeeds
// after the switch is flipped, with no page reload needed.
let autoConfirmOk = false;
async function requireAutoConfirm() {
  if (autoConfirmOk) return;
  let confirmedOff = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY }
    });
    if (res.ok) {
      const settings = await res.json();
      if (typeof settings.mailer_autoconfirm === 'boolean') confirmedOff = settings.mailer_autoconfirm;
    }
  } catch (_) {
    // Settings unreachable (offline / CORS): fall through and let signUp decide.
  }
  if (confirmedOff === true) {
    autoConfirmOk = true;
    return;
  }
  if (confirmedOff === false) {
    throw new Error('Username sign-up is not switched on yet: in Supabase, go to Authentication → Sign In / Providers → Email and turn "Confirm email" OFF.');
  }
}

function renderAuth() {
  const signup = mode === 'signup';
  app.innerHTML = `<main class="login"><section class="card">
    <div class="brand">ChatHub</div>
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p>${signup ? 'Pick a username and password — no email needed.' : 'Sign in with your username.'}</p>
    <div class="field"><label for="username">Username</label><input id="username" maxlength="20" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="${signup ? 'e.g. kai_99' : 'your username'}"></div>
    <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'At least 6 characters' : '••••••••'}"></div>
    <div class="error" id="error"></div>
    <button class="primary" id="actionBtn">${signup ? 'Create account' : 'Sign in'}</button>
    <button class="linkbtn" id="toggleMode">${signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
    ${signup ? '<div class="hint">No email, no verification link. Remember your password — there is no reset link.</div>' : ''}
  </section></main>`;

  byId('actionBtn').onclick = signup ? doSignup : doLogin;
  byId('toggleMode').onclick = () => {
    mode = signup ? 'login' : 'signup';
    renderAuth();
  };
  [byId('username'), byId('password')].forEach(input => {
    input.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (signup ? doSignup : doLogin)();
      }
    };
  });
  byId('username').focus();
}

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel || 'Working…';
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function doLogin() {
  const button = byId('actionBtn');
  try {
    const raw = byId('username').value.trim();
    const password = byId('password').value;
    if (!raw) throw new Error('Enter your username.');
    if (!password) throw new Error('Enter your password.');

    // Accounts created before the switch to usernames used a real email address,
    // so accept either form on sign-in.
    const identifier = raw.includes('@') ? raw.toLowerCase() : usernameToEmail(normalizeUsername(raw));

    setBusy(button, true, 'Signing in…');
    const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });
    if (error) throw friendlyAuthError(error);
    await boot();
  } catch (e) {
    showError(e.message);
  } finally {
    setBusy(button, false);
  }
}

async function doSignup() {
  const button = byId('actionBtn');
  try {
    const username = normalizeUsername(byId('username').value);
    const password = byId('password').value;

    const problem = validateUsername(username);
    if (problem) throw new Error(problem);
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');

    setBusy(button, true, 'Creating account…');
    await requireAutoConfirm();

    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
      options: { data: { name: username, username } }
    });
    if (error) throw friendlyAuthError(error);

    if (!data.session) {
      // Only reachable if email confirmation is still enabled on the project.
      mode = 'login';
      renderAuth();
      showError('That username is still waiting on email confirmation. Turn "Confirm email" OFF in Supabase (Authentication → Sign In / Providers → Email) and sign up again.');
      return;
    }

    await boot();
  } catch (e) {
    showError(e.message);
  } finally {
    setBusy(button, false);
  }
}

async function logout() {
  await supabase.auth.signOut();
  me = null;
  groups = [];
  currentId = null;
  mode = 'login';
  renderAuth();
}

async function boot() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      renderAuth();
      return;
    }

    const { data: profile, error } = await supabase
      .from('accounts')
      .select('id,name,email,is_admin,banned')
      .eq('id', user.id)
      .single();

    if (error || !profile || profile.banned) {
      await supabase.auth.signOut();
      mode = 'login';
      renderAuth();
      showError(profile?.banned ? 'Your account is banned.' : 'Your profile could not be loaded.');
      return;
    }

    const handle = handleFromEmail(profile.email);
    const legacy = handle.includes('@'); // pre-username account, created with a real email
    const username = legacy
      ? normalizeUsername(profile.name || handle.split('@')[0])
      : handle;

    me = {
      ...profile,
      username,
      legacy,
      name: displayLabel(profile.name, username)
    };
    await loadgroups();
    render();
  } catch (e) {
    mode = 'login';
    renderAuth();
    showError(e.message);
  }
}

async function loadgroups() {
  const { data, error } = await supabase
    .from('groups')
    .select('id,title,messages,created_at')
    .eq('user_id', me.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  groups = data || [];

  if (!groups.length) {
    const { data: chat, error: createError } = await supabase
      .from('groups')
      .insert({ user_id: me.id, title: 'New chat', messages: [] })
      .select('id,title,messages,created_at')
      .single();
    if (createError) throw createError;
    groups = [chat];
  }
  currentId = currentId || groups[0].id;
}

function render() {
  app.innerHTML = `<div class="app">
    <header class="top">
      <div class="logo">ChatHub</div>
      <div class="spacer"></div>
      <span class="userlabel">${me.legacy ? esc(me.name) : '@' + esc(me.username)}</span>
      ${me.is_admin ? '<button class="adminbtn" id="adminBtn">⚙ Admin Panel</button>' : ''}
      <button class="logout" id="logoutBtn">Log out</button>
    </header>
    <div class="body">
      <aside class="side">
        <button class="new" id="newChatBtn">＋ New chat</button>
        <div class="history" id="history"></div>
      </aside>
      <main class="main">
        <div class="msgs" id="msgs"></div>
        <div class="composer">
          <div class="compose">
            <textarea id="input" placeholder="Message ChatHub..."></textarea>
            <button class="send" id="sendBtn">↑</button>
          </div>
        </div>
      </main>
    </div>
  </div>`;

  document.getElementById('logoutBtn').onclick = logout;
  if (me.is_admin) document.getElementById('adminBtn').onclick = adminPanel;
  document.getElementById('newChatBtn').onclick = newChat;
  document.getElementById('sendBtn').onclick = send;
  document.getElementById('input').onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const history = document.getElementById('history');
  history.innerHTML = groups.map(c =>
    `<div class="item ${c.id === currentId ? 'selected' : ''}" data-id="${c.id}">${esc(c.title)}</div>`
  ).join('');
  history.querySelectorAll('.item').forEach(el => {
    el.onclick = () => {
      currentId = el.dataset.id;
      update();
      history.querySelectorAll('.item').forEach(i => i.classList.toggle('selected', i.dataset.id === currentId));
    };
  });

  update();
}

function update() {
  const c = groups.find(x => x.id === currentId) || groups[0];
  if (!c) return;
  currentId = c.id;
  const msgs = document.getElementById('msgs');
  if (!msgs) return;
  msgs.innerHTML = c.messages?.length
    ? c.messages.map(m => `<div class="msg ${m.role}">
        <div class="av">${m.role === 'user' ? 'You' : 'AI'}</div>
        <div class="bubble">${esc(m.text)}</div>
      </div>`).join('')
    : '<div class="welcome"><h1>How can I help?</h1><p>Ask anything.</p></div>';
  msgs.scrollTop = msgs.scrollHeight;
}

async function saveChat(chat) {
  const { error } = await supabase
    .from('groups')
    .update({ title: chat.title, messages: chat.messages })
    .eq('id', chat.id)
    .eq('user_id', me.id);
  if (error) throw error;
}

async function newChat() {
  const { data, error } = await supabase
    .from('groups')
    .insert({ user_id: me.id, title: 'New chat', messages: [] })
    .select('id,title,messages,created_at')
    .single();
  if (error) return alert(error.message);
  groups.unshift(data);
  currentId = data.id;
  render();
}

async function send() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const c = groups.find(x => x.id === currentId);
  c.messages = c.messages || [];
  c.messages.push({ role: 'user', text, at: new Date().toISOString() });
  if (c.title === 'New chat') c.title = text.slice(0, 40);
  update();

  input.disabled = true;

  try {
    const history = c.messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    }));

    const { data, error } = await supabase.functions.invoke('groq-chat', {
      body: { messages: history }
    });
    if (error) throw error;

    c.messages.push({
      role: 'assistant',
      text: data.answer || 'I could not generate a response.',
      at: new Date().toISOString()
    });
    await saveChat(c);
    update();
  } catch (e) {
    c.messages.push({ role: 'assistant', text: `Error: ${e.message}` });
    update();
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function adminPanel() {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('id,name,email,is_admin,banned,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    app.innerHTML = `<div class="app">
      <header class="top"><div class="logo">ChatHub</div><div class="spacer"></div><strong>ADMIN</strong>
      <button class="back" id="toAdminChat">Admin Chat</button>
      <button class="back" id="toChat">Chat</button>
      <button class="logout" id="logoutBtn">Log out</button></header>
      <section class="admin"><h1>Users</h1>
        <div class="panel">
          ${(data || []).map(u => {
            const handle = handleFromEmail(u.email);
            return `
          <div class="userrow">
            <div>
              <b>${esc(displayLabel(u.name, handle))}</b> <span class="role ${u.is_admin ? 'admin' : ''}">${u.is_admin ? 'admin' : 'user'}</span>
              <div class="small">${handle.includes('@') ? esc(handle) : '@' + esc(handle)}${u.banned ? ' · BANNED' : ''}</div>
            </div>
            <div class="actions">
              <button class="${u.is_admin ? 'demote' : 'promote'}" data-id="${u.id}" data-admin="${!u.is_admin}">${u.is_admin ? 'Remove admin' : 'Promote admin'}</button>
              <button class="${u.banned ? 'unban' : 'ban'}" data-id="${u.id}" data-ban="${!u.banned}">${u.banned ? 'Unban' : 'Ban'}</button>
            </div>
          </div>`;
          }).join('')}
        </div>
      </section>
    </div>`;

    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('toChat').onclick = render;
    document.getElementById('toAdminChat').onclick = adminChat;

    document.querySelectorAll('[data-admin]').forEach(btn => {
      btn.onclick = () => toggleAdmin(btn.dataset.id, btn.dataset.admin === 'true');
    });
    document.querySelectorAll('[data-ban]').forEach(btn => {
      btn.onclick = () => toggleBan(btn.dataset.id, btn.dataset.ban === 'true');
    });
  } catch (e) {
    alert(e.message);
  }
}

async function toggleAdmin(id, value) {
  const { error } = await supabase.from('accounts').update({ is_admin: value }).eq('id', id);
  if (error) alert(error.message);
  else adminPanel();
}

async function toggleBan(id, value) {
  const { error } = await supabase.from('accounts').update({ banned: value }).eq('id', id);
  if (error) alert(error.message);
  else adminPanel();
}

async function adminChat() {
  try {
    const { data, error } = await supabase
      .from('admin_messages')
      .select('id,name,text,created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    adminMessages = data || [];

    app.innerHTML = `<div class="app">
      <header class="top"><div class="logo">ChatHub</div><div class="spacer"></div><strong>ADMIN</strong>
      <button class="back" id="toUsers">Users</button>
      <button class="back" id="toChat">Chat</button>
      <button class="logout" id="logoutBtn">Log out</button></header>
      <section class="admin"><h1>Admin Chat</h1>
        <div class="panel adminchat">
          <div class="adminmsgs">${adminMessages.length ? adminMessages.map(m => `
            <div class="msg"><div class="av">A</div><div class="bubble"><b>${esc(m.name)}</b><br>${esc(m.text)}</div></div>
          `).join('') : '<p class="small">No messages yet.</p>'}</div>
          <div class="admincompose">
            <input id="admininput" placeholder="Message the admin team...">
            <button class="adminsend" id="adminSend">Send</button>
          </div>
        </div>
      </section>
    </div>`;

    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('toUsers').onclick = adminPanel;
    document.getElementById('toChat').onclick = render;
    document.getElementById('adminSend').onclick = sendAdmin;
    document.getElementById('admininput').onkeydown = e => {
      if (e.key === 'Enter') sendAdmin();
    };
  } catch (e) {
    alert(e.message);
  }
}

async function sendAdmin() {
  const admininput = document.getElementById('admininput');
  const text = admininput.value.trim();
  if (!text) return;
  const { error } = await supabase.from('admin_messages').insert({ user_id: me.id, name: me.name, text });
  if (error) alert(error.message);
  else adminChat();
}

// Init - show auth immediately, then handle session
renderAuth();

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session && me) {
    me = null;
    groups = [];
    currentId = null;
    mode = 'login';
    renderAuth();
  }
});

supabase.auth.getSession().then(({ data }) => {
  if (data.session) {
    boot().catch(e => {
      mode = 'login';
      renderAuth();
      showError(e.message);
    });
  }
}).catch(e => {
  showError(e.message);
});
