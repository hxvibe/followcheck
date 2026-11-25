# followcheck

인스타그램 **맞팔 / 나만 팔로우 / 상대만 팔로우**를 확인하는 개인용 비공식 도구.
데이터 내보내기나 비밀번호 입력 없이, 브라우저에서 instagram.com 에 로그인되어 있기만 하면 됩니다.

- 서버 없음: 로그인된 브라우저 안에서 인스타 웹의 내부 API를 직접 호출하고, 결과도 그 기기 안에서만 처리
- 아이폰 Safari / 안드로이드 Chrome / PC 모두 지원 (북마클릿)
- 다시 실행하면 **변화** 탭에서 그 사이 나를 언팔한 사람·새 팔로워 표시
- 검색, 아이디 목록 복사, CSV 저장

## 사용법

1. GitHub Pages 를 켭니다: 저장소 **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**
2. `https://<계정>.github.io/followcheck/` 접속 → 기기별 안내대로 북마클릿 설치
3. 브라우저에서 instagram.com 로그인 → 북마크 `followcheck` 실행

PC에서는 `docs/followcheck.min.js` 내용을 instagram.com 의 개발자 도구 콘솔에 붙여넣어도 됩니다.

## 구조

```
src/followcheck.js     원본 스크립트 (instagram.com 위에서 실행되는 오버레이)
scripts/build.mjs      압축 → docs/ 에 북마클릿·콘솔용 코드 생성
docs/index.html        설치 안내 페이지 (GitHub Pages)
docs/bookmarklet.*     자동 생성물
test/smoke.mjs         가짜 API로 jsdom 에서 전체 흐름 테스트
```

```bash
npm install
npm run build   # src 수정 후 docs/ 갱신
npm test        # 빌드 + 스모크 테스트
```

## 동작 방식

1. 쿠키 `ds_user_id` 로 내 계정 ID 확인, `/api/v1/users/{id}/info/` 로 팔로워·팔로잉 수 조회
2. `/api/v1/friendships/{id}/followers/`, `/following/` 을 `next_max_id` 로 페이지네이션 (헤더 `X-IG-App-ID`)
3. 실패하면 `/graphql/query/` (query_hash 방식) 으로 재시도
4. 요청 사이 0.9–1.7초, 12페이지마다 5–8초 쉬고, 429 응답이면 1분씩 늘려가며 대기
5. 결과 스냅샷(ID→아이디)을 instagram.com 의 localStorage 에 저장해 다음 실행 때 비교

## 다른 구현 방법들 (참고)

| 방법 | 연결 방식 | 모바일 | 비고 |
|---|---|---|---|
| **북마클릿 / 콘솔 스크립트** (이 저장소) | 브라우저의 인스타 로그인 세션 | ✅ | 서버·비밀번호 불필요. 가장 안전하고 간단 |
| 브라우저 확장 프로그램 | 브라우저 로그인 세션 쿠키 | △ | PC 크롬 중심. iOS는 Safari 웹 확장(Xcode 빌드 필요) |
| 비공식 Private API 서버 (instagrapi 등) | 아이디/비번 또는 `sessionid` 쿠키를 서버에 | ✅ (웹 UI) | 서버 필요. 데이터센터 IP·새 기기 로그인이라 체크포인트/정지 위험 큼 |
| 네이티브 앱 + WebView 로그인 | 앱 내 WebView로 로그인 후 쿠키로 API 호출 | ✅ | 스토어 배포 어려움, 사이드로드/개인 빌드 |
| 공식 Instagram Graph API | OAuth | — | 팔로워/팔로잉 **목록을 제공하지 않아** 불가 |

## 주의

Instagram 과 무관한 비공식 도구입니다. 내부 API는 예고 없이 바뀔 수 있고, 너무 자주 실행하면 인스타가 일시적으로 요청을 제한할 수 있으니 하루 몇 번 정도만 사용하세요.
