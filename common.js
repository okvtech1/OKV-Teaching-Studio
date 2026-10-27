/* OKV Teaching Studio — shared client code. Host these files anywhere static (GitHub Pages, Netlify, your own server).
   Paste the /exec URL from the Apps Script deployment into API_URL below. */
const API_URL = 'PASTE_APPS_SCRIPT_EXEC_URL_HERE';

const Api = {
  /* POST with text/plain avoids a CORS preflight, which Apps Script cannot answer. */
  async call(action, data = {}) {
    if (API_URL.startsWith('PASTE_')) throw new Error('Set API_URL in common.js first.');
    const token = Session.token();
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token, ...data })
      });
    } catch (e) { throw new Error('Cannot reach the server. Check your internet connection.'); }
    let out;
    try { out = await res.json(); } catch (e) { throw new Error('The server sent an unexpected reply.'); }
    if (out.signedOut) { Session.clear(); location.href = 'index.html'; throw new Error(out.error); }
    if (!out.ok) throw new Error(out.error || 'Something went wrong.');
    return out;
  }
};

const Session = {
  key: 'okv-school-session',
  get() { try { return JSON.parse(localStorage.getItem(this.key)) || null; } catch (e) { return null; } },
  set(s) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) {} },
  clear() { try { localStorage.removeItem(this.key); } catch (e) {} },
  token() { const s = this.get(); return s ? s.token : ''; },
  user() { const s = this.get(); return s ? s.user : null; },
  /* Call on every protected page. Sends people to sign-in, or to their own home page if the role is wrong. */
  require(role) {
    const u = this.user();
    if (!u) { location.href = 'index.html'; return null; }
    /* the administrator may open any teacher page */
    const allowed = !role || u.role === role || (role === 'teacher' && u.role === 'admin');
    if (!allowed) { location.href = Session.home(u.role); return null; }
    return u;
  },
  home(role) { return role === 'admin' ? 'admin.html' : role === 'teacher' ? 'teacher.html' : 'student.html'; }
};

const Ui = {
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  msg(el, text, bad) { el.textContent = text || ''; el.className = bad ? 'msg bad' : 'msg'; },
  signOutButton() {
    const b = document.getElementById('signout');
    if (b) b.onclick = async () => {
      try { await Api.call('logout'); } catch (e) {}
      Session.clear(); location.href = 'index.html';
    };
  }
};

/* CSV helpers: values are quoted, and spreadsheet formula injection is blocked by prefixing a quote. */
const Csv = {
  cell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  },
  download(filename, rows) {
    const text = '﻿' + rows.map(r => r.map(Csv.cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

/* Share links: admins and teachers send people to install.html, which installs the app and then opens sign-in. */
const Share = {
  url(forRole) {
    const u = new URL('install.html', location.href);
    if (forRole) u.search = '?for=' + encodeURIComponent(forRole);
    return u.href;
  },
  /* mounts a share panel into el. links: [{label, role}] */
  mount(el, links) {
    el.innerHTML = '';
    links.forEach(({ label, role }) => {
      const url = Share.url(role);
      const box = document.createElement('div'); box.className = 'share';
      box.innerHTML = `<div><b>${Ui.esc(label)}</b></div>
        <div class="share-row"><input readonly value="${Ui.esc(url)}" class="share-url">
        <button type="button" class="copy">Copy link</button>
        <a class="wa" target="_blank" rel="noopener">WhatsApp</a>
        <button type="button" class="native ghost">Share…</button></div>
        <div class="muted">Opens the install page. After installing, the person signs in with the account you gave them.</div>`;
      const input = box.querySelector('.share-url');
      box.querySelector('.copy').onclick = async () => {
        input.select();
        try { await navigator.clipboard.writeText(url); box.querySelector('.copy').textContent = 'Copied'; }
        catch (e) { document.execCommand('copy'); box.querySelector('.copy').textContent = 'Copied'; }
        setTimeout(() => box.querySelector('.copy').textContent = 'Copy link', 1500);
      };
      box.querySelector('.wa').href = 'https://wa.me/?text=' + encodeURIComponent(`Install the OKV School app here, then sign in: ${url}`);
      const native = box.querySelector('.native');
      if (navigator.share) native.onclick = () => navigator.share({ title: 'OKV School', text: 'Install the OKV School app, then sign in.', url }).catch(() => {});
      else native.hidden = true;
      el.appendChild(box);
    });
  }
};

/* Offline support: the app shell is cached so the installed app opens without a connection. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
