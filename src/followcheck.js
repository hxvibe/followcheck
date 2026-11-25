/*!
 * followcheck — 인스타그램 맞팔 확인 (비공식, 개인용)
 * instagram.com 에 로그인된 브라우저에서 실행합니다.
 * 로그인 세션(쿠키)으로 인스타 웹이 쓰는 내부 API를 직접 호출하며,
 * 데이터는 어디에도 전송되지 않고 이 기기 안에서만 처리됩니다.
 */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const HOST_ID = '__followcheck_host__';
  const APP_ID = '936619743392459'; // 인스타그램 웹 클라이언트 App ID
  const PAGE_RENDER = 200;

  function boot() {
    // ---------- 실행 위치 확인 ----------
    if (!/(^|\.)instagram\.com$/.test(location.hostname)) {
      if (confirm('followcheck는 instagram.com 에서 실행해야 해요.\n인스타그램으로 이동할까요? (로그인 후 다시 실행)')) {
        location.href = 'https://www.instagram.com/';
      }
      return;
    }
    const already = document.getElementById(HOST_ID);
    if (already) { already.style.display = ''; return; }

    // ---------- 유틸 ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const jitter = (base, spread) => base + Math.floor(Math.random() * spread);
    const cookie = (name) => {
      const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
      return m ? decodeURIComponent(m[1]) : '';
    };
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '-');
    const timeAgo = (t) => {
      const s = Math.round((Date.now() - t) / 1000);
      if (s < 60) return '방금 전';
      if (s < 3600) return Math.floor(s / 60) + '분 전';
      if (s < 86400) return Math.floor(s / 3600) + '시간 전';
      return Math.floor(s / 86400) + '일 전';
    };

    class StopError extends Error {}
    class FatalError extends Error {}

    // DOM 헬퍼 (innerHTML 미사용 — Trusted Types 환경에서도 동작)
    function h(tag, props, ...kids) {
      const el = document.createElement(tag);
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          if (v == null || v === false) continue;
          if (k === 'class') el.className = v;
          else if (k === 'text') el.textContent = v;
          else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
          else el.setAttribute(k, v === true ? '' : v);
        }
      }
      for (const kid of kids.flat()) {
        if (kid == null || kid === false) continue;
        el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
      }
      return el;
    }

    // ---------- 상태 ----------
    const state = {
      me: null, // {id, username, followerCount, followingCount}
      followers: null, // Map<id, user>
      following: null,
      prev: null, // 이전 스캔 스냅샷
      result: null,
      tab: 'notBack',
      q: '',
      limit: PAGE_RENDER,
      stopped: false,
      progress: { phase: '', followers: 0, following: 0, note: '' },
    };

    // ---------- API ----------
    function headers() {
      return {
        'X-IG-App-ID': APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': cookie('csrftoken'),
        Accept: 'application/json',
      };
    }

    async function api(path) {
      const MAX_RETRY = 4;
      for (let attempt = 0; ; attempt++) {
        if (state.stopped) throw new StopError();
        let res;
        try {
          res = await fetch(path, { credentials: 'include', headers: headers() });
        } catch (e) {
          if (attempt >= MAX_RETRY) throw new Error('네트워크 오류: ' + e.message);
          await wait(5000 * (attempt + 1), '네트워크 오류 — 잠시 후 재시도');
          continue;
        }
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* HTML 응답 등 */ }

        const msg = (data && (data.message || data.error_type)) || '';
        if (/checkpoint|challenge/i.test(msg) || (data && data.checkpoint_url)) {
          throw new FatalError('인스타그램이 보안 확인(체크포인트)을 요청했어요. 인스타 앱/웹에서 확인을 마친 뒤 다시 시도하세요.');
        }
        if (/feedback_required/i.test(msg)) {
          throw new FatalError('인스타그램이 요청을 일시적으로 제한했어요. 몇 시간 뒤에 다시 시도하세요.');
        }
        if (res.status === 429 || (data && /wait a few minutes|please wait/i.test(msg))) {
          if (attempt >= MAX_RETRY) throw new FatalError('요청이 너무 많다고 해요(429). 30분 이상 쉬었다가 다시 시도하세요.');
          await wait(60000 * (attempt + 1), '요청 제한 — 대기 후 이어서 진행');
          continue;
        }
        if (res.status >= 500) {
          if (attempt >= MAX_RETRY) throw new Error('인스타그램 서버 오류 (HTTP ' + res.status + ')');
          await wait(8000 * (attempt + 1), '서버 오류 — 재시도');
          continue;
        }
        if (res.status === 401 || res.status === 403 || (data && data.require_login)) {
          throw new FatalError('로그인이 필요해요. instagram.com 에 로그인한 뒤 다시 실행하세요.');
        }
        if (!res.ok || !data) {
          const err = new Error('예상치 못한 응답 (HTTP ' + res.status + ')');
          err.soft = true;
          throw err;
        }
        return data;
      }
    }

    async function wait(ms, note) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (state.stopped) throw new StopError();
        state.progress.note = note + ' (' + Math.ceil((end - Date.now()) / 1000) + '초)';
        renderProgress();
        await sleep(1000);
      }
      state.progress.note = '';
      renderProgress();
    }

    const normUser = (u) => ({
      id: String(u.pk != null ? u.pk : (u.pk_id != null ? u.pk_id : u.id)),
      username: u.username,
      name: u.full_name || '',
      pic: u.profile_pic_url || '',
      priv: !!u.is_private,
      ver: !!u.is_verified,
    });

    async function getMe() {
      let id = cookie('ds_user_id');
      let me = null;
      if (id) {
        try {
          const d = await api('/api/v1/users/' + id + '/info/');
          if (d.user) me = d.user;
        } catch (e) { if (e instanceof FatalError || e instanceof StopError) throw e; }
      }
      if (!me) {
        try {
          const d = await api('/api/v1/accounts/current_user/?edit=true');
          if (d.user) { me = d.user; id = String(d.user.pk || d.user.pk_id || id); }
        } catch (e) { if (e instanceof FatalError || e instanceof StopError) throw e; }
      }
      if (!id) throw new FatalError('로그인 정보를 찾지 못했어요. instagram.com 에 로그인한 뒤 다시 실행하세요.');
      return {
        id: String(id),
        username: (me && me.username) || '',
        followerCount: me ? me.follower_count : undefined,
        followingCount: me ? me.following_count : undefined,
      };
    }

    // REST (api/v1) 방식
    async function fetchListV1(kind, out) {
      let maxId = '';
      let page = 0;
      do {
        const qs = new URLSearchParams({ count: '50' });
        if (maxId) qs.set('max_id', maxId);
        if (kind === 'followers') qs.set('search_surface', 'follow_list_page');
        const d = await api('/api/v1/friendships/' + state.me.id + '/' + kind + '/?' + qs);
        for (const u of d.users || []) { const n = normUser(u); out.set(n.id, n); }
        maxId = d.next_max_id ? String(d.next_max_id) : '';
        state.progress[kind] = out.size;
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
    async function fetchListGraphQL(kind, out) {
      const [hash, edge] = QH[kind];
      let after = null;
      let page = 0;
      for (;;) {
        const vars = { id: state.me.id, include_reel: true, fetch_mutual: false, first: 50 };
        if (after) vars.after = after;
        const d = await api('/graphql/query/?query_hash=' + hash + '&variables=' + encodeURIComponent(JSON.stringify(vars)));
        const e = d && d.data && d.data.user && d.data.user[edge];
        if (!e) throw new Error('GraphQL 응답 형식이 바뀌었어요');
        for (const { node } of e.edges || []) { const n = normUser(node); out.set(n.id, n); }
        state.progress[kind] = out.size;
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
        await fetchListV1(kind, out);
      } catch (e) {
        if (e instanceof StopError || e instanceof FatalError) throw e;
        // REST 방식이 막히면 GraphQL 방식으로 처음부터 다시
        state.progress.note = '다른 방식으로 다시 시도 중…';
        renderProgress();
        out.clear();
        await fetchListGraphQL(kind, out);
        state.progress.note = '';
      }
      return out;
    }

    // ---------- 스냅샷 (변화 추적) ----------
    const snapKey = () => 'followcheck:snap:' + state.me.id;
    function loadSnap() {
      try { return JSON.parse(localStorage.getItem(snapKey()) || 'null'); } catch (_) { return null; }
    }
    function saveSnap() {
      const pack = (m) => { const o = {}; for (const [id, u] of m) o[id] = u.username; return o; };
      try {
        localStorage.setItem(snapKey(), JSON.stringify({
          v: 1, t: Date.now(), followers: pack(state.followers), following: pack(state.following),
        }));
      } catch (_) { /* 저장 공간 부족 등은 무시 */ }
    }

    // ---------- 계산 ----------
    function compute() {
      const { followers, following, prev } = state;
      const mutual = [], notBack = [], fans = [];
      for (const [id, u] of following) (followers.has(id) ? mutual : notBack).push(u);
      for (const [id, u] of followers) if (!following.has(id)) fans.push(u);

      let changes = null;
      if (prev && prev.followers) {
        const lost = [], gained = [];
        for (const id of Object.keys(prev.followers)) {
          if (!followers.has(id)) {
            const cur = following.get(id);
            lost.push(cur ? { ...cur, tag: 'lost' } : { id, username: prev.followers[id], name: '', pic: '', tag: 'lost' });
          }
        }
        for (const [id, u] of followers) if (!(id in prev.followers)) gained.push({ ...u, tag: 'gained' });
        changes = { since: prev.t, lost, gained, list: [...lost, ...gained] };
      }
      return { mutual, notBack, fans, changes };
    }

    // ---------- UI ----------
    const host = h('div', { id: HOST_ID });
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    // 인스타 단축키가 입력을 가로채지 않도록
    for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());

    root.append(h('style', { text: CSS() }));
    const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'followcheck' });
    root.append(h('div', { class: 'backdrop', onclick: close }), panel);

    const header = h('header', null,
      h('div', { class: 'brand' },
        h('div', { class: 'logo' }, '⇄'),
        h('div', null, h('div', { class: 'title' }, 'followcheck'), h('div', { class: 'sub', id: 'sub' }, '불러오는 중…'))),
      h('button', { class: 'icon', title: '닫기', 'aria-label': '닫기', onclick: close }, '✕'));
    const body = h('div', { class: 'body' });
    panel.append(header, body);
    document.documentElement.append(host);

    const $ = (sel) => root.querySelector(sel);

    function close() {
      state.stopped = true;
      host.remove();
    }

    let progEls = null;
    function showProgress() {
      body.textContent = '';
      progEls = {
        phase: h('div', { class: 'phase' }),
        fBar: h('i'), gBar: h('i'),
        fTxt: h('span'), gTxt: h('span'),
        note: h('div', { class: 'note' }),
      };
      body.append(h('div', { class: 'progress' },
        progEls.phase,
        h('div', { class: 'prow' }, h('b', null, '팔로워'), progEls.fTxt),
        h('div', { class: 'bar' }, progEls.fBar),
        h('div', { class: 'prow' }, h('b', null, '팔로잉'), progEls.gTxt),
        h('div', { class: 'bar' }, progEls.gBar),
        progEls.note,
        h('p', { class: 'hint' }, '계정 보호를 위해 천천히 불러와요. 팔로워가 많으면 몇 분 걸릴 수 있어요. 이 화면을 닫거나 페이지를 이동하지 마세요.'),
        h('button', { class: 'btn ghost', onclick: () => { state.stopped = true; } }, '중지')));
      renderProgress();
    }

    function renderProgress() {
      if (!progEls) return;
      const p = state.progress, me = state.me || {};
      progEls.phase.textContent = p.phase;
      const set = (bar, txt, n, total) => {
        txt.textContent = fmt(n) + (total ? ' / ' + fmt(total) : '') + '명';
        bar.style.width = total ? Math.min(100, (n / total) * 100).toFixed(1) + '%' : (n ? '100%' : '0%');
        bar.classList.toggle('indet', !total && n > 0 && p.phase.indexOf('완료') < 0);
      };
      set(progEls.fBar, progEls.fTxt, p.followers, me.followerCount);
      set(progEls.gBar, progEls.gTxt, p.following, me.followingCount);
      progEls.note.textContent = p.note;
    }

    function showError(msg) {
      progEls = null;
      body.textContent = '';
      body.append(h('div', { class: 'error' },
        h('div', { class: 'big' }, '⚠️'),
        h('p', null, msg),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: rerun }, '다시 시도'),
          h('button', { class: 'btn ghost', onclick: close }, '닫기'))));
    }

    const TABS = [
      { key: 'notBack', label: '나만 팔로우', desc: '내가 팔로우하지만, 나를 팔로우하지 않는 사람' },
      { key: 'fans', label: '상대만 팔로우', desc: '나를 팔로우하지만, 내가 팔로우하지 않는 사람' },
      { key: 'mutual', label: '맞팔', desc: '서로 팔로우하는 사람' },
      { key: 'changes', label: '변화', desc: '' },
    ];

    function currentList() {
      const r = state.result;
      let list = state.tab === 'changes' ? (r.changes ? r.changes.list : []) : r[state.tab];
      const q = state.q.trim().toLowerCase();
      if (q) list = list.filter((u) => (u.username || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q));
      return list;
    }

    function showResults() {
      progEls = null;
      const r = state.result;
      body.textContent = '';

      body.append(h('div', { class: 'stats' },
        stat('팔로워', state.followers.size),
        stat('팔로잉', state.following.size),
        stat('맞팔', r.mutual.length)));

      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      for (const t of TABS) {
        if (t.key === 'changes' && !r.changes) continue;
        const n = t.key === 'changes' ? r.changes.lost.length + r.changes.gained.length : r[t.key].length;
        tabs.append(h('button', {
          class: 'tab' + (state.tab === t.key ? ' on' : ''), role: 'tab',
          onclick: () => { state.tab = t.key; state.limit = PAGE_RENDER; showResults(); },
        }, t.label, h('span', { class: 'count' }, fmt(n))));
      }
      body.append(tabs);

      const tab = TABS.find((t) => t.key === state.tab);
      let desc = tab.desc;
      if (state.tab === 'changes') {
        desc = '지난 확인(' + timeAgo(r.changes.since) + ') 이후 — 나를 언팔 ' + r.changes.lost.length + '명 · 새 팔로워 ' + r.changes.gained.length + '명';
      }
      body.append(h('div', { class: 'desc' }, desc));

      const search = h('input', {
        class: 'search', type: 'search', placeholder: '아이디·이름 검색', value: state.q,
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        oninput: (e) => { state.q = e.target.value; state.limit = PAGE_RENDER; renderList(); },
      });
      body.append(h('div', { class: 'tools' },
        search,
        h('button', { class: 'btn small ghost', onclick: copyList, title: '아이디 목록 복사' }, '복사'),
        h('button', { class: 'btn small ghost', onclick: downloadCSV, title: 'CSV 저장' }, 'CSV')));

      body.append(h('ul', { class: 'list', id: 'list' }));
      body.append(h('div', { class: 'foot' },
        h('button', { class: 'btn small ghost', onclick: rerun }, '다시 확인'),
        h('span', null, 'followcheck v' + VERSION + ' · 비공식 도구')));
      renderList();
    }

    function stat(label, n) {
      return h('div', { class: 'stat' }, h('div', { class: 'num' }, fmt(n)), h('div', { class: 'lab' }, label));
    }

    function renderList() {
      const ul = $('#list');
      if (!ul) return;
      ul.textContent = '';
      const list = currentList();
      if (!list.length) {
        ul.append(h('li', { class: 'empty' }, state.q ? '검색 결과가 없어요' : '아무도 없어요 🎉'));
        return;
      }
      for (const u of list.slice(0, state.limit)) ul.append(row(u));
      if (list.length > state.limit) {
        ul.append(h('li', { class: 'more' }, h('button', {
          class: 'btn ghost', onclick: () => { state.limit += PAGE_RENDER; renderList(); },
        }, '더 보기 (' + fmt(list.length - state.limit) + '명 남음)')));
      }
    }

    function row(u) {
      const url = 'https://www.instagram.com/' + encodeURIComponent(u.username || '') + '/';
      const av = h('div', { class: 'av' }, (u.username || '?').slice(0, 1).toUpperCase());
      if (u.pic) {
        const img = h('img', { src: u.pic, alt: '', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', () => img.remove());
        av.append(img);
      }
      const tags = [];
      if (u.tag === 'lost') tags.push(h('span', { class: 'tag red' }, '나를 언팔'));
      if (u.tag === 'gained') tags.push(h('span', { class: 'tag green' }, '새 팔로워'));
      if (u.ver) tags.push(h('span', { class: 'tag blue', title: '인증됨' }, '✓'));
      if (u.priv) tags.push(h('span', { class: 'tag', title: '비공개 계정' }, '🔒'));
      return h('li', null,
        h('a', { class: 'user', href: url, target: '_blank', rel: 'noopener' },
          av,
          h('div', { class: 'who' },
            h('div', { class: 'un' }, h('span', null, u.username || '(알 수 없음)'), tags),
            u.name ? h('div', { class: 'nm' }, u.name) : null),
          h('span', { class: 'go' }, '›')));
    }

    async function copyList() {
      const text = currentList().map((u) => u.username).join('\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = h('textarea');
        ta.value = text;
        root.append(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(currentList().length + '명 복사됨');
    }

    function downloadCSV() {
      const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      const lines = [['username', 'full_name', 'id', 'private', 'verified', 'profile'].join(',')];
      for (const u of currentList()) {
        lines.push([u.username, u.name, u.id, u.priv ? 1 : 0, u.ver ? 1 : 0, 'https://www.instagram.com/' + u.username + '/'].map(esc).join(','));
      }
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'followcheck-' + state.tab + '-' + new Date().toISOString().slice(0, 10) + '.csv' });
      root.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function toast(msg) {
      const t = h('div', { class: 'toast' }, msg);
      root.append(t);
      setTimeout(() => t.remove(), 1800);
    }

    // ---------- 메인 ----------
    async function main() {
      showProgress();
      try {
        state.progress.phase = '내 계정 확인 중…';
        renderProgress();
        state.me = await getMe();
        $('#sub').textContent = state.me.username ? '@' + state.me.username : '내 계정';
        state.prev = loadSnap();

        state.progress.phase = '팔로워 불러오는 중…';
        state.followers = await fetchList('followers');
        await sleep(jitter(1500, 1000));
        state.progress.phase = '팔로잉 불러오는 중…';
        state.following = await fetchList('following');
        state.progress.phase = '완료';
        renderProgress();

        state.result = compute();
        saveSnap();
        showResults();
      } catch (e) {
        if (e instanceof StopError) {
          if (host.isConnected) showError('중지했어요.');
          return;
        }
        console.error('[followcheck]', e);
        showError(e.message || String(e));
      }
    }

    // 다시 실행: 이전 실행을 완전히 멈추고 새 상태로 처음부터
    function rerun() {
      close();
      setTimeout(boot, 0);
    }

    main();

    // ---------- 스타일 ----------
    function CSS() {
      return `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
:host{--bg:#fff;--fg:#111;--mut:#6b7280;--line:#e5e7eb;--card:#f6f7f9;--acc:#e1306c;--acc2:#833ab4;--ok:#16a34a;--bad:#dc2626;--blue:#2563eb;
font:15px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",Roboto,"Noto Sans KR",sans-serif;color:var(--fg)}
@media (prefers-color-scheme:dark){:host{--bg:#121214;--fg:#f3f4f6;--mut:#9ca3af;--line:#26272b;--card:#1c1d21}}
.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45)}
.panel{position:fixed;inset:0;margin:auto;width:100%;max-width:560px;height:100%;background:var(--bg);display:flex;flex-direction:column;
padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
@media (min-width:600px){.panel{height:min(92vh,920px);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px;background:linear-gradient(135deg,var(--acc2),var(--acc) 60%,#fcb045)}
.title{font-weight:700;font-size:16px}
.sub{font-size:12.5px;color:var(--mut)}
.icon{all:unset;cursor:pointer;width:36px;height:36px;display:grid;place-items:center;border-radius:10px;font-size:16px;color:var(--mut)}
.icon:hover{background:var(--card)}
.body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:16px}
.btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 16px;border-radius:12px;font-weight:600;font-size:14px;color:#fff;background:linear-gradient(135deg,var(--acc2),var(--acc));-webkit-tap-highlight-color:transparent}
.btn.ghost{background:var(--card);color:var(--fg)}
.btn.small{padding:8px 12px;font-size:13px}
.progress{display:flex;flex-direction:column;gap:8px;padding:12px 4px}
.phase{font-weight:700;font-size:17px;margin-bottom:6px}
.prow{display:flex;justify-content:space-between;font-size:14px;color:var(--mut)}
.prow b{color:var(--fg);font-weight:600}
.bar{height:8px;border-radius:99px;background:var(--card);overflow:hidden;margin-bottom:8px}
.bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--acc2),var(--acc));transition:width .3s}
.bar i.indet{animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.45}}
.note{font-size:13px;color:var(--acc);min-height:18px}
.hint{font-size:13px;color:var(--mut);margin:6px 0 12px}
.error{text-align:center;padding:40px 12px;display:flex;flex-direction:column;align-items:center;gap:14px}
.error .big{font-size:40px}
.error p{max-width:380px}
.row{display:flex;gap:8px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.stat{background:var(--card);border-radius:14px;padding:12px 8px;text-align:center}
.num{font-weight:800;font-size:20px}
.lab{font-size:12px;color:var(--mut)}
.tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px 2px}
.tabs::-webkit-scrollbar{display:none}
.tab{all:unset;cursor:pointer;flex:none;padding:8px 12px;border-radius:99px;font-size:14px;font-weight:600;background:var(--card);color:var(--mut);display:inline-flex;gap:6px;align-items:center;-webkit-tap-highlight-color:transparent}
.tab .count{font-size:12px;font-weight:700;padding:1px 7px;border-radius:99px;background:var(--bg)}
.tab.on{color:#fff;background:linear-gradient(135deg,var(--acc2),var(--acc))}
.tab.on .count{background:rgba(255,255,255,.25)}
.desc{font-size:13px;color:var(--mut);margin:10px 2px}
.tools{display:flex;gap:6px;margin-bottom:6px;position:sticky;top:-16px;background:var(--bg);padding:8px 0;z-index:1}
.search{all:unset;flex:1;min-width:0;padding:9px 12px;border-radius:12px;background:var(--card);font-size:16px}
.list{list-style:none}
.list li{border-bottom:1px solid var(--line)}
.user{display:flex;align-items:center;gap:12px;padding:10px 2px;color:inherit;text-decoration:none;-webkit-tap-highlight-color:transparent}
.av{position:relative;width:44px;height:44px;flex:none;border-radius:50%;background:var(--card);display:grid;place-items:center;font-weight:700;color:var(--mut);overflow:hidden}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.who{flex:1;min-width:0}
.un{font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.un>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm{font-size:13px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.go{color:var(--mut);font-size:22px}
.tag{font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:var(--card);color:var(--mut)}
.tag.red{background:rgba(220,38,38,.12);color:var(--bad)}
.tag.green{background:rgba(22,163,74,.12);color:var(--ok)}
.tag.blue{background:rgba(37,99,235,.12);color:var(--blue)}
.empty{text-align:center;color:var(--mut);padding:36px 0;border:0!important}
.more{text-align:center;padding:14px 0;border:0!important}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:18px;font-size:12px;color:var(--mut)}
.toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:12px;font-size:14px;z-index:2}
textarea{position:fixed;opacity:0}
  `;
    }
  }

  boot();
})();
