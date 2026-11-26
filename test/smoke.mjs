// 가짜 인스타그램 API로 북마클릿/앱 스크립트를 jsdom 에서 끝까지 실행하는 스모크 테스트
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const read = (p) => readFile(new URL('../' + p, import.meta.url), 'utf8');
const appCode = await read('android/app/src/main/assets/followcheck.js');
const bmSrc = await read('docs/bookmarklet.js');
const bookmarklet = JSON.parse(bmSrc.match(/FC_BOOKMARKLET=(".*");/)[1]);
const bmCode = decodeURIComponent(bookmarklet.slice('javascript:'.length));

const mk = (n) => ({ pk: n, username: 'user' + n, full_name: 'User ' + n, profile_pic_url: '', is_private: n % 7 === 0, is_verified: n === 1 });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function run(code, followersIds, followingIds, { storage, failV1 = false, app = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.instagram.com/', runScripts: 'outside-only' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.document.cookie = 'ds_user_id=999';
  w.document.cookie = 'csrftoken=abc';
  if (app) w.FCApp = app;
  const realSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (f) => realSetTimeout(f, 0);
  const calls = [];
  const page = (ids, maxId, size) => {
    const start = maxId ? Number(maxId) : 0;
    return { slice: ids.slice(start, start + size), next: start + size < ids.length ? String(start + size) : null };
  };
  w.fetch = async (url) => {
    calls.push(url);
    const u = new URL(url, 'https://www.instagram.com');
    let body;
    if (u.pathname === '/api/v1/users/999/info/') body = { user: { pk: 999, username: 'me', full_name: 'Me', follower_count: followersIds.length, following_count: followingIds.length } };
    else if (u.pathname.startsWith('/api/v1/friendships/999/')) {
      if (failV1) return { ok: false, status: 400, text: async () => '<html>' };
      const ids = u.pathname.endsWith('/followers/') ? followersIds : followingIds;
      const { slice, next } = page(ids, u.searchParams.get('max_id'), 25);
      body = { users: slice.map(mk), next_max_id: next, status: 'ok' };
    } else if (u.pathname === '/graphql/query/') {
      const v = JSON.parse(u.searchParams.get('variables'));
      const followers = u.searchParams.get('query_hash').startsWith('c76');
      const { slice, next } = page(followers ? followersIds : followingIds, v.after, 50);
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

// 1) 북마클릿: 첫 실행 → 자동 확인
{
  const { w } = run(bmCode, range(1, 120), range(80, 200));
  await until(() => root(w).querySelector('.tabs'));
  assert.deepEqual(tabCounts(w), ['나만 팔로우80', '상대만 팔로우79', '맞팔41']);
  assert.equal(root(w).querySelectorAll('.list a.row').length, 80);
  assert.equal(root(w).querySelector('.sub').textContent, '@me');
  assert.ok(root(w).querySelector('[aria-label="닫기"]'));
  assert.ok(root(w).querySelector('[aria-label="CSV로 저장"]'));
  console.log('ok  북마클릿 첫 실행', tabCounts(w).join(' | '));

  const s = root(w).querySelector('input[type=search]');
  s.value = 'user150'; s.dispatchEvent(new w.Event('input'));
  assert.equal(root(w).querySelectorAll('.list a.row').length, 1);
  console.log('ok  검색');

  // 테마 전환 (system → light → dark)
  const tb = root(w).querySelector('.bar .ib');
  tb.click(); tb.click();
  assert.equal(root(w).querySelector('.shell').dataset.theme, 'dark');
  console.log('ok  다크 모드 전환');

  // 2) 다시 실행 → 이전 결과 먼저 표시, "다시 확인" 하면 변화 탭
  const storage = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); storage[k] = w.localStorage.getItem(k); }
  const r2 = run(bmCode, [...range(11, 120), ...range(300, 305)], range(80, 200), { storage });
  await until(() => root(r2.w).querySelector('.tabs'));
  assert.deepEqual(tabCounts(r2.w), ['나만 팔로우80', '상대만 팔로우79', '맞팔41'], '이전 결과 표시');
  assert.equal(root(r2.w).querySelector('.shell').dataset.theme, 'dark', '테마 유지');
  [...root(r2.w).querySelectorAll('button')].find((b) => b.textContent.includes('다시 확인')).click();
  await until(() => tabCounts(r2.w).length === 4);
  assert.equal(tabCounts(r2.w)[3], '변화16');
  root(r2.w).querySelectorAll('.tab')[3].click();
  assert.equal(root(r2.w).querySelectorAll('.badge.lost').length, 10);
  assert.equal(root(r2.w).querySelectorAll('.badge.gained').length, 6);
  console.log('ok  이전 결과 + 변화 추적', tabCounts(r2.w).join(' | '));
}

// 3) 안드로이드 앱 모드: 브리지 호출
{
  const log = [];
  const app = { openProfile: (u) => log.push(['open', u]), copy: (t) => log.push(['copy', t.split('\n').length]), shareFile: (n, t) => log.push(['share', n, t.length > 10]), logout: () => log.push(['logout']) };
  const { w } = run(appCode, range(1, 60), range(30, 90), { app });
  await until(() => root(w).querySelector('.tabs'));
  assert.ok(root(w).querySelector('[aria-label="로그아웃"]'));
  assert.ok(!root(w).querySelector('[aria-label="닫기"]'));
  root(w).querySelector('.list a.row').click();
  root(w).querySelector('[aria-label="아이디 목록 복사"]').click();
  root(w).querySelector('[aria-label="목록 공유"]').click();
  w.confirm = () => true;
  root(w).querySelector('[aria-label="로그아웃"]').click();
  await until(() => log.length >= 4);
  assert.deepEqual(log.map((l) => l[0]), ['open', 'copy', 'share', 'logout']);
  assert.equal(log[0][1], 'user61');
  console.log('ok  앱 브리지', JSON.stringify(log));
}

// 4) REST 실패 시 GraphQL 예비 경로
{
  const { w, calls } = run(bmCode, range(1, 60), range(30, 90), { failV1: true });
  await until(() => root(w).querySelector('.tabs'));
  assert.ok(calls.some((c) => c.includes('/graphql/query/')));
  assert.deepEqual(tabCounts(w), ['나만 팔로우30', '상대만 팔로우29', '맞팔31']);
  console.log('ok  GraphQL 예비 경로');
}

// 5) 큰 목록 더 보기
{
  const { w } = run(bmCode, [], range(1, 450));
  await until(() => root(w).querySelector('.tabs'));
  assert.equal(root(w).querySelectorAll('.list a.row').length, 200);
  root(w).querySelector('.more button').click();
  assert.equal(root(w).querySelectorAll('.list a.row').length, 400);
  console.log('ok  더 보기');
}

console.log('all passed');
process.exit(0);
