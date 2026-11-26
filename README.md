# followcheck

인스타그램 **맞팔 / 나만 팔로우 / 상대만 팔로우**를 확인하는 개인용 비공식 도구.
**서버 없음, 데이터 내보내기 없음** — 인스타그램에 로그인만 하면 됩니다.

설치 안내: **https://hxvibe.github.io/followcheck/**

| 기기 | 방법 |
|---|---|
| 안드로이드 | [APK 다운로드](https://github.com/hxvibe/followcheck/releases/download/android/followcheck.apk) → 설치 → 앱에서 인스타 로그인 → 자동으로 결과 표시 |
| 아이폰 | Safari 북마크(북마클릿) 한 번 등록 → instagram.com 에서 북마크 실행 |
| PC | 북마크바에 끌어다 놓기 → instagram.com 에서 클릭 |

## 기능

- 나만 팔로우 / 상대만 팔로우 / 맞팔 / **변화**(지난 확인 이후 나를 언팔한 사람·새 팔로워)
- 검색, 아이디 목록 복사, CSV 저장(앱은 공유)
- 화이트·블루 UI, 라이트/다크/시스템 테마
- 이전 결과를 기기에 저장해 다시 열면 바로 표시

## 동작 방식

- **안드로이드 앱**: 앱 안의 웹뷰로 instagram.com 공식 로그인 화면을 띄웁니다(2단계 인증·보안 확인 그대로 지원).
  로그인되면 `src/followcheck.js` 화면을 자동으로 띄우고, 폰에서 인스타그램으로 직접 요청합니다.
  비밀번호는 인스타그램 페이지에만 입력되며 앱이 따로 저장하지 않습니다.
- **북마클릿**: 브라우저에 로그인된 instagram.com 위에서 같은 스크립트를 실행합니다.
- 조회: `/api/v1/friendships/{id}/followers|following/` (실패 시 GraphQL) — 페이지마다 0.9~1.7초, 12페이지마다 5~8초 쉬고, 429 응답이면 기다렸다 재시도.

## 구조

```
src/followcheck.js        화면 + 조회 로직 (instagram.com 위에서 실행, 앱/북마클릿 공용)
scripts/build.mjs         압축 → docs/bookmarklet.js, android/.../assets/followcheck.js
docs/                     GitHub Pages 설치 안내 페이지
android/                  안드로이드 앱 (Java, 의존성 없음)
.github/workflows/android.yml   main 푸시 시 APK 빌드 → 릴리스 "android" 에 업로드
test/smoke.mjs            가짜 인스타 API로 전체 흐름 테스트 (jsdom)
```

```bash
npm install
npm test                                  # 빌드 + 테스트
cd android && ./gradlew assembleRelease   # APK 직접 빌드 (Android SDK 필요)
```

APK는 저장소에 포함된 개인용 키(`android/followcheck.keystore`)로 서명돼서, 새 버전을 덮어 설치하면 업데이트됩니다.

## 주의

Instagram과 무관한 비공식 도구입니다. 내부 API는 예고 없이 바뀔 수 있고, 너무 자주 실행하면
인스타그램이 일시적으로 요청을 제한할 수 있으니 하루 몇 번 정도만 사용하세요.
