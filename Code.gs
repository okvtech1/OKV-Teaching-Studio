/**
 * OKV Teaching Studio — school backend (Google Apps Script). Bind to its own Google Sheet.
 *
 * Setup (once):
 *  1. New Google Sheet "OKV Teaching Studio School". Extensions → Apps Script. Paste this file. Save.
 *  2. Select createDatabase and Run (approve access). This creates the sheets.
 *  3. Edit the three values in createAdmin at the bottom of this file, then select createAdmin and Run once.
 *     That account is the school administrator. The administrator creates teachers, classes, subjects and students in the app.
 *  4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *     Copy the /exec URL into API_URL in common.js of the hosted site.
 * The web pages are hosted separately; this script only answers API calls.
 */
var SHEETS = {
  Users:   ['id', 'name', 'email', 'role', 'salt', 'pwHash', 'createdAt', 'active', 'classId'],
  Tokens:  ['token', 'userId', 'expires'],
  Classes: ['id', 'name', 'createdAt', 'active'],
  Subjects:['id', 'name', 'classId', 'teacherId', 'createdAt'],
  Live:    ['id', 'teacherId', 'studentId', 'penHolder', 'status', 'createdAt'],
  Strokes: ['liveId', 'seq', 'author', 'json', 'ts'],
  Tests:   ['id', 'subjectId', 'teacherId', 'title', 'questions', 'createdAt', 'updatedAt'],
  Attempts:['id', 'testId', 'studentId', 'answers', 'score', 'max', 'submittedAt'],
  Marks:   ['id', 'studentId', 'subjectId', 'assessment', 'term', 'score', 'max', 'remark', 'teacherId', 'day'],
  Announcements: ['id', 'classId', 'authorId', 'text', 'createdAt'],
  Attendance:    ['id', 'classId', 'day', 'studentId', 'status', 'teacherId', 'updatedAt']
};
var ROLES = ['admin', 'teacher', 'student'];

/** Run once from the Apps Script editor. Creates every sheet with its headers. Safe to re-run. */
function createDatabase() {
  Object.keys(SHEETS).forEach(getSheet_);
  return 'School database is ready.';
}
/** Run once from the editor to create the administrator. Edit the three values first. */
function createAdmin() {
  var r = createUser_({ name: 'School Admin', email: 'admin@example.com', password: 'change-me-now' }, 'admin');
  Logger.log(JSON.stringify(r));
}
function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]); sh.setFrozenRows(1); }
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  return handle_(body);
}
function handle_(p) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var a = String(p.action || '');
    if (a === 'login') return json_(login_(p));
    var user = authed_(p.token);
    if (!user) return json_({ ok: false, error: 'Please sign in again.', signedOut: true });
    var fn = ACTIONS[a];
    if (!fn) return json_({ ok: false, error: 'Unknown action.' });
    return json_(fn(user, p));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ---------- storage helpers ---------- */
function rows_(name) {
  var sh = getSheet_(name), last = sh.getLastRow(); if (last < 2) return [];
  var cols = SHEETS[name].length, vals = sh.getRange(2, 1, last - 1, cols).getValues();
  return vals.map(function (r, i) { var o = { _row: i + 2 }; SHEETS[name].forEach(function (c, j) { o[c] = r[j]; }); return o; });
}
function append_(name, obj) {
  var sh = getSheet_(name), row = SHEETS[name].map(function (c) { return obj[c] === undefined ? '' : obj[c]; });
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}
function update_(name, rowNum, obj) {
  var sh = getSheet_(name), row = SHEETS[name].map(function (c) { return obj[c] === undefined ? '' : obj[c]; });
  sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
}
/* change some fields of an existing row, keeping the rest */
function patch_(name, row, changes) {
  var o = {}; SHEETS[name].forEach(function (c) { o[c] = row[c]; });
  Object.keys(changes).forEach(function (k) { o[k] = changes[k]; });
  update_(name, row._row, o);
}
function byId_(name, id) { return rows_(name).filter(function (r) { return r.id === id; })[0] || null; }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function hash_(salt, pw) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw)); }
function uid_() { return Utilities.getUuid(); }
function now_() { return new Date().getTime(); }
/* dates are stored as numbers (20261027) so the spreadsheet does not turn them into date values */
function day_(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Number(m[1] + m[2] + m[3]) : 0; }
function today_() { return Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'UTC', 'yyyyMMdd')); }
function isActive_(u) { return u.active !== false && String(u.active) !== 'FALSE'; }
function clean_(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, classId: u.classId || '' }; }
function err_(msg) { return { ok: false, error: msg }; }

function authed_(token) {
  if (!token) return null;
  var t = rows_('Tokens').filter(function (r) { return r.token === token; })[0];
  if (!t || Number(t.expires) < now_()) return null;
  var u = byId_('Users', t.userId);
  return u && isActive_(u) ? clean_(u) : null;
}
function requireRole_(user, roles) { if (roles.indexOf(user.role) < 0) throw new Error('You do not have permission to do this.'); }

/* ---------- class and teaching rules ---------- */
/* The administrator can do everything a teacher can, for every class and subject. */
function isAdminId_(id) { var u = byId_('Users', id); return !!u && u.role === 'admin'; }
function isStaffRole_(role) { return role === 'teacher' || role === 'admin'; }
function teachesClass_(teacherId, classId) {
  if (!classId) return false;
  if (isAdminId_(teacherId)) return !!byId_('Classes', classId);
  return rows_('Subjects').some(function (s) { return s.classId === classId && s.teacherId === teacherId; });
}
function teachesSubject_(teacherId, subjectId) {
  var s = byId_('Subjects', subjectId); if (!s) return false;
  return isAdminId_(teacherId) || s.teacherId === teacherId;
}
function myClassIds_(teacherId) {
  var ids = [];
  if (isAdminId_(teacherId)) { rows_('Classes').forEach(function (c) { ids.push(c.id); }); return ids; }
  rows_('Subjects').forEach(function (s) { if (s.teacherId === teacherId && s.classId && ids.indexOf(s.classId) < 0) ids.push(s.classId); });
  return ids;
}
function className_(classId) { var c = byId_('Classes', classId); return c ? c.name : ''; }
function userMap_() { var m = {}; rows_('Users').forEach(function (u) { m[u.id] = u; }); return m; }
function subjectMap_() { var m = {}; rows_('Subjects').forEach(function (s) { m[s.id] = s; }); return m; }

/* ---------- accounts ---------- */
function createUser_(p, role) {
  var email = String(p.email || '').trim().toLowerCase(), name = String(p.name || '').trim(), pw = String(p.password || '');
  if (!name) return err_('Enter the full name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err_('Enter a valid email address.');
  if (pw.length < 6) return err_('The password must be at least 6 characters.');
  if (rows_('Users').some(function (u) { return String(u.email).toLowerCase() === email; })) return err_('That email already has an account.');
  if (role === 'student' && !byId_('Classes', p.classId)) return err_('Choose the class for this student.');
  var salt = uid_(), u = { id: uid_(), name: name, email: email, role: role, salt: salt, pwHash: hash_(salt, pw), createdAt: now_(), active: true, classId: role === 'student' ? p.classId : '' };
  append_('Users', u);
  return { ok: true, user: clean_(u) };
}
function login_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var u = rows_('Users').filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
  if (!u || hash_(u.salt, String(p.password || '')) !== u.pwHash) return err_('Email or password is not right.');
  if (!isActive_(u)) return err_('This account is switched off. Ask the school office.');
  var token = uid_() + uid_();
  append_('Tokens', { token: token, userId: u.id, expires: now_() + 30 * 24 * 3600 * 1000 });
  return { ok: true, token: token, user: clean_(u) };
}

/* ---------- actions ---------- */
var ACTIONS = {
  me: function (user) {
    return { ok: true, user: Object.assign({}, user, { className: className_(user.classId) }) };
  },
  logout: function (user, p) {
    var t = rows_('Tokens').filter(function (r) { return r.token === p.token; })[0];
    if (t) patch_('Tokens', t, { expires: 0 }); return { ok: true };
  },

  /* ----- administrator: structure ----- */
  adminOverview: function (user) {
    requireRole_(user, ['admin']);
    var users = rows_('Users');
    return { ok: true, counts: {
      teachers: users.filter(function (u) { return u.role === 'teacher'; }).length,
      students: users.filter(function (u) { return u.role === 'student'; }).length,
      classes: rows_('Classes').length,
      subjects: rows_('Subjects').length,
      switchedOff: users.filter(function (u) { return !isActive_(u); }).length } };
  },
  createTeacher: function (user, p) { requireRole_(user, ['admin']); return createUser_(p, 'teacher'); },
  createStudent: function (user, p) { requireRole_(user, ['admin']); return createUser_(p, 'student'); },
  createClass: function (user, p) {
    requireRole_(user, ['admin']);
    var name = String(p.name || '').trim(); if (!name) return err_('Enter the class name.');
    if (rows_('Classes').some(function (c) { return String(c.name).toLowerCase() === name.toLowerCase(); })) return err_('A class with that name already exists.');
    var c = { id: uid_(), name: name, createdAt: now_(), active: true }; append_('Classes', c);
    return { ok: true, id: c.id };
  },
  createSubject: function (user, p) {
    requireRole_(user, ['admin']);
    var name = String(p.name || '').trim();
    if (!name) return err_('Enter the subject name.');
    if (!byId_('Classes', p.classId)) return err_('Choose the class for this subject.');
    if (p.teacherId && (!byId_('Users', p.teacherId) || byId_('Users', p.teacherId).role !== 'teacher')) return err_('Choose a teacher.');
    var s = { id: uid_(), name: name, classId: p.classId, teacherId: p.teacherId || '', createdAt: now_() }; append_('Subjects', s);
    return { ok: true, id: s.id };
  },
  updateSubject: function (user, p) {
    requireRole_(user, ['admin']);
    var s = rows_('Subjects').filter(function (r) { return r.id === p.id; })[0]; if (!s) return err_('Subject not found.');
    var changes = {};
    if (p.name !== undefined) { if (!String(p.name).trim()) return err_('Enter the subject name.'); changes.name = String(p.name).trim(); }
    if (p.teacherId !== undefined) {
      if (p.teacherId && (!byId_('Users', p.teacherId) || byId_('Users', p.teacherId).role !== 'teacher')) return err_('Choose a teacher.');
      changes.teacherId = p.teacherId || '';
    }
    patch_('Subjects', s, changes); return { ok: true };
  },
  moveStudent: function (user, p) {
    requireRole_(user, ['admin']);
    var u = byId_('Users', p.studentId); if (!u || u.role !== 'student') return err_('Student not found.');
    if (!byId_('Classes', p.classId)) return err_('Choose a class.');
    patch_('Users', u, { classId: p.classId }); return { ok: true };
  },
  listUsers: function (user, p) {
    requireRole_(user, ['admin']);
    var classes = {}; rows_('Classes').forEach(function (c) { classes[c.id] = c.name; });
    return { ok: true, users: rows_('Users').filter(function (u) { return !p.role || u.role === p.role; }).map(function (u) {
      return { id: u.id, name: u.name, email: u.email, role: u.role, classId: u.classId || '', className: classes[u.classId] || '', active: isActive_(u) }; }) };
  },
  listClasses: function (user) {
    var all = rows_('Classes');
    var list = user.role === 'admin' ? all
      : user.role === 'teacher' ? all.filter(function (c) { return myClassIds_(user.id).indexOf(c.id) >= 0; })
      : all.filter(function (c) { return c.id === user.classId; });
    return { ok: true, classes: list.map(function (c) { return { id: c.id, name: c.name, active: isActive_(c) }; }) };
  },
  listSubjects: function (user) {
    var um = userMap_(), cm = {}; rows_('Classes').forEach(function (c) { cm[c.id] = c.name; });
    var list = rows_('Subjects').filter(function (s) {
      return user.role === 'admin' || (user.role === 'teacher' ? s.teacherId === user.id : s.classId === user.classId); });
    return { ok: true, subjects: list.map(function (s) {
      return { id: s.id, name: s.name, classId: s.classId, className: cm[s.classId] || '', teacherId: s.teacherId || '', teacherName: (um[s.teacherId] || {}).name || '' }; }) };
  },

  /* ----- teacher: classes and students ----- */
  listStudents: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var mine = user.role === 'teacher' ? myClassIds_(user.id) : null;
    var cm = {}; rows_('Classes').forEach(function (c) { cm[c.id] = c.name; });
    var list = rows_('Users').filter(function (u) {
      if (u.role !== 'student') return false;
      if (mine && mine.indexOf(u.classId) < 0) return false;
      if (p.classId && u.classId !== p.classId) return false;
      return true;
    });
    return { ok: true, students: list.map(function (u) {
      return { id: u.id, name: u.name, email: u.email, classId: u.classId || '', className: cm[u.classId] || '', active: isActive_(u) }; }) };
  },
  myClasses: function (user) {
    requireRole_(user, ['teacher', 'admin']);
    var subs = rows_('Subjects').filter(function (s) { return user.role === 'admin' || s.teacherId === user.id; });
    var ids = myClassIds_(user.id), students = rows_('Users').filter(function (u) { return u.role === 'student'; });
    return { ok: true, classes: ids.map(function (cid) {
      return { id: cid, name: className_(cid),
        subjects: subs.filter(function (s) { return s.classId === cid; }).map(function (s) { return { id: s.id, name: s.name }; }),
        students: students.filter(function (u) { return u.classId === cid; }).map(function (u) { return { id: u.id, name: u.name, active: isActive_(u) }; }) }; }) };
  },

  /* ----- accounts: switch on/off and passwords (admin any; teacher for own students) ----- */
  setActive: function (user, p) {
    var target = byId_('Users', p.userId || p.studentId); if (!target) return err_('Account not found.');
    if (target.id === user.id) return err_('You cannot switch off your own account.');
    if (user.role !== 'admin' && !(user.role === 'teacher' && target.role === 'student' && teachesClass_(user.id, target.classId))) return err_('You do not have permission to do this.');
    patch_('Users', target, { active: p.active === false ? false : true }); return { ok: true };
  },
  setPassword: function (user, p) {
    var target = byId_('Users', p.userId || p.studentId); if (!target) return err_('Account not found.');
    if (String(p.password || '').length < 6) return err_('The password must be at least 6 characters.');
    if (user.role !== 'admin' && !(user.role === 'teacher' && target.role === 'student' && teachesClass_(user.id, target.classId))) return err_('You do not have permission to do this.');
    var salt = uid_(); patch_('Users', target, { salt: salt, pwHash: hash_(salt, p.password) }); return { ok: true };
  },

  /* ----- class features: announcements and attendance ----- */
  postAnnouncement: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    if (!teachesClass_(user.id, p.classId)) return err_('You do not teach this class.');
    var text = String(p.text || '').trim().slice(0, 2000); if (!text) return err_('Write the announcement first.');
    var a = { id: uid_(), classId: p.classId, authorId: user.id, text: text, createdAt: now_() }; append_('Announcements', a);
    return { ok: true, id: a.id };
  },
  listAnnouncements: function (user, p) {
    var cid = p.classId || (user.role === 'student' ? user.classId : '');
    if (user.role === 'teacher' && !teachesClass_(user.id, cid)) return err_('You do not teach this class.');
    if (user.role === 'student' && cid !== user.classId) return err_('Not your class.');
    var um = userMap_();
    var list = rows_('Announcements').filter(function (a) { return a.id && cid && a.classId === cid; })
      .sort(function (x, y) { return Number(y.createdAt) - Number(x.createdAt); }).slice(0, 100);
    return { ok: true, announcements: list.map(function (a) {
      return { id: a.id, text: a.text, createdAt: Number(a.createdAt), authorName: (um[a.authorId] || {}).name || '', mine: a.authorId === user.id }; }) };
  },
  deleteAnnouncement: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var a = byId_('Announcements', p.id); if (!a || (a.authorId !== user.id && user.role !== 'admin')) return err_('You can only delete your own announcements.');
    var sh = getSheet_('Announcements'); sh.getRange(a._row, 1, 1, SHEETS.Announcements.length).setValues([SHEETS.Announcements.map(function () { return ''; })]);
    return { ok: true };
  },
  saveAttendance: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    if (!teachesClass_(user.id, p.classId)) return err_('You do not teach this class.');
    var day = day_(p.date); if (!day) return err_('Choose the date.');
    var ok = ['present', 'absent', 'late'];
    var classStudents = {}; rows_('Users').forEach(function (u) { if (u.role === 'student' && u.classId === p.classId) classStudents[u.id] = true; });
    var existing = rows_('Attendance').filter(function (a) { return a.classId === p.classId && Number(a.day) === day; });
    var saved = 0;
    (p.records || []).forEach(function (r) {
      if (!classStudents[r.studentId] || ok.indexOf(r.status) < 0) return;
      var ex = existing.filter(function (a) { return a.studentId === r.studentId; })[0];
      if (ex) patch_('Attendance', ex, { status: r.status, teacherId: user.id, updatedAt: now_() });
      else append_('Attendance', { id: uid_(), classId: p.classId, day: day, studentId: r.studentId, status: r.status, teacherId: user.id, updatedAt: now_() });
      saved++;
    });
    return { ok: true, saved: saved };
  },
  listAttendance: function (user, p) {
    var day = p.date ? day_(p.date) : 0;
    var list = rows_('Attendance').filter(function (a) {
      if (user.role === 'student' && a.studentId !== user.id) return false;
      if (user.role === 'teacher' && !teachesClass_(user.id, a.classId)) return false;
      if (p.classId && a.classId !== p.classId) return false;
      if (day && Number(a.day) !== day) return false;
      return a.id !== '';
    });
    return { ok: true, attendance: list.map(function (a) {
      return { id: a.id, classId: a.classId, day: Number(a.day), studentId: a.studentId, status: a.status }; }) };
  },

  /* ----- live board: the teacher writes, the student writes only while holding the pen ----- */
  startLive: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var st = byId_('Users', p.studentId);
    if (!st || st.role !== 'student') return err_('Student not found.');
    if (!teachesClass_(user.id, st.classId)) return err_('You do not teach this student\'s class.');
    var id = uid_(); append_('Live', { id: id, teacherId: user.id, studentId: st.id, penHolder: user.id, status: 'open', createdAt: now_() });
    return { ok: true, liveId: id };
  },
  handPen: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var r = rows_('Live').filter(function (x) { return x.id === p.liveId && (x.teacherId === user.id || user.role === 'admin'); })[0];
    if (!r) return err_('Session not found.');
    patch_('Live', r, { penHolder: p.toStudent ? r.studentId : r.teacherId });
    return { ok: true, penHolder: p.toStudent ? r.studentId : r.teacherId };
  },
  endLive: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var r = rows_('Live').filter(function (x) { return x.id === p.liveId && (x.teacherId === user.id || user.role === 'admin'); })[0];
    if (r) patch_('Live', r, { status: 'closed' });
    return { ok: true };
  },
  openLive: function (user, p) {
    var list = rows_('Live').filter(function (r) { return r.status === 'open' && (user.role === 'student'
      ? r.studentId === user.id
      : (user.role === 'admin' || r.teacherId === user.id) && (!p.studentId || r.studentId === p.studentId)); });
    var r = list[list.length - 1];
    return { ok: true, live: r ? { id: r.id, studentId: r.studentId, penHolder: r.penHolder } : null };
  },
  pushOps: function (user, p) {
    var live = rows_('Live').filter(function (x) { return x.id === p.liveId; })[0];
    if (!live || live.status !== 'open') return err_('This session is closed.');
    if (user.role !== 'admin' && user.id !== live.teacherId && user.id !== live.studentId) return err_('Not your session.');
    var all = p.ops || [];
    var onlyHand = all.length > 0 && all.every(function (op) { return op && op.t === 'hand'; });
    if (user.role === 'student' && !(live.penHolder === user.id || onlyHand)) return err_('You do not have the pen right now.');
    var OPS = ['path', 'line', 'rect', 'ellipse', 'text', 'clear', 'del', 'page', 'hand'];
    var authors = null;
    var seq = rowsMaxSeq_(p.liveId), sh = getSheet_('Strokes'), rejected = 0, accepted = [];
    all.slice(0, 200).forEach(function (op) {
      if (!op || OPS.indexOf(op.t) < 0 || typeof op.id !== 'string') { rejected++; return; }
      if ((op.t === 'clear' || op.t === 'page') && !isStaffRole_(user.role)) { rejected++; return; }
      if (op.t === 'hand' && user.role !== 'student') { rejected++; return; }
      if (op.t === 'del') {
        if (typeof op.target !== 'string') { rejected++; return; }
        if (!isStaffRole_(user.role)) {
          if (!authors) { authors = {}; rows_('Strokes').forEach(function (r) { if (r.liveId === p.liveId) { try { authors[JSON.parse(r.json).id] = r.author; } catch (e) {} } }); }
          if (authors[op.target] !== user.id) { rejected++; return; }
        }
      }
      var js = JSON.stringify(op);
      if (js.length > 45000) { rejected++; return; }
      accepted.push(js);
    });
    accepted.forEach(function (js) { seq++; sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setValues([[p.liveId, seq, user.id, js, now_()]]); });
    return { ok: true, seq: seq, rejected: rejected };
  },
  pollOps: function (user, p) {
    var live = rows_('Live').filter(function (x) { return x.id === p.liveId; })[0];
    if (!live) return err_('Session not found.');
    if (user.role !== 'admin' && user.id !== live.teacherId && user.id !== live.studentId) return err_('Not your session.');
    var since = Number(p.since) || 0;
    var ops = rows_('Strokes').filter(function (r) { return r.liveId === p.liveId && Number(r.seq) > since; })
      .sort(function (a, b) { return a.seq - b.seq; }).slice(0, 300)
      .map(function (r) { return { seq: Number(r.seq), author: r.author, op: JSON.parse(r.json) }; });
    return { ok: true, ops: ops, penHolder: live.penHolder, status: live.status, serverTime: now_() };
  },

  /* ----- tests ----- */
  saveTest: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var t = p.test || {}; if (!t.title) return err_('Give the test a title.');
    if (!teachesSubject_(user.id, t.subjectId)) return err_('You do not teach this subject.');
    var qs = (t.questions || []).filter(function (q) { return q.text; });
    if (!qs.length) return err_('Add at least one question.');
    var id = t.id || uid_(), existing = byId_('Tests', id);
    if (existing && !teachesSubject_(user.id, existing.subjectId)) return err_('You do not teach this subject.');
    var row = { id: id, subjectId: t.subjectId, teacherId: user.id, title: String(t.title), questions: JSON.stringify(qs), createdAt: existing ? existing.createdAt : now_(), updatedAt: now_() };
    if (existing) patch_('Tests', existing, row); else append_('Tests', row);
    return { ok: true, id: id };
  },
  listTests: function (user) {
    var subjects = subjectMap_();
    var list = rows_('Tests').filter(function (t) {
      if (user.role === 'admin') return true;
      if (user.role === 'teacher') return teachesSubject_(user.id, t.subjectId);
      var s = subjects[t.subjectId]; return !!s && s.classId === user.classId;
    });
    return { ok: true, tests: list.map(function (t) {
      var qs = JSON.parse(t.questions || '[]');
      if (user.role === 'student') qs = qs.map(function (q) { var c = Object.assign({}, q); delete c.answer; delete c.correct; return c; });
      return { id: t.id, subjectId: t.subjectId, subjectName: (subjects[t.subjectId] || {}).name || '', title: t.title, questions: qs, updatedAt: Number(t.updatedAt) }; }) };
  },
  submitAttempt: function (user, p) {
    requireRole_(user, ['student']);
    var t = byId_('Tests', p.testId); if (!t) return err_('Test not found.');
    var s = byId_('Subjects', t.subjectId);
    if (!s || s.classId !== user.classId) return err_('This test is not for your class.');
    if (rows_('Attempts').some(function (a) { return a.testId === p.testId && a.studentId === user.id; })) return err_('You have already taken this test.');
    var qs = JSON.parse(t.questions || '[]'), ans = p.answers || [], score = 0, max = 0;
    qs.forEach(function (q, i) { var pts = Number(q.points) || 1; max += pts; if (markQ_(q, ans[i])) score += pts; });
    append_('Attempts', { id: uid_(), testId: p.testId, studentId: user.id, answers: JSON.stringify(ans), score: score, max: max, submittedAt: now_() });
    return { ok: true, score: score, max: max };
  },
  listAttempts: function (user, p) {
    var um = userMap_();
    var list = rows_('Attempts').filter(function (a) {
      if (user.role === 'student') return a.studentId === user.id;
      if (user.role === 'admin') return !p.testId || a.testId === p.testId;
      var t = byId_('Tests', a.testId); return !!t && teachesSubject_(user.id, t.subjectId) && (!p.testId || a.testId === p.testId);
    });
    return { ok: true, attempts: list.map(function (a) {
      return { id: a.id, testId: a.testId, studentId: a.studentId, studentName: (um[a.studentId] || {}).name || '', score: Number(a.score), max: Number(a.max), submittedAt: Number(a.submittedAt) }; }) };
  },

  /* ----- marks and results ----- */
  saveMark: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var m = p.mark || {};
    if (!m.studentId || !m.subjectId || !m.assessment) return err_('Choose the student, subject and assessment.');
    if (!teachesSubject_(user.id, m.subjectId)) return err_('You do not teach this subject.');
    var sub = byId_('Subjects', m.subjectId), st = byId_('Users', m.studentId);
    if (!st || st.role !== 'student' || st.classId !== sub.classId) return err_('This student is not in that subject\'s class.');
    var score = Number(m.score), max = Number(m.max);
    if (isNaN(score) || isNaN(max) || max <= 0 || score < 0 || score > max) return err_('Check the score: it must be between 0 and the maximum.');
    var id = m.id || uid_(), ex = byId_('Marks', id);
    var row = { id: id, studentId: m.studentId, subjectId: m.subjectId, assessment: String(m.assessment), term: String(m.term || ''), score: score, max: max,
      remark: String(m.remark || ''), teacherId: user.id, day: day_(m.date) || today_() };
    if (ex) patch_('Marks', ex, row); else append_('Marks', row);
    return { ok: true, id: id };
  },
  deleteMark: function (user, p) {
    requireRole_(user, ['teacher', 'admin']);
    var r = byId_('Marks', p.id);
    if (r && (r.teacherId === user.id || user.role === 'admin')) { getSheet_('Marks').getRange(r._row, 1, 1, SHEETS.Marks.length).setValues([SHEETS.Marks.map(function () { return ''; })]); }
    return { ok: true };
  },
  listMarks: function (user, p) {
    var um = userMap_(), subjects = subjectMap_(), cm = {}; rows_('Classes').forEach(function (c) { cm[c.id] = c.name; });
    var list = rows_('Marks').filter(function (m) {
      if (!m.id) return false;
      if (user.role === 'student') return m.studentId === user.id;
      if (p.studentId && m.studentId !== p.studentId) return false;
      if (user.role === 'admin') return true;
      return teachesSubject_(user.id, m.subjectId);
    });
    return { ok: true, marks: list.map(function (m) {
      var sub = subjects[m.subjectId] || {};
      return { id: m.id, studentId: m.studentId, studentName: (um[m.studentId] || {}).name || '', subjectId: m.subjectId, subject: sub.name || '',
        className: cm[sub.classId] || '', assessment: m.assessment, term: m.term, score: Number(m.score), max: Number(m.max), remark: m.remark,
        date: Number(m.day), mine: m.teacherId === user.id }; }) };
  }
};
function rowsMaxSeq_(liveId) { var m = 0; rows_('Strokes').forEach(function (r) { if (r.liveId === liveId && Number(r.seq) > m) m = Number(r.seq); }); return m; }
function markQ_(q, a) {
  if (a === undefined || a === null || a === '') return false;
  if (q.type === 'mcq') return Number(a) === Number(q.correct);
  if (q.type === 'tf') return String(a) === String(q.correct);
  if (q.type === 'short') return String(q.answer || '').trim().toLowerCase() === String(a).trim().toLowerCase();
  return false; /* essays and other manual items are marked by the teacher */
}
