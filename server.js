'use strict';
/*
 * Oasis Preschool Academy - website + school management server
 * Stack: Node.js (no npm packages needed), built-in SQLite (node:sqlite), plain HTML/CSS/JS front end.
 * Run:   node server.js        (or double-click "Start Website.command" on a Mac)
 * Data:  ./data/oasis.db  (SQLite)  and  ./data/uploads/  (homework attachments)
 * Settings (port, admin email, SMTP for OTP mails): ./config.json  (created on first run)
 */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const tls = require('tls'), net = require('net'), os = require('os');

const ROOT = __dirname, DATA = path.join(ROOT, 'data'), UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------------- config ---------------- */
const CONFIG_FILE = path.join(ROOT, 'config.json');
const DEFAULT_CONFIG = {
  port: 8000,
  host: '0.0.0.0',
  adminEmail: 'oasispsa@gmail.com',
  adminName: 'Administrator',
  otpMinutes: 5,
  sessionHours: 12,
  smtp: { host: 'smtp.gmail.com', port: 465, user: '', pass: '', fromName: 'Oasis Preschool Academy' }
};
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
const config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
config.smtp = Object.assign({}, DEFAULT_CONFIG.smtp, config.smtp || {});
if (process.env.PORT) config.port = +process.env.PORT;
const smtpReady = () => !!(config.smtp.host && config.smtp.user && config.smtp.pass);

/* ---------------- database ---------------- */
// One generic table: every record is JSON, grouped by collection. Uses Node's built-in SQLite
// (Node 22.5+). On older Node it falls back to a JSON file so the app still runs.
const store = (function () {
  try {
    const origEmit = process.emitWarning;
    process.emitWarning = function (w, ...a) { if (String(w).includes('SQLite')) return; return origEmit.call(process, w, ...a); };
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(DATA, 'oasis.db'));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(col,id))');
    const qAll = db.prepare('SELECT data FROM records WHERE col=?');
    const qGet = db.prepare('SELECT data FROM records WHERE col=? AND id=?');
    const qPut = db.prepare('INSERT INTO records(col,id,data,updated) VALUES(?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, updated=excluded.updated');
    const qDel = db.prepare('DELETE FROM records WHERE col=? AND id=?');
    return {
      kind: 'SQLite (data/oasis.db)',
      all: c => qAll.all(c).map(r => JSON.parse(r.data)),
      get: (c, id) => { const r = qGet.get(c, String(id)); return r ? JSON.parse(r.data) : null; },
      put: (c, o) => { qPut.run(c, String(o.id), JSON.stringify(o), new Date().toISOString()); return o; },
      del: (c, id) => { qDel.run(c, String(id)); },
      tx: fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
    };
  } catch (e) {
    const file = path.join(DATA, 'oasis.json');
    let mem = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    let t = null; const save = () => { clearTimeout(t); t = setTimeout(() => { fs.writeFileSync(file + '.tmp', JSON.stringify(mem)); fs.renameSync(file + '.tmp', file); }, 50); };
    return {
      kind: 'JSON file (data/oasis.json) - update Node.js to 22.5+ to use SQLite',
      all: c => Object.values(mem[c] || {}),
      get: (c, id) => (mem[c] || {})[id] || null,
      put: (c, o) => { (mem[c] = mem[c] || {})[o.id] = o; save(); return o; },
      del: (c, id) => { if (mem[c]) delete mem[c][id]; save(); },
      tx: fn => fn()
    };
  }
})();

const newId = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* ---------------- screens & permissions ---------------- */
const ACTIONS = ['view', 'add', 'edit', 'delete'];
const BUILT_IN_SCREENS = [
  { code: 'dashboard', name: 'Dashboard', module: 'Overview', description: 'Today at a glance: students, attendance and homework counts' },
  { code: 'attendance', name: 'Attendance', module: 'Academics', description: 'Pick a class (and section) to load its students and mark present, absent or late' },
  { code: 'homework', name: 'Homework', module: 'Academics', description: 'Post homework with a required attachment or a photo taken on the phone camera' },
  { code: 'students', name: 'Students', module: 'Academics', description: 'Student records with class, section and parent contact' },
  { code: 'school', name: 'School details', module: 'Setup', description: 'School name, contact, logo and primary / secondary colours' },
  { code: 'classes', name: 'Classes', module: 'Setup', description: 'All classes run by the school' },
  { code: 'sections', name: 'Sections', module: 'Setup', description: 'Sections inside each class' },
  { code: 'fees', name: 'Fee types', module: 'Setup', description: 'Types of fees with amount and frequency' },
  { code: 'screens', name: 'Screen master', module: 'Administration', description: 'Register of every screen in the software' },
  { code: 'roles', name: 'Role master', module: 'Administration', description: 'Roles and which screens / actions each role can use' },
  { code: 'users', name: 'User master', module: 'Administration', description: 'Users with name, mobile, email and role' }
];

function rolePerms(role) {
  if (!role) return {};
  if (role.system) { const p = {}; store.all('screens').forEach(s => p[s.code] = { view: true, add: true, edit: true, delete: true }); return p; }
  return role.perms || {};
}
const can = (u, screen, action) => !!(u && u.perms[screen] && u.perms[screen][action]);

/* ---------------- seed ---------------- */
function seed() {
  if (store.all('screens').length === 0) BUILT_IN_SCREENS.forEach((s, i) => store.put('screens', Object.assign({ id: newId(), builtIn: true, order: i + 1, created: now() }, s)));
  else BUILT_IN_SCREENS.forEach((s, i) => { if (!store.all('screens').some(x => x.code === s.code)) store.put('screens', Object.assign({ id: newId(), builtIn: true, order: i + 1, created: now() }, s)); });

  if (store.all('roles').length === 0) {
    const P = (list) => { const o = {}; for (const [code, acts] of Object.entries(list)) { o[code] = {}; ACTIONS.forEach(a => o[code][a] = acts.includes(a)); } return o; };
    store.put('roles', { id: 'administrator', name: 'Administrator', description: 'Full access to every screen', system: true, perms: {}, created: now() });
    store.put('roles', { id: newId(), name: 'Staff', description: 'Teachers and office staff', perms: P({ dashboard: ['view'], students: ['view'], attendance: ['view', 'add', 'edit'], homework: ['view', 'add', 'edit', 'delete'], classes: ['view'], sections: ['view'] }), created: now() });
    store.put('roles', { id: newId(), name: 'Parents', description: 'Parents of enrolled children', perms: P({ dashboard: ['view'], attendance: ['view'], homework: ['view'] }), created: now() });
  }
  if (store.all('users').length === 0)
    store.put('users', { id: newId(), name: config.adminName, email: String(config.adminEmail).toLowerCase(), mobile: '', roleId: 'administrator', active: true, created: now() });

  if (!store.get('settings', 'school')) {
    let logo = '';
    try { logo = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'logo.png')).toString('base64'); } catch (e) { }
    store.put('settings', { id: 'school', name: 'Oasis Preschool Academy', tagline: 'Growing roots to flying wings', address: 'Kurmannapalem, Visakhapatnam, Andhra Pradesh 530046', phone: '83745 20766, 83745 20722', email: 'oasispsa@gmail.com', logo, primaryColor: '#d6157a', secondaryColor: '#6a2fb2' });
  }
  if (store.all('classes').length === 0) {
    [['Playgroup', '1½ to 3 years'], ['Nursery', '3 to 4 years'], ['LKG', '4 to 5 years'], ['UKG', '5 to 6 years']].forEach(([name, ageGroup], i) => {
      const c = store.put('classes', { id: newId(), name, ageGroup, order: i + 1, created: now() });
      store.put('sections', { id: newId(), classId: c.id, name: 'A', teacher: '', capacity: null, created: now() });
    });
  }
  if (store.all('feeTypes').length === 0) {
    [['Admission fee', 'One time'], ['Tuition fee', 'Monthly'], ['School van fee', 'Monthly'], ['Books and uniform', 'Yearly'], ['Activity fee', 'Term']]
      .forEach(([name, frequency]) => store.put('feeTypes', { id: newId(), name, frequency, amount: null, classId: '', description: '', created: now() }));
  }
}
seed();

/* ---------------- generic collections ---------------- */
const isEmail = s => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s);
const str = (v, max = 300) => (v == null ? '' : String(v)).trim().slice(0, max);
const numOrNull = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = m => { throw new HttpError(400, m); };

const COLS = {
  classes: {
    screen: 'classes', read: () => true,
    clean: (b, id) => {
      const o = { name: str(b.name, 60) || bad('Class name is required'), ageGroup: str(b.ageGroup, 60), order: numOrNull(b.order) };
      if (store.all('classes').some(x => x.id !== id && x.name.toLowerCase() === o.name.toLowerCase())) bad('A class with this name already exists');
      return o;
    },
    beforeDelete: id => {
      if (store.all('sections').some(s => s.classId === id)) bad('Delete or move this class\'s sections first');
      if (store.all('students').some(s => s.classId === id)) bad('This class has students. Move them to another class first');
    }
  },
  sections: {
    screen: 'sections', read: () => true,
    clean: (b, id) => {
      const o = { classId: str(b.classId, 40), name: str(b.name, 40) || bad('Section name is required'), teacher: str(b.teacher, 80), capacity: numOrNull(b.capacity) };
      if (!store.get('classes', o.classId)) bad('Choose a class');
      if (store.all('sections').some(x => x.id !== id && x.classId === o.classId && x.name.toLowerCase() === o.name.toLowerCase())) bad('This class already has a section with that name');
      return o;
    },
    beforeDelete: id => { if (store.all('students').some(s => s.sectionId === id)) bad('This section has students. Move them first'); }
  },
  feeTypes: {
    screen: 'fees', read: u => can(u, 'fees', 'view'),
    clean: b => {
      const o = { name: str(b.name, 80) || bad('Fee name is required'), amount: numOrNull(b.amount), frequency: str(b.frequency, 30), classId: str(b.classId, 40), description: str(b.description, 300) };
      if (o.amount != null && o.amount < 0) bad('Amount cannot be negative');
      if (o.classId && !store.get('classes', o.classId)) bad('Unknown class');
      return o;
    }
  },
  students: {
    screen: 'students', read: u => can(u, 'students', 'view'),
    clean: b => {
      const o = {
        name: str(b.name, 80) || bad('Student name is required'), admissionNo: str(b.admissionNo, 30), classId: str(b.classId, 40), sectionId: str(b.sectionId, 40),
        dob: str(b.dob, 10), gender: str(b.gender, 10), parentName: str(b.parentName, 80), mobile: str(b.mobile, 20), email: str(b.email, 120).toLowerCase(),
        van: !!b.van, address: str(b.address, 300), active: b.active !== false
      };
      if (!store.get('classes', o.classId)) bad('Choose a class');
      if (o.sectionId) { const s = store.get('sections', o.sectionId); if (!s || s.classId !== o.classId) bad('That section does not belong to the chosen class'); }
      if (o.email && !isEmail(o.email)) bad('Parent email does not look right');
      return o;
    }
  },
  screens: {
    screen: 'screens', read: () => true,
    clean: (b, id) => {
      const cur = id && store.get('screens', id);
      const o = { name: str(b.name, 60) || bad('Screen name is required'), module: str(b.module, 40), description: str(b.description, 300), order: numOrNull(b.order) };
      o.code = cur && cur.builtIn ? cur.code : (str(b.code, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || bad('Screen code is required (letters, numbers, - or _)'));
      if (store.all('screens').some(x => x.id !== id && x.code === o.code)) bad('Another screen already uses this code');
      return o;
    },
    beforeDelete: id => { const s = store.get('screens', id); if (s && s.builtIn) bad('Built-in screens cannot be deleted'); }
  },
  roles: {
    screen: 'roles', read: u => can(u, 'roles', 'view') || can(u, 'users', 'view'),
    clean: (b, id) => {
      const cur = id && store.get('roles', id);
      const o = { name: str(b.name, 60) || bad('Role name is required'), description: str(b.description, 300) };
      if (cur && cur.system) { o.name = cur.name; o.system = true; o.perms = {}; return o; }
      if (store.all('roles').some(x => x.id !== id && x.name.toLowerCase() === o.name.toLowerCase())) bad('A role with this name already exists');
      const codes = new Set(store.all('screens').map(s => s.code)); o.perms = {};
      for (const [code, acts] of Object.entries(b.perms || {})) {
        if (!codes.has(code)) continue;
        const p = {}; ACTIONS.forEach(a => p[a] = !!(acts && acts[a]));
        if (p.add || p.edit || p.delete) p.view = true;
        if (ACTIONS.some(a => p[a])) o.perms[code] = p;
      }
      return o;
    },
    beforeDelete: id => {
      const r = store.get('roles', id); if (r && r.system) bad('The Administrator role cannot be deleted');
      if (store.all('users').some(u => u.roleId === id)) bad('Users still have this role. Change their role first');
    }
  },
  users: {
    screen: 'users', read: u => can(u, 'users', 'view'),
    clean: (b, id, me) => {
      const o = { name: str(b.name, 80) || bad('Name is required'), mobile: str(b.mobile, 20), email: str(b.email, 120).toLowerCase(), roleId: str(b.roleId, 40), active: b.active !== false };
      if (!isEmail(o.email)) bad('Enter a valid email address');
      if (o.mobile && !/^\+?[0-9 ]{10,15}$/.test(o.mobile)) bad('Mobile number should be 10 digits');
      if (!store.get('roles', o.roleId)) bad('Choose a role');
      if (store.all('users').some(x => x.id !== id && x.email === o.email)) bad('Another user already has this email');
      if (id && me && id === me.id && (!o.active || o.roleId !== me.roleId) && me.roleId === 'administrator') bad('You cannot deactivate yourself or remove your own Administrator role');
      return o;
    },
    beforeDelete: (id, me) => { if (me && id === me.id) bad('You cannot delete your own user'); }
  }
};

/* ---------------- sessions & OTP ---------------- */
function parseCookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function currentUser(req) {
  const sid = parseCookies(req).sid; if (!sid) return null;
  const s = store.get('sessions', sha(sid)); if (!s || s.expires < Date.now()) return null;
  const u = store.get('users', s.userId); if (!u || !u.active) return null;
  const role = store.get('roles', u.roleId);
  return Object.assign({}, u, { role: role ? { id: role.id, name: role.name } : null, perms: rolePerms(role) });
}
function cleanupExpired() { const t = Date.now(); store.all('sessions').forEach(s => s.expires < t && store.del('sessions', s.id)); store.all('otps').forEach(o => o.expires < t - 3600e3 && store.del('otps', o.id)); }
setInterval(cleanupExpired, 30 * 60e3).unref();

/* Minimal SMTP client (TLS on 465, or STARTTLS on 587) so no npm packages are needed. */
function sendMail({ to, subject, text, html }) {
  const c = config.smtp;
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiter = null, done = false;
    const timer = setTimeout(() => fail(new Error('SMTP timed out')), 25000);
    function fail(e) { if (done) return; done = true; clearTimeout(timer); try { sock && sock.destroy(); } catch (x) { } reject(e); }
    function pump() {
      if (!waiter) return; const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) if (/^\d{3}(?: |$)/.test(lines[i])) {
        const resp = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n'); const w = waiter; waiter = null; w(resp); return;
      }
    }
    function attach(s) { sock = s; s.on('data', d => { buf += d.toString('utf8'); pump(); }); s.on('error', fail); }
    const read = () => new Promise(r => { waiter = r; pump(); });
    async function cmd(line, ok) { if (line != null) sock.write(line + '\r\n'); const r = await read(); if (!ok.includes(+r.slice(0, 3))) throw new Error('SMTP: ' + r.trim().split('\n').pop()); return r; }
    const b64 = s => Buffer.from(s, 'utf8').toString('base64');
    (async () => {
      const secure = +c.port === 465 || c.secure === true;
      attach(secure ? tls.connect({ host: c.host, port: +c.port, servername: c.host }) : net.connect(+c.port, c.host));
      await cmd(null, [220]);
      let ehlo = await cmd('EHLO oasis.local', [250]);
      if (!secure) {
        if (/STARTTLS/i.test(ehlo)) {
          await cmd('STARTTLS', [220]); sock.removeAllListeners('data');
          const t = tls.connect({ socket: sock, servername: c.host }); attach(t);
          await new Promise(r => t.once('secureConnect', r));
          await cmd('EHLO oasis.local', [250]);
        } else if (!['localhost', '127.0.0.1'].includes(c.host)) throw new Error('SMTP server does not offer encryption');
      }
      if (c.user) { await cmd('AUTH LOGIN', [334]); await cmd(b64(c.user), [334]); await cmd(b64(c.pass), [235]); }
      const from = c.from || c.user;
      await cmd(`MAIL FROM:<${from}>`, [250]); await cmd(`RCPT TO:<${to}>`, [250, 251]); await cmd('DATA', [354]);
      const boundary = 'b' + newId();
      const msg = [
        `From: =?UTF-8?B?${b64(c.fromName || 'School')}?= <${from}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${newId()}@oasis.local>`, 'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text).replace(/.{76}/g, '$&\r\n'),
        `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html).replace(/.{76}/g, '$&\r\n'),
        `--${boundary}--`
      ].join('\r\n');
      await cmd(msg + '\r\n.', [250]);
      sock.write('QUIT\r\n'); done = true; clearTimeout(timer); sock.end(); resolve();
    })().catch(fail);
  });
}

/* ---------------- HTTP helpers ---------------- */
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };
function send(res, status, obj, extra) { const body = JSON.stringify(obj); res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS, extra || {})); res.end(body); }
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Send JSON'));
    let size = 0; const chunks = [];
    req.on('data', d => { size += d.length; if (size > limit) { reject(new HttpError(413, 'That file is too large (max 10 MB)')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}
const need = (u, screen, action) => { if (!u) throw new HttpError(401, 'Please sign in'); if (!can(u, screen, action)) throw new HttpError(403, 'Your role does not allow this'); };

/* attachments */
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt' };
const EXT_TYPES = Object.fromEntries(Object.entries(FILE_TYPES).map(([k, v]) => [v, k]));
function saveAttachment(a) {
  if (!a || !a.dataUrl) bad('An attachment or a photo is required');
  const m = /^data:([\w.+\/-]+);base64,(.+)$/.exec(a.dataUrl); if (!m) bad('Attachment could not be read');
  const ext = FILE_TYPES[m[1]]; if (!ext) bad('This file type is not allowed. Use a photo, PDF, Word, Excel, PowerPoint or text file');
  const bytes = Buffer.from(m[2], 'base64'); if (bytes.length > 10 * 1024 * 1024) bad('Attachment is larger than 10 MB');
  const file = newId() + '.' + ext; fs.writeFileSync(path.join(UPLOADS, file), bytes);
  return { file, name: str(a.name, 120) || ('attachment.' + ext), type: m[1], size: bytes.length };
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname.replace(/\/+$/, ''), M = req.method, me = currentUser(req);
  const parts = p.split('/').slice(2); // ['auth','request-otp'] etc

  // ---- public ----
  if (p === '/api/public/school' && M === 'GET') {
    const s = store.get('settings', 'school') || {}; return send(res, 200, { name: s.name, tagline: s.tagline, logo: s.logo, primaryColor: s.primaryColor, secondaryColor: s.secondaryColor, address: s.address, phone: s.phone, email: s.email });
  }
  if (p === '/api/auth/request-otp' && M === 'POST') {
    const b = await readJson(req, 4096); const email = str(b.email, 120).toLowerCase();
    if (!isEmail(email)) bad('Enter a valid email address');
    const u = store.all('users').find(x => x.email === email);
    if (!u) throw new HttpError(404, 'This email is not registered. Please contact the school office.');
    if (!u.active) throw new HttpError(403, 'This user is inactive. Please contact the school office.');
    const prev = store.get('otps', email);
    if (prev && Date.now() - prev.sentAt < 30e3) throw new HttpError(429, 'Please wait 30 seconds before asking for another code');
    const hourSends = ((prev && Date.now() - prev.windowStart < 3600e3) ? prev.sends : 0) + 1;
    if (hourSends > 6) throw new HttpError(429, 'Too many codes requested. Try again in an hour');
    const otp = String(crypto.randomInt(0, 1e6)).padStart(6, '0'), salt = newId();
    store.put('otps', { id: email, userId: u.id, hash: sha(salt + otp), salt, expires: Date.now() + config.otpMinutes * 60e3, attempts: 0, sentAt: Date.now(),
      sends: hourSends, windowStart: (prev && Date.now() - prev.windowStart < 3600e3) ? prev.windowStart : Date.now() });
    const school = (store.get('settings', 'school') || {}).name || 'School';
    if (smtpReady()) {
      try {
        await sendMail({ to: email, subject: `${otp} is your ${school} login code`,
          text: `Hello ${u.name},\n\nYour login code is ${otp}. It expires in ${config.otpMinutes} minutes.\nIf you did not ask for this, ignore this email.\n\n${school}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#241a35"><p>Hello ${u.name.replace(/[<>&"]/g, '')},</p><p>Your login code is</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#6a2fb2">${otp}</p><p>It expires in ${config.otpMinutes} minutes. If you did not ask for this, ignore this email.</p><p>${school.replace(/[<>&"]/g, '')}</p></div>` });
      } catch (e) { console.error('  OTP email failed:', e.message); store.del('otps', email); throw new HttpError(502, 'Could not send the email. Check the SMTP settings in config.json (' + e.message + ')'); }
      return send(res, 200, { ok: true, sentTo: email });
    }
    console.log(`\n  [DEMO MODE - email not set up] OTP for ${email}: ${otp}\n`);
    return send(res, 200, { ok: true, sentTo: email, demo: true, demoOtp: otp });
  }
  if (p === '/api/auth/verify-otp' && M === 'POST') {
    const b = await readJson(req, 4096); const email = str(b.email, 120).toLowerCase(), otp = str(b.otp, 10).replace(/\D/g, '');
    const rec = store.get('otps', email);
    if (!rec || !rec.hash) throw new HttpError(400, 'Ask for a new code first');
    if (rec.expires < Date.now()) { store.put('otps', Object.assign(rec, { hash: null })); throw new HttpError(400, 'This code has expired. Ask for a new one'); }
    if (rec.attempts >= 5) { store.put('otps', Object.assign(rec, { hash: null })); throw new HttpError(429, 'Too many wrong attempts. Ask for a new code'); }
    const okHash = sha(rec.salt + otp);
    if (otp.length !== 6 || !crypto.timingSafeEqual(Buffer.from(okHash), Buffer.from(rec.hash))) {
      rec.attempts++; store.put('otps', rec); throw new HttpError(400, `Wrong code. ${5 - rec.attempts} attempt(s) left`);
    }
    const u = store.get('users', rec.userId); if (!u || !u.active || u.email !== email) throw new HttpError(403, 'This user is no longer active');
    store.put('otps', Object.assign(rec, { hash: null }));
    const sid = crypto.randomBytes(32).toString('hex'), maxAge = config.sessionHours * 3600;
    store.put('sessions', { id: sha(sid), userId: u.id, expires: Date.now() + maxAge * 1000, created: now() });
    store.put('users', Object.assign(u, { lastLogin: now() }));
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}` });
  }
  if (p === '/api/auth/logout' && M === 'POST') {
    const sid = parseCookies(req).sid; if (sid) store.del('sessions', sha(sid));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // ---- signed in from here ----
  if (!me) throw new HttpError(401, 'Please sign in');
  if (M !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON');

  if (p === '/api/me' && M === 'GET') return send(res, 200, { user: { id: me.id, name: me.name, email: me.email, mobile: me.mobile, role: me.role }, perms: me.perms, actions: ACTIONS, mailReady: smtpReady(), db: store.kind });

  if (p === '/api/school') {
    if (M === 'GET') return send(res, 200, store.get('settings', 'school'));
    if (M === 'PUT') {
      need(me, 'school', 'edit'); const b = await readJson(req, 3 * 1024 * 1024);
      const col = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : bad('Colours must look like #d6157a');
      const logo = str(b.logo, 2.5e6); if (logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(logo)) bad('Logo must be a PNG, JPG, WEBP or SVG image');
      const o = { id: 'school', name: str(b.name, 100) || bad('School name is required'), tagline: str(b.tagline, 120), address: str(b.address, 300), phone: str(b.phone, 80), email: str(b.email, 120),
        logo, primaryColor: col(b.primaryColor), secondaryColor: col(b.secondaryColor), updated: now() };
      return send(res, 200, store.put('settings', o));
    }
  }

  if (p === '/api/dashboard' && M === 'GET') {
    need(me, 'dashboard', 'view');
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India time
    const att = store.all('attendance').filter(a => a.date === today);
    const students = store.all('students').filter(s => s.active !== false);
    return send(res, 200, { today, students: students.length, classes: store.all('classes').length, present: att.filter(a => a.status === 'P').length, absent: att.filter(a => a.status === 'A').length, late: att.filter(a => a.status === 'L').length,
      homeworkDue: store.all('homework').filter(h => h.dueDate >= today).length, users: store.all('users').length });
  }

  // attendance
  if (p === '/api/attendance') {
    if (M === 'GET') {
      need(me, 'attendance', 'view');
      const date = str(url.searchParams.get('date'), 10), classId = str(url.searchParams.get('classId'), 40), sectionId = str(url.searchParams.get('sectionId'), 40);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('Choose a date'); if (!store.get('classes', classId)) bad('Choose a class');
      const students = store.all('students').filter(s => s.classId === classId && s.active !== false && (!sectionId || s.sectionId === sectionId))
        .sort((a, b) => a.name.localeCompare(b.name)).map(s => ({ id: s.id, name: s.name, admissionNo: s.admissionNo, sectionId: s.sectionId }));
      const marks = {}; students.forEach(s => { const m = store.get('attendance', date + '_' + s.id); if (m) marks[s.id] = { status: m.status, remark: m.remark, by: m.byName, at: m.updated }; });
      return send(res, 200, { students, marks });
    }
    if (M === 'POST') {
      const b = await readJson(req, 512 * 1024); const date = str(b.date, 10), classId = str(b.classId, 40);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('Choose a date'); if (!store.get('classes', classId)) bad('Choose a class');
      const list = Array.isArray(b.marks) ? b.marks : []; if (!list.length) bad('No students to save');
      const existing = list.some(m => store.get('attendance', date + '_' + m.studentId));
      need(me, 'attendance', existing ? 'edit' : 'add');
      store.tx(() => list.forEach(m => {
        const s = store.get('students', m.studentId); if (!s || s.classId !== classId) return;
        const status = ['P', 'A', 'L'].includes(m.status) ? m.status : bad('Mark every student as Present, Absent or Late');
        store.put('attendance', { id: date + '_' + s.id, date, studentId: s.id, classId, sectionId: s.sectionId, status, remark: str(m.remark, 200), by: me.id, byName: me.name, updated: now() });
      }));
      return send(res, 200, { ok: true, saved: list.length });
    }
  }

  // homework
  if (parts[0] === 'homework') {
    const id = parts[1];
    if (M === 'GET' && !id) {
      need(me, 'homework', 'view'); const classId = url.searchParams.get('classId');
      return send(res, 200, store.all('homework').filter(h => !classId || h.classId === classId).sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || '') || b.created.localeCompare(a.created)));
    }
    if (M === 'POST' && !id) {
      need(me, 'homework', 'add'); const b = await readJson(req, 15 * 1024 * 1024);
      const o = cleanHomework(b); o.attachment = saveAttachment(b.attachment);
      return send(res, 201, store.put('homework', Object.assign(o, { id: newId(), by: me.id, byName: me.name, created: now() })));
    }
    const cur = id && store.get('homework', id); if (id && !cur) throw new HttpError(404, 'Homework not found');
    if (M === 'PUT') {
      need(me, 'homework', 'edit'); const b = await readJson(req, 15 * 1024 * 1024);
      const o = Object.assign(cur, cleanHomework(b), { updated: now() });
      if (b.attachment && b.attachment.dataUrl) { const old = cur.attachment; o.attachment = saveAttachment(b.attachment); if (old) fs.rm(path.join(UPLOADS, old.file), () => { }); }
      return send(res, 200, store.put('homework', o));
    }
    if (M === 'DELETE') { need(me, 'homework', 'delete'); store.del('homework', id); if (cur.attachment) fs.rm(path.join(UPLOADS, cur.attachment.file), () => { }); return send(res, 200, { ok: true }); }
  }

  // generic collections
  const def = COLS[parts[0]];
  if (def) {
    const name = parts[0], id = parts[1];
    if (M === 'GET' && !id) { if (!def.read(me)) throw new HttpError(403, 'Your role does not allow this'); let rows = store.all(name); if (name === 'users') rows = rows.map(u => Object.assign({}, u)); return send(res, 200, rows); }
    if (M === 'POST' && !id) { need(me, def.screen, 'add'); const b = await readJson(req, 256 * 1024); const o = def.clean(b, null, me); return send(res, 201, store.put(name, Object.assign(o, { id: newId(), created: now() }))); }
    const cur = id && store.get(name, id); if (!cur) throw new HttpError(404, 'Not found');
    if (M === 'PUT') { need(me, def.screen, 'edit'); const b = await readJson(req, 256 * 1024); const o = def.clean(b, id, me); return send(res, 200, store.put(name, Object.assign({}, cur, o, { id, updated: now() }))); }
    if (M === 'DELETE') {
      need(me, def.screen, 'delete'); if (def.beforeDelete) def.beforeDelete(id, me); store.del(name, id);
      if (name === 'users') store.all('sessions').forEach(s => s.userId === id && store.del('sessions', s.id));
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Unknown API route');
}
function cleanHomework(b) {
  const o = { classId: str(b.classId, 40), sectionId: str(b.sectionId, 40), subject: str(b.subject, 60), title: str(b.title, 120) || bad('Title is required'), details: str(b.details, 3000), dueDate: str(b.dueDate, 10) };
  if (!store.get('classes', o.classId)) bad('Choose a class');
  if (o.sectionId) { const s = store.get('sections', o.sectionId); if (!s || s.classId !== o.classId) bad('That section does not belong to the chosen class'); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.dueDate)) bad('Choose a due date');
  return o;
}

/* ---------------- static files ---------------- */
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.gif': 'image/gif', '.woff2': 'font/woff2' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.resolve(ROOT, '.' + path.posix.normalize(p));
  const type = STATIC_TYPES[path.extname(f).toLowerCase()];
  // only plain web files from the project folder; never data/, config.json or server code
  if (!type || !f.startsWith(ROOT + path.sep) || f.startsWith(DATA + path.sep)) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); } res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, SEC_HEADERS)); res.end(d); });
}
function serveUpload(req, res, url, me) {
  const name = url.pathname.split('/').pop();
  if (!me || !can(me, 'homework', 'view')) { res.writeHead(403, SEC_HEADERS); return res.end('Please sign in'); }
  if (!/^[a-f0-9]{16}\.[a-z]{2,5}$/.test(name)) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
  const hw = store.all('homework').find(h => h.attachment && h.attachment.file === name);
  fs.readFile(path.join(UPLOADS, name), (e, d) => {
    if (e || !hw) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
    const type = EXT_TYPES[name.split('.').pop()] || 'application/octet-stream', inline = /^image\/|pdf/.test(type);
    res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + hw.attachment.name.replace(/[^\w. -]/g, '_') + '"' }, SEC_HEADERS));
    res.end(d);
  });
}

http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/files/')) return serveUpload(req, res, url, currentUser(req));
    return serveStatic(req, res, url);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the server' });
  }
}).listen(config.port, config.host, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  Oasis Preschool Academy is running`);
  console.log(`  On this computer:  http://localhost:${config.port}`);
  lan.forEach(ip => console.log(`  On phones (same Wi-Fi):  http://${ip}:${config.port}`));
  console.log(`  Database: ${store.kind}`);
  console.log(smtpReady() ? `  OTP emails: sent from ${config.smtp.user}` : `  OTP emails: DEMO MODE - add SMTP details to config.json to email real codes`);
  console.log(`  First login: ${store.all('users').find(u => u.roleId === 'administrator').email}\n`);
});
