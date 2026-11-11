# 스터디 윗미

친구들과 공부를 인증하는 웹앱입니다. 한 장짜리 페이지로 묶어 claude.ai Artifact로 게시합니다.

- 게시 주소: https://claude.ai/artifact/PBBfPF6VRwSRLpT93ug8es
- 기능 명세서: https://claude.ai/artifact/6zUYFHr1p1DjR8NYr4emoo

## 구조

| 위치 | 내용 |
| --- | --- |
| `src/` | 앱 소스 (TypeScript, React 18). `store.ts` 상태와 구독, `actions.ts` 쓰기 동작, `logic.ts`·`derive.ts`·`time.ts` 규칙과 계산, `platform.ts` 실행 환경 연결, `localdb.ts` 기기 저장소, `ui/` 화면 |
| `types/` | `window.claude` 런타임 형식 정의 (런타임 0.2.96 기준) |
| `build.mjs` | esbuild로 `dist/index.html` 한 파일과 `dist/vendor/`(pdf.js와 글꼴 묶음)를 만든다 |
| `test/` | 가짜 `window.claude`와 Playwright 시나리오 |

## GitHub Pages 판 (Firebase)

claude.ai 밖에서 링크로 쓸 때는 공유 저장소로 Firebase(Firestore + 이메일·비밀번호 로그인)를 씁니다.

1. Firebase 콘솔에서 프로젝트를 만들고 Firestore(위치 `asia-northeast3`)와 Authentication의 **이메일/비밀번호** 로그인을 켭니다.
2. Firestore → 규칙 탭에 `firestore.rules` 내용을 붙여 넣고 게시합니다.
3. 웹 앱을 추가해 받은 `firebaseConfig` 값을 `firebase-config.json`에 JSON으로 넣습니다(공개돼도 되는 식별값).
4. `main`에 올리면 `.github/workflows/pages.yml`이 빌드해서 Pages에 게시합니다. 저장소 Settings → Pages의 Source는 **GitHub Actions**.

첫 화면은 로그인·회원가입이고, 가입 뒤 닉네임을 정하면 시작합니다. 같은 이메일로 어느 기기에서든 로그인할 수 있습니다.
파일 저장(Storage)은 유료 요금제가 필요해 쓰지 않습니다. 인증 사진은 줄여서 Firestore에 넣고, 학습장 자료는 올린 기기에만 저장됩니다.

에뮬레이터 테스트:

```
npx firebase-tools emulators:start --only firestore,auth --project demo-sw
APP_URL=http://127.0.0.1:4173/index.html FIREBASE_CONFIG='{"apiKey":"demo","projectId":"demo-sw","authDomain":"demo-sw.firebaseapp.com","appId":"1:1:web:1","emulator":"127.0.0.1"}' npm run build
npm run serve & node test/firebase.mjs
```

## 빌드와 게시 (claude.ai Artifact 판)

```
npm install
npm run typecheck
APP_URL=https://claude.ai/artifact/PBBfPF6VRwSRLpT93ug8es npm run build
```

`APP_URL`은 초대 링크에 들어가는 게시 주소입니다. 빼고 빌드하면 초대 링크 없이 코드만 보여 줍니다.

게시할 때는 `dist/index.html`을 페이지로, `dist/vendor/`의 파일 네 개를 `vendor/` 경로로 함께 올립니다.
런타임 기능은 `db`, `user`, `assets`를 선언합니다. 이미 게시된 주소를 고칠 때는 같은 주소로 다시 게시합니다.

## 테스트

```
APP_URL=https://claude.ai/artifact/PBBfPF6VRwSRLpT93ug8es npm run build:test   # dist/test.html, dist/mock-claude.js 도 만든다
npm run serve &                                                               # http://127.0.0.1:4173
npm test                                                                      # 시나리오 11단계, 날짜 5단계, 환경 9단계, 오래 켜 두기 3단계
```

- `test/scenario.mjs`: 세 사람이 가입부터 탈퇴까지 쓰는 흐름. 시계를 2026-11-10 19:30(KST)에 고정해 두고 돌린다
- `test/time.mjs`: 하루와 한 주가 넘어가는 경우(연속 인증, 주간 결산, 규칙 변경, 벌금)
- `test/modes.mjs`: 보기 전용, 쓰기 가능 여부를 모르는 경우, 계정 id 없음, 파일 저장소 없음, `claude` 없음, 응답 없음
- `test/resilience.mjs`: 오래 켜 둔 화면. 구독이 끊겼다 다시 열리는 경우(`window.__killSubs()`, `window.__subsOpened()`)와 개인 설정이 늦게 오는 경우(`&slowsettings=<ms>`)
- `test/visual.mjs`: 휴대폰·태블릿·데스크톱 화면 찍기 (`test/shots/`)
- `test/published.mjs`: 게시본을 내려받아 `dist/published.html`로 둔 뒤 휴대폰 안전 영역까지 확인

테스트 페이지는 주소의 쿼리로 사용자를 고릅니다. 자세한 값은 `test/mock-claude.ts` 맨 위에 있습니다.
모든 사용자는 같은 브라우저 컨텍스트의 페이지여야 서로의 변경을 봅니다.

## 실제 환경에서만 확인되는 것

가짜 환경으로는 볼 수 없어서 게시된 페이지에서 직접 확인해야 하는 부분입니다.

- 편집자로 초대받은 친구의 쓰기와 파일 올리기
- 학습장의 PDF 보기(작업자 스크립트와 글꼴 묶음 불러오기), HTML 자료의 격리 프레임
- 초대 링크의 `#join-코드`가 페이지까지 전달되는지
