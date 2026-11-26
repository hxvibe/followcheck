/* followcheck web app */
(() => {
  'use strict';

  const PAGE = 200;
  const $app = document.getElementById('app');

  // ---------- 저장소 ----------
  const store = {
    get(k, json) {
      try { const v = localStorage.getItem('fc:' + k); return json ? JSON.parse(v || 'null') : v; } catch (_) { return null; }
    },
    set(k, v) {
      try {
        if (v == null) localStorage.removeItem('fc:' + k);
        else localStorage.setItem('fc:' + k, typeof v === 'string' ? v : JSON.stringify(v));
      } catch (_) { /* 저장 공간 부족 등 */ }
    },
  };

  const S = {
    token: store.get('token'),
    user: store.get('user', true),
    access: store.get('access') || '',
    accessRequired: false,
    // API 서버 주소. 비어 있으면 이 페이지와 같은 서버 (집 PC/Render에서 직접 열었을 때)
    server: store.get('server') || '',
    serverOk: false,
    needServer: false,
    tab: 'notBack',
    q: '',
    limit: PAGE,
    poll: 0, // 진행 중인 폴링 세대 (화면 전환 시 이전 폴링 중지)
  };

  // ---------- 유틸 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '–');
  const timeAgo = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return Math.floor(s / 86400) + '일 전';
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.append(u);
    return s;
  }
  function avatar(u, cls) {
    const a = h('div', { class: 'avatar' + (cls ? ' ' + cls : '') }, (u.username || '?').slice(0, 1).toUpperCase());
    if (u.pic) {
      const img = h('img', { src: u.pic, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      a.append(img);
    }
    return a;
  }
  function render(...nodes) {
    $app.textContent = '';
    $app.append(h('div', { class: 'screen' }, nodes));
    document.getElementById('logout-btn').hidden = !S.token;
  }
  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }
  const alertBox = (msg, kind) => msg ? h('div', { class: 'alert' + (kind ? ' ' + kind : ''), role: 'alert' }, icon(kind === 'info' ? 'shield' : 'alert'), h('div', null, msg)) : null;

  const apiUrl = (path) => (S.server ? S.server + '/' : '') + path;
  const normServer = (v) => {
    v = (v || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  };

  // 서버 연결 확인 (+ 접근 코드 필요 여부)
  async function probe() {
    try {
      const res = await fetch(apiUrl('api/config'), { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || typeof d.access_required !== 'boolean') throw new Error();
      S.accessRequired = d.access_required;
      S.serverOk = true;
      S.needServer = false;
    } catch (_) {
      S.serverOk = false;
      S.needServer = true;
    }
    return S.serverOk;
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (S.access) headers['X-Access-Code'] = S.access;
    let res;
    try {
      res = await fetch(apiUrl(path), { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
    } catch (_) {
      const e = new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
      e.network = true;
      throw e;
    }
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty */ }
    if (!res.ok) {
      const e = new Error((data && data.detail) || '서버 오류가 발생했어요. (' + res.status + ')');
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // ---------- 테마 ----------
  const themeBtn = document.getElementById('theme-btn');
  const mq = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = store.get('theme') || 'system';
    const dark = t === 'dark' || (t === 'system' && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.getElementById('theme-color').setAttribute('content', dark ? '#0a0f1a' : '#f5f7fb');
    themeBtn.replaceChildren(icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor'));
    const label = { system: '시스템 설정', light: '라이트 모드', dark: '다크 모드' }[t];
    themeBtn.setAttribute('aria-label', '테마: ' + label + ' (눌러서 변경)');
    themeBtn.title = '테마: ' + label;
    return label;
  }
  themeBtn.addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const cur = store.get('theme') || 'system';
    store.set('theme', order[(order.indexOf(cur) + 1) % 3]);
    toast(applyTheme());
  });
  mq.addEventListener('change', applyTheme);
  applyTheme();

  const appbar = document.getElementById('appbar');
  addEventListener('scroll', () => appbar.classList.toggle('scrolled', scrollY > 4), { passive: true });

  document.getElementById('logout-btn').addEventListener('click', () => {
    if (!confirm('로그아웃할까요?\n이 기기에 저장된 세션과 확인 결과가 삭제돼요.')) return;
    logout();
  });
  function logout(message) {
    const keep = store.get('theme');
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('fc:') && !['fc:theme', 'fc:access', 'fc:server'].includes(k)).forEach((k) => localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
    store.set('theme', keep);
    S.token = null;
    S.user = null;
    S.poll++;
    showLogin(message);
  }

  // ---------- 로그인 ----------
  function showLogin(error, prefill, info) {
    S.poll++;
    const user = h('input', { class: 'input', id: 'u', name: 'username', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', required: true, value: prefill || '' });
    const pw = h('input', { class: 'input', id: 'p', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const eye = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '비밀번호 보기' }, icon('eye'));
    eye.addEventListener('click', () => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      eye.replaceChildren(icon(show ? 'eye-off' : 'eye'));
      eye.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
    });
    const showServer = S.needServer || !!S.server;
    const serverIn = h('input', { class: 'input', id: 's', type: 'url', inputmode: 'url', autocomplete: 'url', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://followcheck-xxxx.onrender.com', value: S.server });
    const server = showServer ? h('label', { class: 'field' }, h('span', null, '서버 주소'), serverIn,
      h('small', { class: 'help' }, 'Render나 집 PC에서 실행 중인 followcheck 서버 주소')) : null;
    const access = S.accessRequired ? h('label', { class: 'field' }, h('span', null, '접근 코드'),
      h('input', { class: 'input', id: 'a', type: 'password', autocomplete: 'off', value: S.access, required: true })) : null;
    const btn = h('button', { class: 'btn block', type: 'submit' }, '로그인');
    const errSlot = h('div', null, alertBox(error));

    const form = h('form', { class: 'card', novalidate: true },
      alertBox(info, 'info'),
      errSlot,
      server,
      access,
      h('label', { class: 'field' }, h('span', null, '인스타그램 아이디'), user),
      h('label', { class: 'field' }, h('span', null, '비밀번호'), h('div', { class: 'input-wrap' }, pw, eye)),
      btn,
      h('div', { class: 'note' }, icon('shield'),
        h('div', null, '비밀번호는 로그인에만 쓰이고 저장되지 않아요. 로그인 세션은 암호화되어 이 기기에만 보관돼요.')));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (access) { S.access = access.querySelector('input').value.trim(); store.set('access', S.access); }
      if (server) {
        const v = normServer(serverIn.value);
        if (!v) { errSlot.replaceChildren(alertBox('서버 주소를 입력해 주세요.')); serverIn.focus(); return; }
        if (v !== S.server) { S.server = v; S.serverOk = false; store.set('server', v); }
      }
      if (!user.value.trim() || !pw.value) {
        errSlot.replaceChildren(alertBox('아이디와 비밀번호를 입력해 주세요.'));
        (user.value.trim() ? pw : user).focus();
        return;
      }
      const reset = () => { btn.disabled = false; btn.textContent = '로그인'; };
      btn.disabled = true;
      errSlot.replaceChildren();
      if (!S.serverOk) {
        btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), '서버 연결 중…');
        const hadAccess = !!access;
        if (!(await probe())) {
          reset();
          errSlot.replaceChildren(alertBox('서버에 연결할 수 없어요. 주소를 확인해 주세요. 무료 서버는 잠들어 있으면 깨어나는 데 30초~1분 걸려요.'));
          return;
        }
        if (S.accessRequired && !hadAccess) {
          return showLogin(null, user.value.trim(), '이 서버는 접근 코드가 필요해요.');
        }
      }
      btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), '로그인 중…');
      try {
        const { job } = await api('api/login', { method: 'POST', body: { username: user.value.trim(), password: pw.value } });
        pollLogin(job, user.value.trim());
      } catch (err) {
        reset();
        if (err.status === 403) S.serverOk = false;
        errSlot.replaceChildren(alertBox(err.message));
      }
    });
    form.addEventListener('input', () => { form.dataset.dirty = '1'; }, { once: true });

    render(
      h('section', { class: 'hero' },
        h('div', { class: 'mark' }, icon('swap')),
        h('h1', null, '맞팔, 한 번에 확인'),
        h('p', { class: 'muted' }, '인스타그램 계정으로 로그인하면 맞팔 여부를 바로 보여드려요.'),
        h('div', { class: 'features' },
          h('div', { class: 'feature' }, icon('user-x'), h('b', null, '나만 팔로우'), '맞팔 안 한 사람'),
          h('div', { class: 'feature' }, icon('users'), h('b', null, '상대만 팔로우'), '나만 안 한 사람'),
          h('div', { class: 'feature' }, icon('history'), h('b', null, '변화 추적'), '언팔한 사람'))),
      form);
    setTimeout(() => {
      const target = server && !S.server ? serverIn : access && !S.access ? access.querySelector('input') : prefill ? pw : user;
      target.focus({ preventScroll: true });
    }, 50);
  }

  async function pollLogin(job, username) {
    const gen = ++S.poll;
    let shownRound = -1;
    let submittedRound = -1;
    let codeUI = null;
    while (gen === S.poll) {
      let d;
      try {
        d = await api('api/login/' + job);
      } catch (err) {
        if (err.network) { await sleep(2000); continue; }
        if (gen === S.poll) showLogin(err.message, username);
        return;
      }
      if (gen !== S.poll) return;
      if (d.status === 'ok') {
        S.token = d.token;
        S.user = d.user;
        store.set('token', d.token);
        store.set('user', d.user);
        showHome();
        if (!lastResult()) startScan();
        return;
      }
      if (d.status === 'error') { showLogin(d.message, username); return; }
      if (d.status === 'need_code' && d.code_round !== shownRound && d.code_round !== submittedRound) {
        shownRound = d.code_round;
        codeUI = showCode(d, async (code) => {
          submittedRound = d.code_round;
          await api('api/login/' + job + '/code', { method: 'POST', body: { code } });
        }, () => showLogin(null, username));
      } else if (d.status === 'running' && codeUI) {
        codeUI.busy();
      }
      await sleep(1000);
    }
  }

  function showCode(d, submit, back) {
    const kind = d.code_kind, method = d.code_method;
    const title = kind === 'two_factor' ? '2단계 인증' : '보안 확인';
    const desc = kind === 'two_factor'
      ? '인증 앱 또는 문자(SMS)로 받은 6자리 코드를 입력하세요.'
      : method === 'email' ? '인스타그램이 가입 이메일로 보안 코드를 보냈어요.' : '인스타그램이 휴대폰 문자로 보안 코드를 보냈어요.';
    const input = h('input', { class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '8', 'aria-label': '인증 코드' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, '확인');
    const errSlot = h('div', null, alertBox(d.message));
    const busy = () => { btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), '확인 중…'); };
    const form = h('form', { class: 'card', novalidate: true },
      h('h2', null, title),
      h('p', { class: 'muted small' }, desc),
      errSlot,
      h('label', { class: 'field' }, input),
      btn,
      h('div', { class: 'note' }, icon('alert'), h('div', null, '코드는 5분 안에 입력해 주세요. 다른 앱에서 코드를 확인하고 돌아와도 괜찮아요.')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.replace(/\D/g, '');
      if (code.length < 4) { errSlot.replaceChildren(alertBox('코드를 정확히 입력해 주세요.')); input.focus(); return; }
      busy();
      errSlot.replaceChildren();
      try { await submit(code); } catch (err) { back(); toast(err.message); }
    });
    render(
      h('div', { style: 'padding:8px 0 12px' },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: back }, icon('arrow-left'), '처음으로')),
      form);
    setTimeout(() => input.focus(), 50);
    return { busy };
  }

  // ---------- 결과 저장/계산 ----------
  const uid = () => (S.user && S.user.id) || 'me';
  const lastResult = () => store.get('last:' + uid(), true);

  function saveResult(result) {
    const prev = lastResult();
    if (prev) {
      const m = {};
      for (const u of prev.followers) m[u.id] = u.username;
      store.set('prev:' + uid(), { at: prev.at, followers: m });
    }
    store.set('last:' + uid(), result);
  }

  function compute(r) {
    const followers = new Map(r.followers.map((u) => [u.id, u]));
    const following = new Map(r.following.map((u) => [u.id, u]));
    const mutual = [], notBack = [], fans = [];
    for (const [id, u] of following) (followers.has(id) ? mutual : notBack).push(u);
    for (const [id, u] of followers) if (!following.has(id)) fans.push(u);
    let changes = null;
    const prev = store.get('prev:' + uid(), true);
    if (prev && prev.followers) {
      const lost = [], gained = [];
      for (const id of Object.keys(prev.followers)) {
        if (!followers.has(id)) {
          const cur = following.get(id);
          lost.push({ ...(cur || { id, username: prev.followers[id], name: '', pic: '' }), tag: 'lost' });
        }
      }
      for (const [id, u] of followers) if (!(id in prev.followers)) gained.push({ ...u, tag: 'gained' });
      changes = { since: prev.at, lost, gained, list: [...lost, ...gained] };
    }
    return { followers, following, mutual, notBack, fans, changes };
  }

  // ---------- 홈 ----------
  function profileCard(r) {
    const u = (r && r.me) || S.user || {};
    return h('div', { class: 'card' },
      h('div', { class: 'profile' },
        avatar(u, 'lg'),
        h('div', { class: 'who' },
          h('div', { class: 'un' }, '@' + (u.username || '')),
          h('div', { class: 'counts' },
            h('span', null, '팔로워 ', h('b', null, fmt(u.followers))),
            h('span', null, '팔로잉 ', h('b', null, fmt(u.following)))))),
      r ? h('div', { class: 'last' },
        h('span', { class: 'muted small' }, '마지막 확인 ' + timeAgo(r.at)),
        h('button', { class: 'btn sm secondary', type: 'button', onclick: startScan }, icon('refresh'), '다시 확인'))
        : h('div', { style: 'margin-top:16px' },
          h('button', { class: 'btn block', type: 'button', onclick: startScan }, '맞팔 확인하기')));
  }

  function showHome(message) {
    S.poll++;
    const r = lastResult();
    if (!r) { render(alertBox(message, 'info'), profileCard(null), footNote()); return; }
    showResults(r, message);
  }

  const footNote = () => h('p', { class: 'foot' }, '인스타그램 비공식 API를 사용해요. 하루 몇 번 정도만 확인하는 게 안전해요.');

  // ---------- 스캔 ----------
  async function startScan() {
    let job;
    try {
      ({ job } = await api('api/scan', { method: 'POST', body: { token: S.token } }));
    } catch (err) {
      if (err.status === 401) return logout(err.message);
      toast(err.message);
      return;
    }
    store.set('scanjob', job);
    pollScan(job);
  }

  async function pollScan(job) {
    const gen = ++S.poll;
    const el = {
      phase: h('span'), fTxt: h('span'), gTxt: h('span'), fBar: h('i'), gBar: h('i'),
      note: h('div', { class: 'pnote' }),
    };
    const cancel = h('button', { class: 'btn block ghost', type: 'button' }, '중지');
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await api('api/scan/' + job + '/cancel', { method: 'POST' }); } catch (_) { /* ignore */ }
    });
    render(
      h('div', { class: 'card' },
        h('div', { class: 'phase' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), el.phase),
        h('div', { class: 'prow' }, h('b', null, '팔로워'), el.fTxt), h('div', { class: 'bar' }, el.fBar),
        h('div', { class: 'prow' }, h('b', null, '팔로잉'), el.gTxt), h('div', { class: 'bar' }, el.gBar),
        el.note,
        cancel,
        h('div', { class: 'note' }, icon('shield'), h('div', null, '계정 보호를 위해 일부러 천천히 불러와요. 팔로워가 많으면 몇 분 걸릴 수 있어요. 화면을 닫아도 서버에서 계속 진행되고, 다시 열면 이어서 보여드려요.'))));

    while (gen === S.poll) {
      let d;
      try {
        d = await api('api/scan/' + job);
      } catch (err) {
        if (err.network) { await sleep(2500); continue; }
        store.set('scanjob', null);
        if (gen === S.poll) showHome(err.status === 404 ? '진행 중이던 확인이 끊겼어요. 다시 확인해 주세요.' : err.message);
        return;
      }
      if (gen !== S.poll) return;
      const p = d.progress || {};
      el.phase.textContent = { me: '계정 정보 확인 중…', followers: '팔로워 불러오는 중…', following: '팔로잉 불러오는 중…', done: '정리 중…' }[p.phase] || '진행 중…';
      const bar = (b, t, n, total) => {
        t.textContent = fmt(n) + (total ? ' / ' + fmt(total) : '') + '명';
        b.style.width = total ? Math.min(100, (n / total) * 100).toFixed(1) + '%' : '0%';
      };
      bar(el.fBar, el.fTxt, p.followers || 0, p.followers_total);
      bar(el.gBar, el.gTxt, p.following || 0, p.following_total);
      el.note.textContent = p.note || '';

      if (d.status !== 'running') store.set('scanjob', null);
      if (d.status === 'ok') {
        S.token = d.token;
        store.set('token', d.token);
        S.user = { ...S.user, ...d.result.me };
        store.set('user', S.user);
        saveResult(d.result);
        S.tab = 'notBack'; S.q = ''; S.limit = PAGE;
        showResults(d.result);
        toast('확인 완료');
        return;
      }
      if (d.status === 'auth') return logout(d.message);
      if (d.status === 'error' || d.status === 'cancelled') { showHome(d.message); return; }
      await sleep(1200);
    }
  }

  // ---------- 결과 ----------
  const TABS = [
    { key: 'notBack', label: '나만 팔로우', desc: '내가 팔로우하지만, 나를 팔로우하지 않는 사람' },
    { key: 'fans', label: '상대만 팔로우', desc: '나를 팔로우하지만, 내가 팔로우하지 않는 사람' },
    { key: 'mutual', label: '맞팔', desc: '서로 팔로우하는 사람' },
    { key: 'changes', label: '변화', desc: '' },
  ];
  let R = null;

  function showResults(r, message) {
    S.poll++;
    R = compute(r);
    if (S.tab === 'changes' && !R.changes) S.tab = 'notBack';
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '목록 종류' });
    for (const t of TABS) {
      if (t.key === 'changes' && !R.changes) continue;
      const n = t.key === 'changes' ? R.changes.list.length : R[t.key].length;
      tabs.append(h('button', {
        class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(S.tab === t.key),
        onclick: () => { S.tab = t.key; S.limit = PAGE; showResults(r); },
      }, t.label, h('span', { class: 'c' }, fmt(n))));
    }
    let desc = TABS.find((t) => t.key === S.tab).desc;
    if (S.tab === 'changes') desc = timeAgo(R.changes.since) + ' 확인 이후 · 나를 언팔 ' + R.changes.lost.length + '명 · 새 팔로워 ' + R.changes.gained.length + '명';

    const search = h('input', {
      class: 'input', type: 'search', placeholder: '아이디·이름 검색', 'aria-label': '아이디 또는 이름 검색', value: S.q,
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      oninput: (e) => { S.q = e.target.value; S.limit = PAGE; renderList(); },
    });
    render(
      alertBox(message, 'info'),
      profileCard(r),
      h('div', { class: 'stats' },
        stat('팔로워', R.followers.size), stat('팔로잉', R.following.size), stat('맞팔', R.mutual.length)),
      tabs,
      h('p', { class: 'desc' }, desc),
      h('div', { class: 'tools' },
        h('label', { class: 'search' }, icon('search'), search),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '아이디 목록 복사', title: '아이디 목록 복사', onclick: copyList }, icon('copy')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'CSV로 저장', title: 'CSV로 저장', onclick: downloadCSV }, icon('download'))),
      h('ul', { class: 'list', id: 'list' }),
      footNote());
    renderList();
  }

  const stat = (label, n) => h('div', { class: 'stat' }, h('div', { class: 'num' }, fmt(n)), h('div', { class: 'lab' }, label));

  function currentList() {
    let list = S.tab === 'changes' ? R.changes.list : R[S.tab];
    const q = S.q.trim().toLowerCase().replace(/^@/, '');
    if (q) list = list.filter((u) => (u.username || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q));
    return list;
  }

  function renderList() {
    const ul = document.getElementById('list');
    if (!ul) return;
    ul.textContent = '';
    const list = currentList();
    if (!list.length) {
      ul.append(h('li', { class: 'empty' }, icon(S.q ? 'search' : 'party'), h('div', null, S.q ? '검색 결과가 없어요' : '해당하는 사람이 없어요')));
      return;
    }
    for (const u of list.slice(0, S.limit)) ul.append(row(u));
    if (list.length > S.limit) {
      ul.append(h('li', { class: 'more' }, h('button', {
        class: 'btn sm ghost', type: 'button', onclick: () => { S.limit += PAGE; renderList(); },
      }, '더 보기 (' + fmt(list.length - S.limit) + '명 남음)')));
    }
  }

  function row(u) {
    const badges = [];
    if (u.ver) badges.push(h('span', { class: 'badge ver', title: '인증된 계정' }, icon('verified'), h('span', { class: 'sr-only' }, '인증됨')));
    if (u.priv) badges.push(h('span', { class: 'badge priv', title: '비공개 계정' }, icon('lock'), h('span', { class: 'sr-only' }, '비공개')));
    if (u.tag === 'lost') badges.push(h('span', { class: 'badge lost' }, '나를 언팔'));
    if (u.tag === 'gained') badges.push(h('span', { class: 'badge gained' }, '새 팔로워'));
    return h('li', null, h('a', {
      class: 'row', href: 'https://www.instagram.com/' + encodeURIComponent(u.username || '') + '/', target: '_blank', rel: 'noopener noreferrer',
    },
    avatar(u),
    h('div', { class: 'who' },
      h('div', { class: 'un' }, h('span', null, u.username || '(알 수 없음)'), badges),
      u.name ? h('div', { class: 'nm' }, u.name) : null),
    icon('chevron', 'chev')));
  }

  async function copyList() {
    const list = currentList();
    const text = list.map((u) => u.username).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(list.length + '명의 아이디를 복사했어요');
  }

  function downloadCSV() {
    const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const lines = ['username,full_name,id,private,verified,profile'];
    for (const u of currentList()) {
      lines.push([u.username, u.name, u.id, u.priv ? 1 : 0, u.ver ? 1 : 0, 'https://www.instagram.com/' + u.username + '/'].map(esc).join(','));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: 'followcheck-' + S.tab + '-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // ---------- 시작 ----------
  (async () => {
    if (!S.token) {
      // 로그인 화면을 먼저 띄우고, 서버 확인 결과에 따라 필요하면 다시 그림 (입력 중이면 그대로 둠)
      showLogin();
      await probe();
      const form = $app.querySelector('form');
      const shown = { server: !!$app.querySelector('#s'), access: !!$app.querySelector('#a') };
      const want = { server: S.needServer || !!S.server, access: S.accessRequired };
      if (form && !form.dataset.dirty && (shown.server !== want.server || shown.access !== want.access)) showLogin();
      return;
    }
    probe();
    const job = store.get('scanjob');
    if (job) return pollScan(job);
    showHome();
  })();
})();
