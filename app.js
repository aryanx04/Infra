const api = {
  base: '',
  async request(path, opts = {}) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${this.base}${path}`, { ...opts, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  register(data) { return this.request('/api/register', { method: 'POST', body: JSON.stringify(data) }); },
  login(data) { return this.request('/api/login', { method: 'POST', body: JSON.stringify(data) }); },
  me() { return this.request('/api/me'); },
  referralLink() { return this.request('/api/referral/link'); },
  leaderboard() { return this.request('/api/leaderboard'); },
  withdraw(data) { return this.request('/api/withdraw', { method: 'POST', body: JSON.stringify(data) }); }
};

const state = {
  user: null,
  wallet: null,
  withdraws: []
};

function $(s) { return document.querySelector(s); }
function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function toast(msg) {
  alert(msg); // lightweight mobile
}

async function init() {
  const hash = location.hash || '#home';
  if (localStorage.getItem('token')) {
    try {
      const me = await api.me();
      state.user = me.user;
      state.wallet = me.wallet;
      state.withdraws = me.withdraws;
      renderHome();
      renderWallet();
      await loadLeaderboard();
      show(hash.includes('#leaderboard') ? '#leaderboard' : '#home');
    } catch {
      localStorage.removeItem('token');
      renderAuth();
      show('#auth');
    }
  } else {
    renderAuth();
    // Prefill ref code from hash
    const h = location.hash;
    if (h.startsWith('#register?')) show('#auth');
    else show('#auth');
  }
  bindNav();
}

function bindNav() {
  $('#btnHome').onclick = () => show('#home');
  $('#btnLeaderboard').onclick = () => show('#leaderboard');
  $('#btnWallet').onclick = () => show('#wallet');
  $('#btnProfile').onclick = () => show('#profile');
}

function renderAuth() {
  const container = $('#auth');
  const refMatch = location.hash.match(/ref=([^&]+)/);
  const ref = refMatch ? decodeURIComponent(refMatch[1]) : '';
  container.innerHTML = `
    <div class="container">
      <h1>Welcome</h1>
      <div class="card">
        <div class="row">
          <input id="r_name" class="input" placeholder="Full name" />
        </div>
        <div class="row" style="margin-top:8px;">
          <input id="r_phone" class="input" placeholder="Phone number" />
        </div>
        <div class="row" style="margin-top:8px;">
          <input id="r_pass" type="password" class="input" placeholder="Password" />
        </div>
        <div class="row" style="margin-top:8px;">
          <input id="r_ref" class="input" placeholder="Referral code (optional)" value="${ref}" />
        </div>
        <div class="row" style="margin-top:10px;">
          <button id="btnRegister" class="btn success" style="flex:1;">Create account</button>
        </div>
        <div class="notice" style="margin-top:8px;">By signing up, you accept the terms.</div>
      </div>

      <div class="card">
        <div class="row">
          <input id="l_phone" class="input" placeholder="Phone number" />
        </div>
        <div class="row" style="margin-top:8px;">
          <input id="l_pass" type="password" class="input" placeholder="Password" />
        </div>
        <div class="row" style="margin-top:10px;">
          <button id="btnLogin" class="btn" style="flex:1;">Login</button>
        </div>
      </div>
    </div>
  `;
  $('#btnRegister').onclick = async () => {
    try {
      const name = $('#r_name').value.trim();
      const phone = $('#r_phone').value.trim();
      const password = $('#r_pass').value.trim();
      const r = $('#r_ref').value.trim();
      const data = await api.register({ name, phone, password, ref: r || undefined });
      localStorage.setItem('token', data.token);
      state.user = data.user;
      const me = await api.me();
      state.wallet = me.wallet;
      state.withdraws = me.withdraws;
      renderHome(); renderWallet(); await loadLeaderboard();
      show('#home');
    } catch (e) {
      toast(e.message);
    }
  };
  $('#btnLogin').onclick = async () => {
    try {
      const phone = $('#l_phone').value.trim();
      const password = $('#l_pass').value.trim();
      const data = await api.login({ phone, password });
      localStorage.setItem('token', data.token);
      state.user = data.user;
      const me = await api.me();
      state.wallet = me.wallet;
      state.withdraws = me.withdraws;
      renderHome(); renderWallet(); await loadLeaderboard();
      show('#home');
    } catch (e) {
      toast(e.message);
    }
  };
}

function renderHome() {
  const c = $('#home .container');
  if (!state.user) return;
  c.innerHTML = `
    <h1>Dashboard</h1>
    <div class="card kpi">
      <div class="item">
        <div class="small">Total earnings</div>
        <div style="font-size:22px; margin-top:4px;">₹ ${Number(state.user.earnings || 0).toFixed(2)}</div>
      </div>
      <div class="item">
        <div class="small">Referrals</div>
        <div style="font-size:22px; margin-top:4px;">${state.user.referralsCount || 0}</div>
      </div>
    </div>

    <div class="card" id="refCard">
      <div class="small">Your referral link</div>
      <div id="refLink" class="link" style="margin:6px 0;">Loading…</div>
      <div class="row">
        <button id="btnCopy" class="btn secondary" style="flex:1;">Copy link</button>
        <button id="btnShare" class="btn success" style="flex:1;">Share WhatsApp</button>
      </div>
      <div class="notice" style="margin-top:8px;">Earn ₹${10} per successful signup via your link.</div>
    </div>

    <div class="card">
      <div class="small">Recent transactions</div>
      <div class="list" id="txList"></div>
    </div>
  `;

  api.referralLink().then(({ link }) => {
    $('#refLink').textContent = link;
    $('#btnCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Copy failed'); }
    };
    $('#btnShare').onclick = () => {
      const text = `Join with my referral link: ${link}`;
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    };
  });

  const txList = $('#txList');
  txList.innerHTML = '';
  (state.wallet?.transactions || []).slice(-10).reverse().forEach(t => {
    const el = document.createElement('div');
    el.className = 'rowi';
    const sign = t.amount >= 0 ? '+' : '';
    el.innerHTML = `<div>${t.type}</div><div>${sign}₹${Math.abs(t.amount)}</div>`;
    txList.appendChild(el);
  });
}

async function loadLeaderboard() {
  const data = await api.leaderboard();
  const c = $('#leaderboard .container');
  c.innerHTML = `
    <h1>Leaderboard</h1>
    <div class="card">
      <div class="small">Top by earnings</div>
      <div class="list" id="earnList"></div>
    </div>
    <div class="card">
      <div class="small">Top by referrals</div>
      <div class="list" id="refList"></div>
    </div>
  `;
  const earn = $('#earnList'), ref = $('#refList');
  data.topByEarnings.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'rowi';
    el.innerHTML = `<div>#${i+1} ${u.name}</div><div>₹ ${u.earnings}</div>`;
    earn.appendChild(el);
  });
  data.topByReferrals.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'rowi';
    el.innerHTML = `<div>#${i+1} ${u.name}</div><div>${u.referrals}</div>`;
    ref.appendChild(el);
  });
}

function renderWallet() {
  const c = $('#wallet .container');
  if (!state.user) return;
  c.innerHTML = `
    <h1>Wallet</h1>
    <div class="card kpi">
      <div class="item">
        <div class="small">Available balance</div>
        <div style="font-size:22px; margin-top:4px;">₹ ${Number(state.wallet?.balance || 0).toFixed(2)}</div>
      </div>
      <div class="item">
        <div class="small">Withdrawals</div>
        <div style="font-size:22px; margin-top:4px;">${(state.withdraws || []).length}</div>
      </div>
    </div>
    <div class="card">
      <div class="small">Request withdrawal</div>
      <div class="row" style="margin-top:8px;">
        <input id="w_amount" class="input" placeholder="Amount (₹)" inputmode="decimal" />
      </div>
      <div class="row" style="margin-top:8px;">
        <input id="w_method" class="input" placeholder="Method (UPI/Bank)" value="UPI" />
      </div>
      <div class="row" style="margin-top:8px;">
        <input id="w_details" class="input" placeholder="UPI ID / Account details" />
      </div>
      <div class="row" style="margin-top:10px;">
        <button id="btnWithdraw" class="btn">Submit request</button>
      </div>
      <div class="notice" style="margin-top:8px;">Manual approval. Balance is deducted instantly; status stays pending.</div>
    </div>

    <div class="card">
      <div class="small">Your withdrawal requests</div>
      <div class="list" id="withList"></div>
    </div>
  `;
  $('#btnWithdraw').onclick = async () => {
    try {
      const amount = Number($('#w_amount').value);
      const method = $('#w_method').value.trim();
      const details = $('#w_details').value.trim();
      const r = await api.withdraw({ amount, method, details });
      toast('Withdraw request submitted');
      const me = await api.me();
      state.user = me.user; state.wallet = me.wallet; state.withdraws = me.withdraws;
      renderWallet(); renderHome();
    } catch (e) { toast(e.message); }
  };

  const list = $('#withList');
  list.innerHTML = '';
  (state.withdraws || []).slice().reverse().forEach(w => {
    const el = document.createElement('div');
    el.className = 'rowi';
    el.innerHTML = `<div>₹ ${w.amount} • ${w.method}</div><div>${w.status}</div>`;
    list.appendChild(el);
  });
}

// Profile
function renderProfile() {
  const c = $('#profile .container');
  if (!state.user) return;
  c.innerHTML = `
    <h1>Profile</h1>
    <div class="card">
      <div class="rowi"><div>Name</div><div>${state.user.name}</div></div>
      <div class="rowi"><div>Phone</div><div>${state.user.phone}</div></div>
      <div class="rowi"><div>Referral code</div><div>${state.user.referralCode}</div></div>
      <div class="row" style="margin-top:10px;">
        <button id="btnLogout" class="btn danger" style="flex:1;">Log out</button>
      </div>
    </div>
  `;
  $('#btnLogout').onclick = () => {
    localStorage.removeItem('token');
    state.user = null; state.wallet = null; state.withdraws = [];
    renderAuth(); show('#auth');
  };
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  renderProfile();
});