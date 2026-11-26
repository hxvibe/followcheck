# followcheck

인스타그램 **맞팔 / 나만 팔로우 / 상대만 팔로우**를 확인하는 개인용 웹앱.
인스타그램 **아이디·비밀번호로 로그인**하면 서버가 인스타그램 앱(안드로이드)과 같은 방식의 비공식 모바일 API로
팔로워·팔로잉 목록을 가져옵니다. 데이터 내보내기나 instagram.com 접속이 필요 없어요.

- 2단계 인증(인증 앱·SMS), 보안 확인 코드(이메일·SMS) 입력 지원
- 나만 팔로우 / 상대만 팔로우 / 맞팔 / **변화**(지난 확인 이후 나를 언팔한 사람·새 팔로워)
- 검색, 아이디 목록 복사, CSV 저장
- 화이트·블루 UI, 라이트/다크/시스템 테마, 홈 화면에 추가(PWA)

## 보안 설계

- 비밀번호는 로그인 요청에만 쓰이고 저장되지 않습니다.
- 서버에는 아무것도 저장하지 않습니다(DB 없음). 로그인 세션은 `SECRET_KEY`로 암호화한 토큰으로 브라우저에만 보관됩니다.
- 확인 결과도 브라우저(localStorage)에만 저장되고, 로그아웃하면 지워집니다.
- `ACCESS_CODE`를 설정하면 그 코드를 아는 사람만 서버를 쓸 수 있습니다(공개 배포 시 권장).

## 실행 방법

화면(`docs/`)은 GitHub Pages **https://hxvibe.github.io/followcheck/** 에서도 열립니다.
인스타 로그인·조회는 서버가 해야 하므로, 아래 A나 B로 서버를 하나 띄운 뒤
Pages 화면의 **서버 주소** 칸에 그 주소를 넣으면 됩니다. (서버 주소로 직접 접속해도 같은 화면이 나와요.)

### A. Render에 배포 (폰에서 어디서나)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hxvibe/followcheck)

1. 버튼 → Render 가입/로그인 → `ACCESS_CODE`에 원하는 비밀 코드 입력 → Apply
2. 배포가 끝나면 `https://followcheck-xxxx.onrender.com` 접속
   (또는 GitHub Pages 화면의 서버 주소 칸에 이 주소 입력)
3. 폰에서 열고 **홈 화면에 추가** (iPhone: 공유 → 홈 화면에 추가 / Android: ⋮ → 앱 설치)

> 무료 플랜은 15분간 안 쓰면 잠들어서 첫 접속이 30초쯤 걸려요.
> 해외 데이터센터 IP라 처음 로그인할 때 인스타그램이 **보안 확인 코드**(이메일/SMS)를 요구할 가능성이 높아요. 앱 화면에서 코드를 입력하면 됩니다.

### B. 집 PC에서 실행 (가장 안전 — 평소 쓰는 IP)

```bash
pip install -r requirements.txt
SECRET_KEY=아무-긴-문자열 uvicorn app.main:app --host 0.0.0.0 --port 8000
```

또는 Docker:

```bash
docker build -t followcheck .
docker run -p 8000:8000 -e SECRET_KEY=아무-긴-문자열 followcheck
```

같은 와이파이의 폰에서 `http://<PC의 IP>:8000` 으로 **직접** 접속하세요.
(GitHub Pages는 https라서 http 서버 주소는 브라우저가 막아요.) 밖에서도 쓰려면 [Tailscale](https://tailscale.com) 같은 VPN을 쓰세요.

### 환경 변수

| 이름 | 설명 |
|---|---|
| `SECRET_KEY` | 세션 토큰 암호화 키. 없으면 서버 재시작 때마다 다시 로그인해야 함 |
| `ACCESS_CODE` | (선택) 설정하면 로그인 화면에서 이 코드를 입력해야 사용 가능 |
| `ALLOWED_ORIGINS` | (선택) 이 서버를 부를 수 있는 다른 웹 주소. 기본값 `https://hxvibe.github.io` |
| `IG_PROXY` | (선택) 인스타 요청에 쓸 프록시. 예: `http://user:pass@host:port` (가정용 IP 프록시 권장) |

## 구조

```
app/main.py     FastAPI — API + 웹앱 정적 파일 제공
app/ig.py       instagrapi 로그인/스캔 작업 (백그라운드 스레드, 코드 입력 대기, 요청 제한 대기)
docs/           프론트엔드 (바닐라 JS, PWA) — 서버가 직접 제공 + GitHub Pages 배포
tests/          가짜 인스타 클라이언트로 API 흐름 테스트 (pytest)
```

API 흐름: `POST /api/login` → `GET /api/login/{job}` 폴링 (`need_code`면 `POST /api/login/{job}/code`) → 토큰 수신
→ `POST /api/scan` → `GET /api/scan/{job}` 폴링 → 결과.

```bash
pip install -r requirements.txt pytest httpx
python -m pytest -q
```

## 주의

Instagram과 무관한 비공식 도구입니다. 비공식 API 사용은 인스타그램 약관에 어긋나며,
새 기기·새 IP 로그인이나 잦은 조회는 보안 확인, 일시 제한, 드물게 계정 제재로 이어질 수 있어요.
하루 몇 번 정도만 확인하고, 가능하면 평소 쓰는 네트워크(B 방식)에서 실행하세요.
