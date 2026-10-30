# CoinFloat 인수인계서

작성일: 2026-10-30 · 기준 버전: **v1.34.1**
받는 쪽: Gemini Argon 4 (이후 버그 수정 · 기능 개선 담당)

이 문서는 코드에서 바로 알 수 없는 것을 적었습니다. 내용이 코드와 다르면 코드가 맞습니다. 변경 이력은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.

---

## 1. 프로젝트 요약

| 항목 | 내용 |
|---|---|
| 무엇 | 다른 앱 위에 코인 시세를 띄우는 Android 오버레이와, 앱 안의 고급 차트(같은 차트의 웹 버전 포함) |
| 저장소 | https://github.com/wlgptjd333/coin-float (공개, AGPL-3.0) |
| 웹 | https://wlgptjd333.github.io/coin-float/ |
| 릴리즈 | https://github.com/wlgptjd333/coin-float/releases/latest |
| 데이터 | Binance USDⓈ-M 선물 공개 API · WebSocket. 차트 합산 기능은 Bybit · OKX · Hyperliquid · Bitfinex 공개 스트림도 사용 |
| 서버 | 자체 서버 없음. 로그인 · 설정 동기화는 Firebase(Authentication, Firestore, 프로젝트 `coin-float`)를 REST로 사용 |
| 테스트 기기 | Galaxy S23+ (SM-S916N), Android 17 빌드 |
| 사용자 | 개발자가 아닙니다. 설명은 한국어로, 결과 위주로 해 주세요. |

---

## 2. 반드시 지킬 것

1. **서명 키를 바꾸지 마세요.** 키가 바뀌면 앱을 지우고 새로 설치해야 해서 사용자 설정과 알람이 전부 사라집니다. 이미 한 번 겪었습니다(옛 키 분실, 2026-10-28에 새 키로 교체).
2. **비밀값을 출력 · 커밋하지 마세요.** 이 PC의 프로젝트 루트에 있는 `keystore.properties`에는 키 비밀번호가 평문으로 들어 있습니다(gitignore 대상). `C:\Users\User\dev\coinfloat-signing\`도 마찬가지입니다. 읽을 일이 없고, 서명은 CI가 합니다.
3. **폰의 앱을 지우지 마세요.** 업데이트는 `adb install -r`로 합니다.
4. **사용자가 폰을 쓰는 중이면 조작하지 마세요.** 통화, 게임, 지갑 앱을 쓰던 때가 실제로 있었습니다. 먼저 현재 화면을 확인하세요.
   ```bash
   adb shell "dumpsys window | grep -m2 -E 'mCurrentFocus|mFocusedApp'"
   ```
5. **Google · GitHub 로그인과 약관 동의는 사용자가 직접 합니다.**
6. **TradingView 스크립트나 tadpolescanner 데이터를 자동 수집하지 마세요.** 양쪽 모두 약관 문제가 있습니다. 지표는 공개된 공식으로 직접 작성합니다.
7. **"됐다"고 말하기 전에 실제로 확인하세요.** 무엇을 어디서 확인했고 무엇을 못 했는지 구분해서 보고합니다.

---

## 3. 구조

### Android (Kotlin, Jetpack Compose) — `app/src/main/java/com/coinfloat/app/`

| 경로 | 역할 |
|---|---|
| `overlay/FloatingOverlayService.kt` | 포그라운드 서비스. 시세 수신, 알림, 잠금 · 화면 상태 처리 |
| `overlay/OverlayController.kt` | 플로팅 창과 미니 차트. 탭 처리는 `handleOverlayClick` |
| `overlay/OverlayRestoreReceiver.kt` | 업데이트 · 재부팅 후 시세창 자동 복원 |
| `ui/TradingViewChartScreen.kt` | 차트 WebView와 JS 브리지(`ChartBridge`, `@JavascriptInterface`) |
| `alerts/` | 네이티브 알람 엔진. 앱이 꺼져 있어도 울림. CVD는 바이낸스 기준 |
| `sync/GoogleSignIn.kt` | Google 계정 시트(Credential Manager)로 ID 토큰 받기 |
| `settings/SettingsSync.kt` | 계정을 따라다니는 앱 설정(관심 종목, 시세창 모양)의 JSON 변환과 값 검증 |
| `market/` | Binance 클라이언트 |

### 차트 (빌드 단계 없는 순수 JS) — `app/src/main/assets/`

앱과 웹이 **같은 파일**을 씁니다. 이 파일을 고치면 양쪽이 함께 바뀝니다.

| 파일 | 역할 |
|---|---|
| `chart.html`, `chart.js` | 화면과 본체. 지표 계산(`stepInd`), 범례, 설정, 그리기, 공개 API `window.CF` |
| `flow.js` | 호가 벽, 히트맵, 청산, OI 등. 히트맵 저장도 여기 |
| `orderflow.js` | 체결 엔진, 풋프린트, DOM, 다른 거래소 합산, 합산 CVD |
| `pine.js`, `pine_lib.js`, `pinets_src.js` | Pine 실행기(Web Worker)와 지표 라이브러리 59개. `pinets_src.js`는 외부 코드 |
| `alerts.js`, `help.js`, `guide.txt`, `sync.js` | 알람 화면, 도움말, 설명서, 설정 파일 백업 |
| `cloud.js` | 로그인과 자동 동기화. 앱과 웹이 같은 코드. 규칙은 루트의 `firestore.rules` (콘솔에 수동 게시) |
| `lightweight-charts.js` | TradingView 차트 엔진 v5. 외부 코드, 수정 금지 |

### 웹 — `web/`

`web.js`가 Android 브리지를 대신합니다(코인 검색, 주소 상태, 탭 제목 실시간 가격). `delete-account.html`은 Play가 요구하는 계정 삭제 안내 페이지입니다. 사이트는 `.github/workflows/pages.yml`이 조립합니다.

### 기기 내 저장소

| 위치 | 내용 | 보관 |
|---|---|---|
| localStorage `cf.*` | 지표, 설정, 레이아웃 | 영구 |
| IndexedDB `cf_orderflow` | 체결 분 단위 묶음 | 48시간 |
| IndexedDB `cf_heatmap` (v2) | 히트맵 | 6개, 6시간 |
| IndexedDB `cf_xcvd` | 다른 거래소 분 단위 매수 · 매도 | 코인별 48시간 |

---

## 4. 빌드 · 테스트 · 배포

**이 PC에는 JDK, Android SDK, node, python이 없습니다.** 지금까지 APK는 전부 CI에서 빌드했습니다. 도구는 `%LOCALAPPDATA%\Programs\devtools` 아래 git, gh, platform-tools(adb), jadx, perfetto가 있고 PATH에 없어서 명령마다 지정해야 합니다.

```powershell
$env:PATH = "$env:LOCALAPPDATA\Programs\devtools\git\cmd;$env:LOCALAPPDATA\Programs\devtools\gh\bin;$env:LOCALAPPDATA\Programs\devtools\platform-tools;$env:PATH"
```

### 지금까지의 릴리즈 절차

1. 브랜치를 만들고 수정합니다. `app/build.gradle.kts`의 `versionCode` · `versionName`을 올리고 `CHANGELOG.md`에 기록합니다.
2. PR을 만들고 CI 통과를 확인합니다(`ci.yml`: 단위 테스트, lint, R8 릴리즈 빌드).
3. main에 합칩니다. 차트나 `web/`이 바뀌었으면 GitHub Pages가 자동 배포됩니다.
4. `vX.Y.Z` 태그를 push합니다. `release.yml`이 저장소 시크릿의 키로 서명해 릴리즈에 APK를 올립니다.
5. APK를 받아 `adb install -r`로 폰에 설치합니다. 시세창이 자동으로 다시 뜨는지 봅니다.

### 차트를 빠르게 확인하는 법

`pages.yml`의 "Assemble site" 단계대로 파일을 임시 폴더에 모아 localhost로 띄웁니다. 이 PC에서는 PowerShell `HttpListener`로 작은 정적 서버를 만들어 썼습니다. `file://`로는 브라우저 도구가 페이지를 조작하지 못했습니다.

콘솔 디버그 훅: `window.__cf`(차트 상태), `window.__of`(체결 엔진 · 합산 · `XC`), `window.__flow`. 지표 켜기는 localStorage `cf.ind`를 고친 뒤 새로고침합니다.

---

## 5. 코드 규칙과 함정

- **JS는 ES5 스타일**(`var`, `function`)이고 주석은 영어, UI 문구는 한국어입니다. 주변 코드에 맞춰 주세요.
- **줄바꿈은 CRLF입니다.** 정확한 문자열 치환 도구가 실패하면 이것부터 의심하세요.
- **가격 틱마다 DOM을 통째로 다시 그리지 마세요.** 범례를 그렇게 했다가 탭이 사라졌습니다. 요소는 유지하고 내용만 바꿉니다(`setText`).
- **Compose 애니메이션을 차트 화면에 넣을 때 조심하세요.** 헤더 색 애니메이션 하나가 WebView 전체를 계속 다시 그리게 했습니다.
- **콘솔에서 앱의 IndexedDB를 임의로 열지 마세요.** 테스트로 store 없는 v1 DB를 만들어 히트맵 저장을 망가뜨린 적이 있습니다. 그래서 `cf_heatmap`이 v2입니다.
- **브라우저 Google 로그인 팝업은 사람이 직접 누른 클릭으로만 열립니다.** 자동화로는 테스트되지 않습니다.
- **웹 캐시:** 스크립트는 배포마다 `?v=<sha>`가 붙지만 HTML은 최대 10분 캐시될 수 있습니다.
- **`ci.yml`의 문법 검사는 `chart.js`와 `flow.js`만 봅니다.** 나머지 JS는 main에 합친 뒤 `pages.yml`에서야 검사됩니다. 합치기 전에 직접 확인하세요.

---

## 6. 의도한 동작 (되돌리지 마세요)

| 동작 | 이유 |
|---|---|
| 차트가 열려 있을 때 플로팅 숫자를 누르면 항상 닫힘. 다른 줄을 눌러도 코인이 바뀌지 않음 | 사용자가 신고한 원래 버그의 수정. 코인 변경은 차트 안에서 |
| 잠금 상태에서 화면이 켜져 있으면 알림 가격을 1초마다 갱신, 화면이 꺼지면 연결 끊음 | 잠그기 직전 가격에 멈춰 있던 문제. 배터리와의 절충 |
| 십자선: 길게 눌러 나타나고, 드래그로 이동, 다음 탭까지 유지, 기본값 자유 이동 | 사용자 요청: TradingView와 동일하게 |
| 차트 지표는 왼쪽 위 범례 줄을 탭해 👁 ⚙ ✕ | 사용자 요청: TradingView와 동일하게 |
| 히트맵은 자리를 비운 시간만큼 빈 칸 | Binance가 과거 호가를 주지 않음. 백그라운드 수집은 배터리 · 데이터 비용이 커서 제외 |
| 합산 CVD는 켜 둔 뒤부터 쌓이고, 범례에 "합산" 표시 | 과거를 메울 수 있는 거래소가 일부뿐이라 일관되게 실시간만 씀(8번 참고). 합산된 구간은 표시로 구분 |
| Bitfinex 합산 기본 꺼짐 | 선물 규모가 작음 |

---

## 7. 아직 확인되지 않은 것

코드는 배포됐지만 **아래는 실제 사용 환경에서 검증되지 않았습니다.** 가장 먼저 확인하길 권합니다.

| 항목 | 확인된 곳 | 미확인 |
|---|---|---|
| 합산 CVD (1.33.0) | 웹(계산, 복원, 끄기), 폰("합산" 표시) | 장시간 사용 시 메모리와 배터리 |
| Google 계정 동기화 (1.34.1) | 폰 ↔ 웹 왕복, 첫 로그인 선택 화면, 3분간 불필요한 업로드 없음 | 실제 계정 삭제, 다른 계정의 접근 거부, 오래 쓴 뒤의 충돌 |

폰에서 확인된 것: 차트 토글 버그와 잠금화면 가격 수정, 업데이트 후 시세창 복원, 차트 화면 성능 개선(12초 측정, `Recomposer:animation` 167→0, WebView `drawGl` 179→72. 지표 구성이 달라 Jank %는 비교 불가), 십자선(길게 누르기, 드래그, 손 뗀 뒤 유지, 탭으로 끄기), 범례 탭의 👁 ⚙ ✕, 숨기기.

히트맵 복원(빈 칸 포함)과 검색 결과가 키보드 위에 보이는 것도 폰에서 확인했습니다. API 36에서 상태바 · 하단 메뉴 겹침도 없었습니다.

**동기화에 새 저장 키를 추가할 때:** `cf.`로 시작하는 localStorage 키는 기본적으로 전부 동기화됩니다. 자주 바뀌는 캐시나 기기별 값이면 `sync.js`의 `isDeviceKey`에 넣어야 합니다. 빠뜨리면 기기들이 서로 덮어쓰고 페이지가 새로고침됩니다(1.34.0의 `liq.<코인>` 버그, 릴리즈 전에 잡음). `v1.34.0` 태그는 남아 있지만 릴리즈되지 않았습니다.

**접근 규칙 게시:** `firestore.rules`를 바꾸면 Firebase 콘솔에 직접 게시하고, 페이지를 떠나기 전에 규칙 기록에 새 항목이 생겼는지 확인하세요. 익명 접근 403만으로는 규칙이 적용됐는지 알 수 없습니다.

폰에서 자동 조작할 때: 범례 선택은 6초 뒤 자동 해제되므로, 스크린샷을 읽고 다음 탭을 보내면 이미 해제되어 있습니다. 한 명령 안에서 연달아 보내세요.

---

## 8. 남은 일 (제안 순서)

### 먼저

1. **스토어 준비.** `targetSdk` 36과 AAB는 들어갔습니다. Paparazzi 스크린샷 테스트는 compileSdk 36에서 돌지 않아 제거했습니다(기준 이미지가 없어 잃은 검증은 없음. 다시 넣으려면 Kotlin 2 업그레이드 필요). Play 앱 서명은 **기존 키를 그대로 등록**해야 GitHub APK와 Play 빌드가 서로 업데이트되고 Android OAuth 클라이언트의 SHA-1도 유지됩니다. Google 키를 쓰면 그 SHA-1로 Android 클라이언트를 하나 더 만들어야 합니다. 수익화 전 법률 · 세무 확인도 필요합니다. 스토어 설명, 권한 신고 문구, 데이터 보안 답변, 테스터 모집 글은 `docs/store-launch.md`에 있습니다. Binance가 막히는 지역에서 빈 화면 대신 이유를 보여 주는 처리는 아직 없습니다.
2. **동기화의 한계.** 앱의 동기화는 차트 페이지가 떠 있을 때 돕니다(앱에서 차트 탭을 열 때). 관심 종목만 바꾸고 차트 탭을 안 열면 다음에 열 때 올라갑니다. 양쪽을 모두 바꿨으면 나중 것이 이깁니다.
3. **7번 항목을 폰에서 확인**하고 나오는 버그를 수정합니다.

### 공개 배포를 원할 때

4. **Google OAuth 동의 화면이 "테스트 중"입니다**(2026-10-30 기준, 홈페이지 · 개인정보처리방침 입력 완료, "앱 게시"만 남음). 등록된 테스트 사용자만 로그인됩니다. 프로젝트 `coin-float`, 웹 · Android 클라이언트 생성 완료. 동기화가 Firebase로 바뀌어 `drive.appdata` 범위는 더 쓰지 않으니 데이터 액세스에서 빼도 됩니다. 프로덕션 전환은 사용자가 Google Cloud에서 직접 합니다. Android 클라이언트는 패키지명과 현재 릴리즈 키의 SHA-1에 묶여 있습니다.

### 알려진 소소한 한계

6. 합산 CVD는 진행 중인 봉만 다시 계산합니다. 봉이 닫힌 직후 도착한 체결은 다음 전체 재계산 때 반영되어 값이 조금 달라질 수 있습니다.
7. 네이티브 알람의 CVD는 바이낸스만 계산합니다. 합산을 쓰는 알람은 없습니다.8. 웹에서는 알람이 저장만 되고 울리지 않습니다. 비트파이넥스 패널은 앱 전용입니다(`bfxGet` 브리지). 플로팅 시세창 설정과 관심 종목은 백업 파일에 포함되지 않습니다.
10. **합산 CVD의 과거 구간 (API로 확인함, 2026-10-30):** OKX `rubik/stat/taker-volume-contract`는 봉별 매수 · 매도량을 20일 전까지 돌려줬고, Bitfinex `trades/.../hist`는 방향이 있는 과거 체결을 줍니다. Bybit `recent-trade`와 Hyperliquid `recentTrades`는 최근 체결만, 두 거래소의 캔들 API에는 매수 · 매도 구분이 없습니다. 즉 OKX와 Bitfinex만 메울 수 있고, 거래소마다 합산 시작 지점이 달라지는 문제를 먼저 정해야 합니다.

### 기능 계획: tadpolescanner.com 벤치마킹 (미착수)

사용자가 계획을 요청해 전달했지만 **구현은 시작하지 않았습니다.** 코드에 스크리너 · 스캐너가 없습니다. CoinFloat은 차트 · 알람 · 오더플로우가 강하고, 그 사이트는 "여러 종목을 한 번에 훑는" 기능이 앞섭니다. 사용자가 우선순위를 정하게 해 주세요.

| 단계 | 기능 | 내용 | 규모 |
|---|---|---|---|
| 1 | 스크리너 탭 | 전 종목 표: 가격, 24h, 7d, 미니차트, 거래대금, 펀딩, 고점 · 저점 대비, 상장일. 정렬 · 필터 | 중 |
| 1 | 자산 종류 태그 | Binance 선물의 주식 · ETF · 원자재 구분 | 소 |
| 1 | 관심목록 요약 | 상승 n개 / 하락 n개 막대 | 소 |
| 2 | 스캐너 | 기존 알람 조건을 거래대금 상위 N개에 실행. 누르면 근거 캔들이 표시된 차트로 | 대 |
| 2 | 포착 기록, 즐겨찾기 스캔 | 알람 기록 구조 재사용 | 중 |
| 3 | 시장 전체 알람 | 선택 시에만. 예: 상위 50종목 중 15분 거래량 4배. 배터리 · API 한도 고려 | 대 |
| 3 | 스크리너 계산 열 | RSI(1D), OI 1일 변화 | 중 |

하지 않을 것: 그 사이트 데이터 수집(자동 수집 금지), 고유 기법 정의(7080 · 8090, 네 번째 주봉 등)나 디자인 · 브랜딩 복제. 데이터는 Binance 공개 API만 사용합니다.

---

## 9. 참고 측정값

- 플로팅 창: 약 2fps, CPU 약 2.5%로 이미 가벼움.
- BTC 체결 비중 (20초 표본, 금액 기준): Binance 46.3%, Hyperliquid 23.3%, OKX 16.5%, Bybit 14.0%. 합산 시 약 60건/초.

---

## 10. 사용자 쪽에서 챙길 것

- **서명 키 백업:** 키 파일은 이 PC에만 있습니다. GitHub 시크릿은 CI가 쓸 수만 있고 다시 꺼낼 수 없습니다. PC를 잃으면 또 재설치해야 합니다. 비밀번호 관리자나 암호화된 저장소에 백업하세요.
- **비밀값은 AI에게 넘기지 마세요.** 키 비밀번호는 어떤 AI 도구에도 붙여넣을 필요가 없습니다.
