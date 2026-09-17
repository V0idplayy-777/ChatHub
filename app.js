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

function showError(msg) {
  const el = document.getElementById('error');
  if (el) el.textContent = msg || '';
}

function renderAuth() {
  const signup = mode === 'signup';
  app.innerHTML = `<main class="login"><section class="card">
    <div class="brand">ChatHub</div>
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p>${signup ? 'Make an account to save groups.' : 'Sign in to continue.'}</p>
    ${signup ? '<div class="field"><label>Name</label><input id="name" maxlength="40" autocomplete="name"></div>' : ''}
    <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email"></div>
    <div class="field"><label>Password</label><input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
    <div class="error" id="error"></div>
    <button class="primary" id="actionBtn">${signup ? 'Create account' : 'Sign in'}</button>
    <button class="linkbtn" id="toggleMode">${signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
  </section></main>`;

  document.getElementById('actionBtn').onclick = signup ? doSignup : doLogin;
  document.getElementById('toggleMode').onclick = () => {
    mode = signup ? 'login' : 'signup';
    renderAuth();
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function doLogin() {
  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await boot();
  } catch (e) {
    showError(e.message);
  }
}

async function doSignup() {
  try {
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (name.length < 2 || name.length > 40) throw new Error('Name must be 2–40 characters.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    if (error) throw error;
    if (!data.session) {
      mode = 'login';
      renderAuth();
      showError('Account created. Check your email to confirm, then sign in.');
      return;
    }
    await boot();
  } catch (e) {
    showError(e.message);
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

    me = profile;
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
      <span class="userlabel">${esc(me.name)}</span>
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
          ${(data || []).map(u => `
          <div class="userrow">
            <div>
              <b>${esc(u.name)}</b> <span class="role ${u.is_admin ? 'admin' : ''}">${u.is_admin ? 'admin' : 'user'}</span>
              <div class="small">${esc(u.email)} · ${u.banned ? 'BANNED' : ''}</div>
            </div>
            <div class="actions">
              <button class="${u.is_admin ? 'demote' : 'promote'}" data-id="${u.id}" data-admin="${!u.is_admin}">${u.is_admin ? 'Remove admin' : 'Promote admin'}</button>
              <button class="${u.banned ? 'unban' : 'ban'}" data-id="${u.id}" data-ban="${!u.banned}">${u.banned ? 'Unban' : 'Ban'}</button>
            </div>
          </div>`).join('')}
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
