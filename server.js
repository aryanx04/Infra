const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const REFERRAL_BONUS = 10; // per successful signup credited to referrer

// ---------- Simple JSON data store ----------
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const files = {
  users: path.join(dbDir, 'users.json'),
  referrals: path.join(dbDir, 'referrals.json'),
  withdraws: path.join(dbDir, 'withdraws.json'),
  transactions: path.join(dbDir, 'transactions.json')
};

for (const f of Object.values(files)) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8');
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8') || '[]');
  } catch {
    return [];
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function uid(prefix = '') {
  return (
    prefix +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------- Helpers ----------
function getHost(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function publicUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    referralCode: u.referralCode,
    referredBy: u.referredBy || null,
    referralsCount: u.referralsCount || 0,
    earnings: u.earnings || 0,
    createdAt: u.createdAt
  };
}

// ---------- Auth ----------
app.post('/api/register', async (req, res) => {
  const { phone, password, name, ref } = req.body;
  if (!phone || !password || !name) {
    return res.status(400).json({ error: 'phone, password, name required' });
  }

  const users = readJSON(files.users);
  if (users.find(u => u.phone === phone)) {
    return res.status(409).json({ error: 'Phone already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 8);
  const referralCode = (name.split(' ')[0] || 'user').toLowerCase().slice(0, 4) + Math.random().toString(36).slice(2, 6);
  const user = {
    id: uid('u_'),
    phone,
    name,
    passwordHash,
    referralCode,
    referredBy: ref || null,
    referralsCount: 0,
    earnings: 0,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  writeJSON(files.users, users);

  // credit referrer if valid
  if (ref) {
    const refUsers = readJSON(files.users);
    const referrer = refUsers.find(u => u.referralCode === ref);
    if (referrer && referrer.id !== user.id) {
      referrer.referralsCount = (referrer.referralsCount || 0) + 1;
      referrer.earnings = (referrer.earnings || 0) + REFERRAL_BONUS;
      writeJSON(files.users, refUsers);

      const referrals = readJSON(files.referrals);
      referrals.push({
        id: uid('r_'),
        referrerId: referrer.id,
        referrerCode: referrer.referralCode,
        newUserId: user.id,
        amount: REFERRAL_BONUS,
        createdAt: new Date().toISOString()
      });
      writeJSON(files.referrals, referrals);

      const transactions = readJSON(files.transactions);
      transactions.push({
        id: uid('t_'),
        userId: referrer.id,
        type: 'referral',
        amount: REFERRAL_BONUS,
        createdAt: new Date().toISOString()
      });
      writeJSON(files.transactions, transactions);
    }
  }

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password required' });
  }
  const users = readJSON(files.users);
  const user = users.find(u => u.phone === phone);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  const users = readJSON(files.users);
  const me = users.find(u => u.id === req.user.id);
  if (!me) return res.status(404).json({ error: 'User not found' });

  const transactions = readJSON(files.transactions).filter(t => t.userId === me.id);
  const withdraws = readJSON(files.withdraws).filter(w => w.userId === me.id);
  res.json({
    user: publicUser(me),
    wallet: {
      balance: me.earnings || 0,
      transactions
    },
    withdraws
  });
});

// ---------- Referral ----------
app.get('/api/referral/link', auth, (req, res) => {
  const users = readJSON(files.users);
  const me = users.find(u => u.id === req.user.id);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const base = getHost(req);
  const link = `${base}/r/${me.referralCode}`;
  res.json({ link });
});

// Landing route: redirect to app with ?ref=code
app.get('/r/:code', (req, res) => {
  const code = req.params.code;
  const target = `/index.html#register?ref=${encodeURIComponent(code)}`;
  res.redirect(target);
});

// ---------- Leaderboard ----------
app.get('/api/leaderboard', (req, res) => {
  const users = readJSON(files.users);
  const topByEarnings = [...users]
    .sort((a, b) => (b.earnings || 0) - (a.earnings || 0))
    .slice(0, 20)
    .map(u => ({ name: u.name, earnings: u.earnings || 0, referrals: u.referralsCount || 0 }));

  const topByReferrals = [...users]
    .sort((a, b) => (b.referralsCount || 0) - (a.referralsCount || 0))
    .slice(0, 20)
    .map(u => ({ name: u.name, referrals: u.referralsCount || 0, earnings: u.earnings || 0 }));

  res.json({ topByEarnings, topByReferrals });
});

// ---------- Wallet / Withdraw ----------
app.post('/api/withdraw', auth, (req, res) => {
  const { amount, method, details } = req.body;
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const users = readJSON(files.users);
  const me = users.find(u => u.id === req.user.id);
  if (!me) return res.status(404).json({ error: 'User not found' });

  if ((me.earnings || 0) < amt) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  me.earnings = (me.earnings || 0) - amt;
  writeJSON(files.users, users);

  const withdraws = readJSON(files.withdraws);
  const request = {
    id: uid('w_'),
    userId: me.id,
    amount: amt,
    method: method || 'UPI',
    details: details || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  withdraws.push(request);
  writeJSON(files.withdraws, withdraws);

  const transactions = readJSON(files.transactions);
  transactions.push({
    id: uid('t_'),
    userId: me.id,
    type: 'withdraw',
    amount: -amt,
    createdAt: new Date().toISOString()
  });
  writeJSON(files.transactions, transactions);

  res.json({ ok: true, request });
});

// ---------- Health ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});