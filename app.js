const app = document.getElementById('app');

const SUPABASE_URL = 'https://uvzcejnzaiiomqppeqcr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2emNlam56YWlpb21xcHBlcWNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MTI2NTcsImV4cCI6MjEwMzM4ODY1N30.0e1xFT3aEnH7akjL2MvKmamgC-9vwE-45bkY1Q5B95U';

let supabase = null;
let me = null;
let groups = [];
let currentId = null;
let adminMessages = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function authScreen(mode = 'login', error = '') {
  const signup = mode === 'signup';
  app.innerHTML = `<main class="login"><section class="card">
    <div class="brand">ChatHub</div>
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p>${signup ? 'Make an account to save groups.' : 'Sign in to continue.'}</p>
    ${signup ? '<div class="field"><label>Name</label><input id="name" maxlength="40" autocomplete="name"></div>' : ''}
    <div class="field"><label>Email</label><input id="email" type="email" autocomplete="email"></div>
    <div class="field"><label>Password</label><input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
    <div class="error">${esc(error)}</div>
    <button class="primary" onclick="${signup ? 'signup()' : 'login()'}">${signup ? 'Create account' : 'Sign in'}</button>
    <button class="linkbtn" onclick="authScreen('${signup ? 'login' : 'signup'}')">${signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
  </section></main>`;
}

async function login() {
  try {
    if (!supabase) throw new Error('Supabase failed to load.');
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await boot();
  } catch (e) {
    authScreen('login', e.message);
  }
}

async function signup() {
  try {
    if (!supabase) throw new Error('Supabase failed to load.');
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
      authScreen('login', 'Account created. Check your email to confirm the account, then sign in.');
      return;
    }
    await boot();
  } catch (e) {
    authScreen('signup', e.message);
  }
}

async function logout() {
  if (supabase) await supabase.auth.signOut();
  me = null;
  groups = [];
  currentId = null;
  authScreen();
}

async function boot() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    authScreen();
    return;
  }

  const { data: profile, error } = await supabase
    .from('accounts')
    .select('id,name,email,is_admin,banned')
    .eq('id', user.id)
    .single();

  if (error || !profile || profile.banned) {
    await supabase.auth.signOut();
    authScreen('login', profile?.banned ? 'Your account is banned.' : 'Your profile could not be loaded.');
    return;
  }

  me = profile;
  await loadgroups();
  render();
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
      ${me.is_admin ? '<button class="adminbtn" onclick="adminPanel()">⚙ Admin Panel</button>' : ''}
      <button class="logout" onclick="logout()">Log out</button>
    </header>
    <div class="body">
      <aside class="side">
        <button class="new" onclick="newChat()">＋ New chat</button>
        <div class="history">${groups.map(c => `
          <div class="item ${c.id === currentId ? 'selected' : ''}" onclick="selectChat('${c.id}')">${esc(c.title)}</div>
        `).join('')}</div>
      </aside>
      <main class="main">
        <div class="msgs" id="msgs"></div>
        <div class="composer">
          <div class="compose">
            <textarea id="input" placeholder="Message ChatHub..." onkeydown="key(event)"></textarea>
            <button class="send" onclick="send()">↑</button>
          </div>
        </div>
      </main>
    </div>
  </div>`;
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

function selectChat(id) {
  currentId = id;
  update();
}

function key(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
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
      <button class="back" onclick="adminChat()">Admin Chat</button>
      <button class="back" onclick="render()">Chat</button>
      <button class="logout" onclick="logout()">Log out</button></header>
      <section class="admin"><h1>Users</h1>
        <div class="panel">
          ${(data || []).map(u => `
          <div class="userrow">
            <div>
              <b>${esc(u.name)}</b> <span class="role ${u.is_admin ? 'admin' : ''}">${u.is_admin ? 'admin' : 'user'}</span>
              <div class="small">${esc(u.email)} · ${u.banned ? 'BANNED' : ''}</div>
            </div>
            <div class="actions">
              <button class="${u.is_admin ? 'demote' : 'promote'}" onclick="toggleAdmin('${u.id}',${!u.is_admin})">${u.is_admin ? 'Remove admin' : 'Promote admin'}</button>
              <button class="${u.banned ? 'unban' : 'ban'}" onclick="toggleBan('${u.id}',${!u.banned})">${u.banned ? 'Unban' : 'Ban'}</button>
            </div>
          </div>`).join('')}
        </div>
      </section>
    </div>`;
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
      <button class="back" onclick="adminPanel()">Users</button><button class="back" onclick="render()">Chat</button>
      <button class="logout" onclick="logout()">Log out</button></header>
      <section class="admin"><h1>Admin Chat</h1>
        <div class="panel adminchat">
          <div class="adminmsgs">${adminMessages.length ? adminMessages.map(m => `
            <div class="msg"><div class="av">A</div><div class="bubble"><b>${esc(m.name)}</b><br>${esc(m.text)}</div></div>
          `).join('') : '<p class="small">No messages yet.</p>'}</div>
          <div class="admincompose"><input id="admininput" placeholder="Message the admin team..." onkeydown="if(event.key==='Enter')sendAdmin()">
          <button class="adminsend" onclick="sendAdmin()">Send</button></div>
        </div>
      </section>
    </div>`;
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

function start() {
  app.textContent = 'Starting…';

  if (!window.supabase) {
    authScreen('login', 'Supabase library failed to load. Check network or CDN.');
    return;
  }

  try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  } catch (e) {
    authScreen('login', 'Could not create Supabase client: ' + e.message);
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && me) {
      me = null;
      groups = [];
      currentId = null;
      authScreen();
    }
  });

  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await boot();
      else authScreen();
    } catch (e) {
      authScreen('login', e.message || 'Failed to start.');
    }
  })();
}

start();
