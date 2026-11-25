// 가짜 인스타그램 API로 북마클릿을 jsdom 에서 끝까지 돌려보는 스모크 테스트
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const bookmarklet = (await readFile(new URL('../docs/bookmarklet.txt', import.meta.url), 'utf8')).trim();
const code = decodeURIComponent(bookmarklet.slice('javascript:'.length));

const mk = (n) => ({ pk: n, username: 'user' + n, full_name: 'User ' + n, profile_pic_url: '', is_private: n % 7 === 0, is_verified: n === 1 });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function run(followersIds, followingIds, { storage, failV1 = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.instagram.com/', runScripts: 'outside-only' });
  const w = dom.window;
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.document.cookie = 'ds_user_id=999';
  w.document.cookie = 'csrftoken=abc';
  const realSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (f) => realSetTimeout(f, 0);
  const calls = [];
  const page = (ids, maxId, size) => {
    const start = maxId ? Number(maxId) : 0;
    const slice = ids.slice(start, start + size);
    const next = start + size < ids.length ? String(start + size) : null;
    return { slice, next };
  };
  w.fetch = async (url) => {
    calls.push(url);
    const u = new URL(url, 'https://www.instagram.com');
    let body;
    if (u.pathname === '/api/v1/users/999/info/') body = { user: { username: 'me', follower_count: followersIds.length, following_count: followingIds.length } };
    else if (u.pathname.startsWith('/api/v1/friendships/999/')) {
      if (failV1) return { ok: false, status: 400, text: async () => '<html>' };
      const ids = u.pathname.endsWith('/followers/') ? followersIds : followingIds;
      const { slice, next } = page(ids, u.searchParams.get('max_id'), 25);
      body = { users: slice.map(mk), next_max_id: next, status: 'ok' };
    } else if (u.pathname === '/graphql/query/') {
      const v = JSON.parse(u.searchParams.get('variables'));
      const followers = u.searchParams.get('query_hash').startsWith('c76');
      const ids = followers ? followersIds : followingIds;
      const { slice, next } = page(ids, v.after, 50);
      const edge = { edges: slice.map((n) => ({ node: { ...mk(n), id: String(n) } })), page_info: { has_next_page: !!next, end_cursor: next } };
      body = { data: { user: { [followers ? 'edge_followed_by' : 'edge_follow']: edge } } };
    } else return { ok: false, status: 404, text: async () => 'nf' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  w.eval(code);
  return { w, calls };
}

async function until(fn, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timeout');
}

const root = (w) => w.document.getElementById('__followcheck_host__').shadowRoot;
const tabCounts = (w) => [...root(w).querySelectorAll('.tab')].map((t) => t.textContent);

// 1) 기본: 팔로워 1~120, 팔로잉 80~200
{
  const { w } = run(range(1, 120), range(80, 200));
  await until(() => root(w).querySelector('.tabs'));
  const tabs = tabCounts(w);
  assert.deepEqual(tabs, ['나만 팔로우80', '상대만 팔로우79', '맞팔41']);
  assert.equal(root(w).querySelectorAll('.list li').length, 80);
  assert.equal(root(w).querySelector('#sub').textContent, '@me');
  const snap = JSON.parse(w.localStorage.getItem('followcheck:snap:999'));
  assert.equal(Object.keys(snap.followers).length, 120);
  console.log('ok  기본 계산', tabs.join(' | '));

  // 검색
  const s = root(w).querySelector('.search');
  s.value = 'user150'; s.dispatchEvent(new w.Event('input'));
  assert.equal(root(w).querySelectorAll('.list li').length, 1);
  console.log('ok  검색');

  // 2) 변화 추적: 다음 스캔에서 1~10 언팔, 300~305 새로 팔로우
  const storage = { 'followcheck:snap:999': w.localStorage.getItem('followcheck:snap:999') };
  const r2 = run([...range(11, 120), ...range(300, 305)], range(80, 200), { storage });
  await until(() => root(r2.w).querySelector('.tabs'));
  const t2 = tabCounts(r2.w);
  assert.equal(t2[3], '변화16');
  root(r2.w).querySelectorAll('.tab')[3].click();
  assert.equal(root(r2.w).querySelectorAll('.tag.red').length, 10);
  assert.equal(root(r2.w).querySelectorAll('.tag.green').length, 6);
  console.log('ok  변화 추적', t2.join(' | '));
}

// 3) REST 실패 시 GraphQL 예비 경로
{
  const { w, calls } = run(range(1, 60), range(30, 90), { failV1: true });
  await until(() => root(w).querySelector('.tabs'));
  assert.ok(calls.some((c) => c.includes('/graphql/query/')));
  assert.deepEqual(tabCounts(w), ['나만 팔로우30', '상대만 팔로우29', '맞팔31']);
  console.log('ok  GraphQL 예비 경로');
}

// 4) 큰 목록은 200명씩 렌더 + 더 보기
{
  const { w } = run([], range(1, 450));
  await until(() => root(w).querySelector('.tabs'));
  assert.equal(root(w).querySelectorAll('.list a.user').length, 200);
  root(w).querySelector('.more button').click();
  assert.equal(root(w).querySelectorAll('.list a.user').length, 400);
  console.log('ok  더 보기');
}

console.log('all passed');
process.exit(0);
