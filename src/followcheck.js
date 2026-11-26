/*!
 * followcheck — 인스타그램 맞팔 확인 (비공식, 개인용)
 * instagram.com 에 로그인된 상태에서 실행됩니다.
 *  - 안드로이드 앱: 인스타 로그인 후 자동 실행 (window.FCApp 브리지 제공)
 *  - 아이폰/PC: 북마크(북마클릿)로 실행
 * 로그인 세션으로 인스타 웹 내부 API를 직접 호출하며, 데이터는 이 기기 밖으로 나가지 않습니다.
 */
(() => {
  'use strict';

  const VERSION = '2.0.0';
  const HOST_ID = '__followcheck_host__';
  const APP_ID = '936619743392459'; // 인스타그램 웹 클라이언트 App ID
  const PAGE = 200;
  const APP = typeof window.FCApp === 'object' && window.FCApp !== null; // 안드로이드 앱 안에서 실행 중

  // ---------- 아이콘 (Lucide 기반, path 전용) ----------
  const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const ICONS = {
    swap: 'm16 3 4 4-4 4M20 7H4m4 14-4-4 4-4M4 17h16',
    sun: C(12, 12, 4) + 'M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
    moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
    monitor: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 21h8m-4-4v4',
    x: 'M18 6 6 18M6 6l12 12',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
    search: C(11, 11, 8) + 'M21 21l-4.3-4.3',
    copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2ZM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3',
    share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8m-4-6-4-4-4 4m4-4v13',
    chevron: 'm9 18 6-6-6-6',
    refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8m0-5v5h-5m5 4a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16m5 0H3v5',
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm2 0V7a5 5 0 0 1 10 0v4',
    verified: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Zm5.15 3.38 2 2 4-4',
    alert: C(12, 12, 10) + 'M12 8v4m0 4h.01',
    check: 'M20 6 9 17l-5-5',
    shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zm-11-1 2 2 4-4',
  };

  function boot() {
    if (!/(^|\.)instagram\.com$/.test(location.hostname)) {
      if (confirm('followcheck는 instagram.com 에서 실행해야 해요.\n인스타그램으로 이동할까요? (로그인 후 다시 실행)')) {
        location.href = 'https://www.instagram.com/';
      }
      return;
    }
    if (document.getElementById(HOST_ID)) return;

    // ---------- 유틸 ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const jitter = (base, spread) => base + Math.floor(Math.random() * spread);
    const cookie = (name) => {
      const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
      return m ? decodeURIComponent(m[1]) : '';
    };
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '–');
    const timeAgo = (t) => {
      const s = Math.round((Date.now() - t) / 1000);
      if (s < 60) return '방금 전';
      if (s < 3600) return Math.floor(s / 60) + '분 전';
      if (s < 86400) return Math.floor(s / 3600) + '시간 전';
      return Math.floor(s / 86400) + '일 전';
    };
    const ls = {
      get(k) { try { return JSON.parse(localStorage.getItem('followcheck:' + k) || 'null'); } catch (_) { return null; } },
      set(k, v) {
        try {
          if (v == null) localStorage.removeItem('followcheck:' + k);
          else localStorage.setItem('followcheck:' + k, JSON.stringify(v));
          return true;
        } catch (_) { return false; }
      },
    };

    class StopError extends Error {}
    class FatalError extends Error {}

    // DOM 헬퍼 — innerHTML 미사용 (Trusted Types 환경에서도 동작)
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
    function icon(name, cls) {
      const NS = 'http://www.w3.org/2000/svg';
      const s = document.createElementNS(NS, 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
      s.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', ICONS[name]);
      s.append(p);
      return s;
    }

    // ---------- 상태 ----------
    const S = {
      me: null, // {id, username, name, pic, followers, following}
      result: null, // {me, followers[], following[], at}
      R: null, // 계산 결과
      tab: 'notBack',
      q: '',
      limit: PAGE,
      stopped: false,
      progress: { phase: '', followers: 0, following: 0, note: '' },
    };

    // ---------- API ----------
    const headers = () => ({
      'X-IG-App-ID': APP_ID,
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': cookie('csrftoken'),
      Accept: 'application/json',
    });

    async function api(path) {
      for (let attempt = 0; ; attempt++) {
        if (S.stopped) throw new StopError();
        let res;
        try {
          res = await fetch(path, { credentials: 'include', headers: headers() });
        } catch (e) {
          if (attempt >= 4) throw new Error('네트워크 오류가 발생했어요. 인터넷 연결을 확인해 주세요.');
          await wait(5000 * (attempt + 1), '네트워크 오류 — 잠시 후 재시도');
          continue;
        }
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* HTML 응답 등 */ }
        const msg = (data && (data.message || data.error_type)) || '';
        if (/checkpoint|challenge/i.test(msg) || (data && data.checkpoint_url)) {
          throw new FatalError('인스타그램이 보안 확인을 요청했어요. 인스타 앱에서 확인을 마친 뒤 다시 시도해 주세요.');
        }
        if (/feedback_required/i.test(msg)) {
          throw new FatalError('인스타그램이 요청을 일시적으로 제한했어요. 몇 시간 뒤에 다시 시도해 주세요.');
        }
        if (res.status === 429 || (data && /wait a few minutes|please wait/i.test(msg))) {
          if (attempt >= 4) throw new FatalError('요청이 너무 많다고 해요. 30분 이상 쉬었다가 다시 시도해 주세요.');
          await wait(60000 * (attempt + 1), '요청 제한 — 기다렸다가 이어서 진행');
          continue;
        }
        if (res.status >= 500) {
          if (attempt >= 4) throw new Error('인스타그램 서버 오류예요. (HTTP ' + res.status + ')');
          await wait(8000 * (attempt + 1), '서버 오류 — 재시도');
          continue;
        }
        if (res.status === 401 || res.status === 403 || (data && data.require_login)) {
          throw new FatalError('로그인이 필요해요. 인스타그램에 로그인한 뒤 다시 실행해 주세요.');
        }
        if (!res.ok || !data) throw new Error('예상치 못한 응답이에요. (HTTP ' + res.status + ')');
        return data;
      }
    }

    async function wait(ms, note) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (S.stopped) throw new StopError();
        S.progress.note = note + ' (' + Math.ceil((end - Date.now()) / 1000) + '초)';
        renderProgress();
        await sleep(1000);
      }
      S.progress.note = '';
      renderProgress();
    }

    const normUser = (u) => ({
      id: String(u.pk != null ? u.pk : (u.pk_id != null ? u.pk_id : u.id)),
      username: u.username || '',
      name: u.full_name || '',
      pic: u.profile_pic_url || '',
      priv: !!u.is_private,
      ver: !!u.is_verified,
    });

    async function getMe() {
      let id = cookie('ds_user_id');
      let u = null;
      if (id) {
        try { const d = await api('/api/v1/users/' + id + '/info/'); u = d.user || null; } catch (e) {
          if (e instanceof FatalError || e instanceof StopError) throw e;
        }
      }
      if (!u) {
        try {
          const d = await api('/api/v1/accounts/current_user/?edit=true');
          if (d.user) { u = d.user; id = String(d.user.pk || d.user.pk_id || id); }
        } catch (e) { if (e instanceof FatalError || e instanceof StopError) throw e; }
      }
      if (!id) throw new FatalError('로그인 정보를 찾지 못했어요. 인스타그램에 로그인한 뒤 다시 실행해 주세요.');
      return {
        ...(u ? normUser(u) : { username: '', name: '', pic: '' }),
        id: String(id),
        followers: u ? u.follower_count : undefined,
        following: u ? u.following_count : undefined,
      };
    }

    // REST(api/v1) 방식
    async function fetchV1(kind, out) {
      let maxId = '';
      let page = 0;
      do {
        const qs = new URLSearchParams({ count: '50' });
        if (maxId) qs.set('max_id', maxId);
        if (kind === 'followers') qs.set('search_surface', 'follow_list_page');
        const d = await api('/api/v1/friendships/' + S.me.id + '/' + kind + '/?' + qs);
        for (const u of d.users || []) { const n = normUser(u); out.set(n.id, n); }
        maxId = d.next_max_id ? String(d.next_max_id) : '';
        S.progress[kind] = out.size;
        renderProgress();
        page++;
        if (maxId) await sleep(page % 12 === 0 ? jitter(5000, 3000) : jitter(900, 800));
      } while (maxId);
    }

    // GraphQL 방식 (예비)
    const QH = {
      followers: ['c76146de99bb02f6415203be841dd25a', 'edge_followed_by'],
      following: ['d04b0a864b4b54837c0d870b0e77e076', 'edge_follow'],
    };
    async function fetchGraphQL(kind, out) {
      const [hash, edge] = QH[kind];
      let after = null;
      let page = 0;
      for (;;) {
        const vars = { id: S.me.id, include_reel: true, fetch_mutual: false, first: 50 };
        if (after) vars.after = after;
        const d = await api('/graphql/query/?query_hash=' + hash + '&variables=' + encodeURIComponent(JSON.stringify(vars)));
        const e = d && d.data && d.data.user && d.data.user[edge];
        if (!e) throw new Error('인스타그램 응답 형식이 바뀌었어요. 앱/북마크를 최신 버전으로 업데이트해 주세요.');
        for (const { node } of e.edges || []) { const n = normUser(node); out.set(n.id, n); }
        S.progress[kind] = out.size;
        renderProgress();
        if (!e.page_info || !e.page_info.has_next_page) break;
        after = e.page_info.end_cursor;
        page++;
        await sleep(page % 12 === 0 ? jitter(5000, 3000) : jitter(900, 800));
      }
    }

    async function fetchList(kind) {
      const out = new Map();
      try {
        await fetchV1(kind, out);
      } catch (e) {
        if (e instanceof StopError || e instanceof FatalError) throw e;
        S.progress.note = '다른 방식으로 다시 시도 중…';
        renderProgress();
        out.clear();
        await fetchGraphQL(kind, out);
        S.progress.note = '';
      }
      return [...out.values()];
    }

    // ---------- 결과 저장/계산 ----------
    function saveResult(result) {
      const prev = ls.get('last:' + result.me.id);
      if (prev && prev.followers) {
        const m = {};
        for (const u of prev.followers) m[u.id] = u.username;
        ls.set('prev:' + result.me.id, { at: prev.at, followers: m });
      }
      if (!ls.set('last:' + result.me.id, result)) {
        // 저장 공간 부족 → 사진 주소를 빼고 다시 시도
        const slim = (l) => l.map((u) => ({ ...u, pic: '' }));
        ls.set('last:' + result.me.id, { ...result, followers: slim(result.followers), following: slim(result.following) });
      }
    }

    function compute(r) {
      const followers = new Map(r.followers.map((u) => [u.id, u]));
      const following = new Map(r.following.map((u) => [u.id, u]));
      const mutual = [], notBack = [], fans = [];
      for (const [id, u] of following) (followers.has(id) ? mutual : notBack).push(u);
      for (const [id, u] of followers) if (!following.has(id)) fans.push(u);
      let changes = null;
      const prev = ls.get('prev:' + r.me.id);
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

    // ---------- UI 뼈대 ----------
    const host = h('div', { id: HOST_ID });
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    // 인스타 단축키가 입력을 가로채지 않도록
    for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());

    const shell = h('div', { class: 'shell' });
    root.append(h('style', { text: CSS }), shell);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    function applyTheme() {
      let t = 'system';
      try { t = localStorage.getItem('followcheck:theme') || 'system'; } catch (_) { /* ignore */ }
      const dark = t === 'dark' || (t === 'system' && mq.matches);
      shell.dataset.theme = dark ? 'dark' : 'light';
      if (APP && typeof window.FCApp.setDark === 'function') { try { window.FCApp.setDark(dark); } catch (_) { /* ignore */ } }
      if (themeBtn) {
        themeBtn.replaceChildren(icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'monitor'));
        const label = { system: '시스템 설정', light: '라이트 모드', dark: '다크 모드' }[t];
        themeBtn.setAttribute('aria-label', '테마: ' + label + ' (눌러서 변경)');
        themeBtn.title = '테마: ' + label;
        return label;
      }
      return '';
    }
    let themeBtn = null;
    themeBtn = h('button', {
      class: 'ib', type: 'button',
      onclick: () => {
        const order = ['system', 'light', 'dark'];
        let cur = 'system';
        try { cur = localStorage.getItem('followcheck:theme') || 'system'; } catch (_) { /* ignore */ }
        try { localStorage.setItem('followcheck:theme', order[(order.indexOf(cur) + 1) % 3]); } catch (_) { /* ignore */ }
        toast(applyTheme());
      },
    });
    mq.addEventListener('change', applyTheme);

    const sub = h('div', { class: 'sub' }, '불러오는 중…');
    const endBtn = APP
      ? h('button', { class: 'ib', type: 'button', 'aria-label': '로그아웃', title: '로그아웃', onclick: appLogout }, icon('logout'))
      : h('button', { class: 'ib', type: 'button', 'aria-label': '닫기', title: '닫기', onclick: close }, icon('x'));
    const bar = h('header', { class: 'bar' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }, icon('swap')),
        h('div', null, h('div', { class: 'title' }, 'followcheck'), sub)),
      themeBtn, endBtn);
    const body = h('main', { class: 'body' });
    body.addEventListener('scroll', () => bar.classList.toggle('scrolled', body.scrollTop > 4), { passive: true });
    shell.append(bar, body, h('div', { class: 'toast', role: 'status' }));
    applyTheme();
    document.documentElement.append(host);

    function close() {
      S.stopped = true;
      host.remove();
    }
    function appLogout() {
      if (!confirm('로그아웃할까요?\n다시 쓰려면 인스타그램에 다시 로그인해야 해요.')) return;
      S.stopped = true;
      try { window.FCApp.logout(); } catch (_) { /* ignore */ }
    }
    function rerun() {
      close();
      setTimeout(boot, 0);
    }

    let toastT;
    function toast(msg) {
      const t = root.querySelector('.toast');
      t.textContent = msg;
      t.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(() => t.classList.remove('on'), 2000);
    }
    function view(...nodes) {
      body.textContent = '';
      body.append(h('div', { class: 'screen' }, nodes));
      body.scrollTop = 0;
    }
    function avatar(u, cls) {
      const a = h('div', { class: 'av' + (cls ? ' ' + cls : '') }, (u.username || '?').slice(0, 1).toUpperCase());
      if (u.pic) {
        const img = h('img', { src: u.pic, alt: '', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', () => img.remove());
        a.append(img);
      }
      return a;
    }

    // ---------- 진행 화면 ----------
    let P = null;
    function showProgress() {
      P = {
        phase: h('span'), fTxt: h('span'), gTxt: h('span'), fBar: h('i'), gBar: h('i'),
        note: h('div', { class: 'pnote' }),
      };
      view(h('section', { class: 'card' },
        h('div', { class: 'phase' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), P.phase),
        h('div', { class: 'prow' }, h('b', null, '팔로워'), P.fTxt), h('div', { class: 'pbar' }, P.fBar),
        h('div', { class: 'prow' }, h('b', null, '팔로잉'), P.gTxt), h('div', { class: 'pbar' }, P.gBar),
        P.note,
        h('button', { class: 'btn ghost block', type: 'button', onclick: () => { S.stopped = true; } }, '중지'),
        h('div', { class: 'note' }, icon('shield'),
          h('div', null, '계정 보호를 위해 일부러 천천히 불러와요. 팔로워가 많으면 몇 분 걸릴 수 있어요. 이 화면을 끄지 말아 주세요.'))));
      renderProgress();
    }
    function renderProgress() {
      if (!P) return;
      const p = S.progress, me = S.me || {};
      P.phase.textContent = p.phase;
      const set = (b, t, n, total) => {
        t.textContent = fmt(n) + (total ? ' / ' + fmt(total) : '') + '명';
        b.style.width = total ? Math.min(100, (n / total) * 100).toFixed(1) + '%' : '0%';
      };
      set(P.fBar, P.fTxt, p.followers, me.followers);
      set(P.gBar, P.gTxt, p.following, me.following);
      P.note.textContent = p.note;
    }

    function showError(msg) {
      P = null;
      view(h('section', { class: 'card center' },
        h('div', { class: 'big' }, icon('alert')),
        h('p', null, msg),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: rerun }, icon('refresh'), '다시 시도'),
          S.result ? h('button', { class: 'btn ghost', type: 'button', onclick: () => showResults() }, '이전 결과 보기') : null)));
    }

    // ---------- 결과 화면 ----------
    const TABS = [
      { key: 'notBack', label: '나만 팔로우', desc: '내가 팔로우하지만, 나를 팔로우하지 않는 사람' },
      { key: 'fans', label: '상대만 팔로우', desc: '나를 팔로우하지만, 내가 팔로우하지 않는 사람' },
      { key: 'mutual', label: '맞팔', desc: '서로 팔로우하는 사람' },
      { key: 'changes', label: '변화', desc: '' },
    ];

    function showResults(message) {
      P = null;
      const r = S.result;
      const R = (S.R = compute(r));
      if (S.tab === 'changes' && !R.changes) S.tab = 'notBack';
      const me = r.me;

      const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '목록 종류' });
      for (const t of TABS) {
        if (t.key === 'changes' && !R.changes) continue;
        const n = t.key === 'changes' ? R.changes.list.length : R[t.key].length;
        tabs.append(h('button', {
          class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(S.tab === t.key),
          onclick: () => { S.tab = t.key; S.limit = PAGE; const y = body.scrollTop; showResults(); body.scrollTop = y; },
        }, t.label, h('span', { class: 'c' }, fmt(n))));
      }
      let desc = TABS.find((t) => t.key === S.tab).desc;
      if (S.tab === 'changes') {
        desc = timeAgo(R.changes.since) + ' 확인 이후 · 나를 언팔 ' + R.changes.lost.length + '명 · 새 팔로워 ' + R.changes.gained.length + '명';
      }
      const search = h('input', {
        class: 'input', type: 'search', placeholder: '아이디·이름 검색', 'aria-label': '아이디 또는 이름 검색', value: S.q,
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        oninput: (e) => { S.q = e.target.value; S.limit = PAGE; renderList(); },
      });
      view(
        message ? h('div', { class: 'alert' }, icon('alert'), h('div', null, message)) : null,
        h('section', { class: 'card' },
          h('div', { class: 'profile' },
            avatar(me, 'lg'),
            h('div', { class: 'who' },
              h('div', { class: 'un' }, me.username ? '@' + me.username : '내 계정'),
              h('div', { class: 'muted small' }, '마지막 확인 ' + timeAgo(r.at))),
            h('button', { class: 'btn sm soft', type: 'button', onclick: startScan }, icon('refresh'), '다시 확인'))),
        h('div', { class: 'stats' },
          stat('팔로워', R.followers.size), stat('팔로잉', R.following.size), stat('맞팔', R.mutual.length)),
        tabs,
        h('p', { class: 'desc' }, desc),
        h('div', { class: 'tools' },
          h('label', { class: 'search' }, icon('search'), search),
          h('button', { class: 'ib boxed', type: 'button', 'aria-label': '아이디 목록 복사', title: '아이디 목록 복사', onclick: copyList }, icon('copy')),
          APP
            ? h('button', { class: 'ib boxed', type: 'button', 'aria-label': '목록 공유', title: '목록 공유 (CSV)', onclick: shareCSV }, icon('share'))
            : h('button', { class: 'ib boxed', type: 'button', 'aria-label': 'CSV로 저장', title: 'CSV로 저장', onclick: downloadCSV }, icon('download'))),
        h('ul', { class: 'list', id: 'list' }),
        h('p', { class: 'foot' }, 'followcheck v' + VERSION + ' · 비공식 도구 · 하루 몇 번 정도만 확인하는 게 안전해요'));
      sub.textContent = me.username ? '@' + me.username : '내 계정';
      renderList();
    }

    const stat = (label, n) => h('div', { class: 'stat' }, h('div', { class: 'num' }, fmt(n)), h('div', { class: 'lab' }, label));

    function currentList() {
      const R = S.R;
      let list = S.tab === 'changes' ? R.changes.list : R[S.tab];
      const q = S.q.trim().toLowerCase().replace(/^@/, '');
      if (q) list = list.filter((u) => (u.username || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q));
      return list;
    }

    function renderList() {
      const ul = root.getElementById('list');
      if (!ul) return;
      ul.textContent = '';
      const list = currentList();
      if (!list.length) {
        ul.append(h('li', { class: 'empty' }, icon(S.q ? 'search' : 'check'), h('div', null, S.q ? '검색 결과가 없어요' : '해당하는 사람이 없어요')));
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
      if (u.ver) badges.push(h('span', { class: 'badge ver', title: '인증된 계정' }, icon('verified')));
      if (u.priv) badges.push(h('span', { class: 'badge priv', title: '비공개 계정' }, icon('lock')));
      if (u.tag === 'lost') badges.push(h('span', { class: 'badge lost' }, '나를 언팔'));
      if (u.tag === 'gained') badges.push(h('span', { class: 'badge gained' }, '새 팔로워'));
      const url = 'https://www.instagram.com/' + encodeURIComponent(u.username || '') + '/';
      const a = h('a', { class: 'row', href: url, target: '_blank', rel: 'noopener noreferrer' },
        avatar(u),
        h('div', { class: 'who' },
          h('div', { class: 'un' }, h('span', null, u.username || '(알 수 없음)'), badges),
          u.name ? h('div', { class: 'nm' }, u.name) : null),
        icon('chevron', 'chev'));
      if (APP) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          try { window.FCApp.openProfile(u.username); } catch (_) { /* ignore */ }
        });
      }
      return h('li', null, a);
    }

    async function copyList() {
      const list = currentList();
      const text = list.map((u) => u.username).join('\n');
      let ok = false;
      if (APP) { try { window.FCApp.copy(text); ok = true; } catch (_) { /* fallback */ } }
      if (!ok) {
        try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
          const ta = h('textarea', { style: 'position:fixed;opacity:0' });
          ta.value = text;
          root.append(ta);
          ta.select();
          try { ok = document.execCommand('copy'); } catch (__) { /* ignore */ }
          ta.remove();
        }
      }
      toast(ok ? list.length + '명의 아이디를 복사했어요' : '복사하지 못했어요');
    }

    function csv() {
      const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const lines = ['username,full_name,id,private,verified,profile'];
      for (const u of currentList()) {
        lines.push([u.username, u.name, u.id, u.priv ? 1 : 0, u.ver ? 1 : 0, 'https://www.instagram.com/' + u.username + '/'].map(esc).join(','));
      }
      return lines.join('\n');
    }
    const csvName = () => 'followcheck-' + S.tab + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    function downloadCSV() {
      const url = URL.createObjectURL(new Blob(['﻿' + csv()], { type: 'text/csv;charset=utf-8' }));
      const a = h('a', { href: url, download: csvName() });
      root.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }
    function shareCSV() {
      try { window.FCApp.shareFile(csvName(), '﻿' + csv()); } catch (_) { toast('공유하지 못했어요'); }
    }

    // ---------- 실행 ----------
    async function startScan() {
      S.stopped = false;
      S.progress = { phase: '내 계정 확인 중…', followers: 0, following: 0, note: '' };
      showProgress();
      try {
        S.me = await getMe();
        sub.textContent = S.me.username ? '@' + S.me.username : '내 계정';
        S.progress.phase = '팔로워 불러오는 중…';
        const followers = await fetchList('followers');
        await sleep(jitter(1500, 1000));
        S.progress.phase = '팔로잉 불러오는 중…';
        const following = await fetchList('following');
        S.result = { me: { ...S.me }, followers, following, at: Date.now() };
        saveResult(S.result);
        S.tab = 'notBack'; S.q = ''; S.limit = PAGE;
        showResults();
        toast('확인 완료');
      } catch (e) {
        if (e instanceof StopError) {
          if (!host.isConnected) return;
          if (S.result) showResults('중지했어요. 이전 결과를 보여드려요.');
          else showError('중지했어요.');
          return;
        }
        console.error('[followcheck]', e);
        showError(e.message || String(e));
      }
    }

    // 이전 결과가 있으면 먼저 보여주고, 없으면 바로 확인 시작
    const uid = cookie('ds_user_id');
    const last = uid ? ls.get('last:' + uid) : null;
    if (last && last.me && Array.isArray(last.followers)) {
      S.result = last;
      showResults();
    } else {
      startScan();
    }
  }

  // ---------- 스타일 ----------
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.shell{
  --bg:#f5f7fb;--surface:#fff;--surface-2:#eef2f8;--text:#0b1220;--text-2:#51607a;--border:#e3e8f0;
  --primary:#2563eb;--primary-press:#1d4ed8;--primary-soft:#eaf1ff;--primary-text:#1d4ed8;
  --danger:#dc2626;--danger-soft:#fdecec;--success:#15803d;--success-soft:#e8f6ee;--ring:rgba(37,99,235,.35);
  --shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.06);--ease:cubic-bezier(.2,.7,.2,1);
  position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg);color:var(--text);
  font:16px/1.55 "Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",Roboto,"Noto Sans KR",sans-serif;
  -webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;word-break:keep-all;overflow-wrap:anywhere;
  transition:background-color .25s var(--ease),color .25s var(--ease);color-scheme:light;
}
.shell[data-theme=dark]{
  --bg:#0a0f1a;--surface:#111827;--surface-2:#1a2333;--text:#eef2f8;--text-2:#9aa7bd;--border:#243044;
  --primary:#2563eb;--primary-press:#1e40af;--primary-soft:rgba(59,130,246,.14);--primary-text:#8ab6ff;
  --danger:#f87171;--danger-soft:rgba(248,113,113,.14);--success:#4ade80;--success-soft:rgba(74,222,128,.12);
  --ring:rgba(96,165,250,.45);--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);color-scheme:dark;
}
button,input{font:inherit;color:inherit}
.i{width:20px;height:20px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:3px solid var(--ring);outline-offset:2px;border-radius:10px}
.bar{display:flex;align-items:center;gap:6px;padding:calc(env(safe-area-inset-top) + 10px) max(16px,calc(50% - 264px)) 10px;border-bottom:1px solid transparent;transition:border-color .2s var(--ease);flex:none}
.bar.scrolled{border-bottom-color:var(--border)}
.brand{display:flex;align-items:center;gap:10px;margin-right:auto;min-width:0}
.mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--primary);color:#fff;flex:none}
.mark .i{width:18px;height:18px;stroke-width:2.4}
.title{font-weight:700;font-size:16px;letter-spacing:-.01em;line-height:1.2}
.sub{font-size:13px;color:var(--text-2);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib{width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:var(--text-2);display:grid;place-items:center;cursor:pointer;flex:none;transition:background-color .15s var(--ease),color .15s var(--ease)}
.ib:hover{background:var(--surface-2);color:var(--text)}
.ib:active{transform:scale(.96)}
.ib.boxed{background:var(--surface);border:1px solid var(--border)}
.body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:8px max(16px,calc(50% - 264px)) calc(env(safe-area-inset-bottom) + 32px)}
.screen{animation:enter .28s var(--ease) both}
@keyframes enter{from{opacity:0;transform:translateY(6px)}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);padding:20px}
.card.center{text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px 20px;margin-top:12px}
.big{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--danger-soft);color:var(--danger)}
.big .i{width:28px;height:28px}
.row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.muted{color:var(--text-2)}.small{font-size:14px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 20px;border:0;border-radius:14px;cursor:pointer;background:var(--primary);color:#fff;font-weight:650;font-size:16px;transition:background-color .15s var(--ease),transform .1s var(--ease)}
.btn:hover{background:var(--primary-press)}
.btn:active{transform:scale(.985)}
.btn.block{width:100%}
.btn.ghost{background:var(--surface-2);color:var(--text)}
.btn.soft{background:var(--primary-soft);color:var(--primary-text)}
.btn.sm{min-height:44px;padding:0 14px;font-size:14px;border-radius:12px}
.btn .i{width:18px;height:18px}
.spin{width:20px;height:20px;border-radius:50%;border:2.5px solid var(--primary);border-right-color:transparent;animation:spin .7s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.phase{font-weight:700;font-size:18px;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.prow{display:flex;justify-content:space-between;font-size:14px;color:var(--text-2);margin-bottom:6px;font-variant-numeric:tabular-nums}
.prow b{color:var(--text);font-weight:600}
.pbar{height:8px;border-radius:99px;background:var(--surface-2);overflow:hidden;margin-bottom:16px}
.pbar>i{display:block;height:100%;width:0;border-radius:inherit;background:var(--primary);transition:width .4s var(--ease)}
.pnote{min-height:20px;font-size:14px;color:var(--primary-text);margin-bottom:8px}
.note{display:flex;gap:10px;font-size:13.5px;color:var(--text-2);margin-top:16px;text-align:left}
.note .i{width:18px;height:18px;margin-top:2px;color:var(--primary-text)}
.alert{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;font-size:14.5px;margin:0 0 12px;background:var(--primary-soft);color:var(--primary-text)}
.profile{display:flex;align-items:center;gap:14px}
.profile .who{flex:1;min-width:0}
.profile .un{font-weight:700;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av{position:relative;width:44px;height:44px;flex:none;border-radius:50%;overflow:hidden;background:var(--primary-soft);color:var(--primary-text);display:grid;place-items:center;font-weight:700}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.av.lg{width:52px;height:52px;font-size:19px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 16px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 8px;text-align:center}
.num{font-size:22px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.lab{font-size:13px;color:var(--text-2)}
.tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:2px 16px}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-weight:600;font-size:14.5px;cursor:pointer;transition:all .15s var(--ease)}
.tab .c{font-size:12.5px;font-weight:700;padding:1px 8px;border-radius:99px;background:var(--surface-2);color:var(--text-2);font-variant-numeric:tabular-nums}
.tab[aria-selected=true]{background:var(--primary);border-color:var(--primary);color:#fff}
.tab[aria-selected=true] .c{background:rgba(255,255,255,.22);color:#fff}
.desc{font-size:14px;color:var(--text-2);margin:12px 2px}
.tools{position:sticky;top:-8px;z-index:2;display:flex;gap:8px;padding:8px 0;background:var(--bg)}
.search{position:relative;flex:1;min-width:0}
.search .i{position:absolute;left:14px;top:12px;color:var(--text-2);pointer-events:none}
.input{width:100%;height:44px;padding:0 14px 0 42px;border-radius:12px;border:1.5px solid var(--border);background:var(--surface);font-size:16px;outline:none;-webkit-appearance:none;appearance:none;transition:border-color .15s var(--ease),box-shadow .15s var(--ease)}
.input:focus{border-color:var(--primary);box-shadow:0 0 0 4px var(--ring)}
.list{list-style:none;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden}
.list li+li{border-top:1px solid var(--border)}
.list .row{display:flex;flex-wrap:nowrap;justify-content:flex-start;align-items:center;gap:12px;min-height:68px;padding:10px 14px;color:inherit;text-decoration:none;transition:background-color .15s var(--ease)}
.list .row:hover{background:var(--surface-2)}
.list .who{flex:1;min-width:0}
.list .un{font-weight:650;display:flex;align-items:center;gap:6px}
.list .un>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm{font-size:14px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chev{color:var(--text-2);width:18px;height:18px}
.badge{display:inline-flex;align-items:center;flex:none;font-size:11.5px;font-weight:700;padding:2px 7px;border-radius:6px}
.badge .i{width:15px;height:15px}
.badge.ver{color:var(--primary-text);padding:0}
.badge.priv{color:var(--text-2);padding:0}
.badge.priv .i{width:13px;height:13px}
.badge.lost{background:var(--danger-soft);color:var(--danger)}
.badge.gained{background:var(--success-soft);color:var(--success)}
.empty{text-align:center;padding:40px 16px;color:var(--text-2)}
.empty .i{width:32px;height:32px;color:var(--primary-text);margin-bottom:8px}
.more{padding:12px;text-align:center}
.foot{margin-top:24px;text-align:center;font-size:13px;color:var(--text-2)}
.toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 24px);transform:translate(-50%,16px);opacity:0;pointer-events:none;background:var(--text);color:var(--bg);padding:12px 18px;border-radius:12px;font-size:14.5px;font-weight:600;transition:opacity .2s var(--ease),transform .2s var(--ease);z-index:3}
.toast.on{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}.spin{animation-duration:1.2s!important}}
`;

  boot();
})();
