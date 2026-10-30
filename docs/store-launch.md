# 스토어 출시 준비 자료

Google Play Console에 그대로 옮겨 쓰는 초안입니다. 제출 전에 Play Console 화면의 최신 문구와 비교하세요.

## 1. 스토어 등록 정보

- **앱 이름 (30자 이내):** CoinFloat - 코인 시세 플로팅 창
- **간단한 설명 (80자 이내):** 다른 앱 위에 코인 시세를 작게 띄워 두고, 누르면 차트가 바로 열려요.

**자세한 설명:**

```text
유튜브를 보거나 게임을 하면서도 코인 시세를 놓치지 마세요.
CoinFloat은 어떤 앱 위에든 작은 시세창을 띄워 두는 앱입니다.

■ 플로팅 시세창
· 배경 없는 투명한 숫자로 화면을 가리지 않아요
· 원하는 곳으로 끌어서 옮기고, 글자 크기와 색을 바꿀 수 있어요
· 누르면 그 자리에서 미니 차트가 열려요
· 잠금화면 알림에서도 시세를 볼 수 있어요

■ 고급 차트
· 이동평균, VWAP, 볼린저, RSI, MACD 등 기본 지표와 지표 59종 라이브러리
· CVD, 미결제약정, 청산, 호가 벽과 히트맵, 풋프린트
· 여러 거래소 체결을 합쳐 보는 합산 CVD
· Pine Script 지표 붙여넣기, 추세선과 피보나치 등 그리기 도구

■ 알람
· 거래량 급증, 돌파, 다이버전스 등 조건을 정해 두면 앱을 닫아도 알려 줘요

■ 어디서나 같은 설정
· Google 로그인(선택)으로 앱과 웹 버전의 설정이 자동으로 맞춰져요

■ 안내
· 공개 시세 데이터만 사용해요. 거래소 계정이나 API 키가 필요 없고, 주문 기능도 없어요.
· 표시되는 시세, 지표, 추정치는 정보 제공용이며 투자 권유나 자문이 아닙니다. 데이터는 지연되거나 틀릴 수 있습니다.
· 이 앱은 어떤 거래소나 차트 서비스와도 제휴 관계가 없습니다.

오픈소스(AGPL-3.0): https://github.com/wlgptjd333/coin-float
```

**주의:** 스토어 이미지와 설명에 Binance, TradingView의 로고나 이름을 내세우지 않습니다. 매수 · 매도 "신호", "수익" 같은 표현도 쓰지 않습니다.

- **카테고리:** 금융
- **개인정보처리방침:** https://github.com/wlgptjd333/coin-float/blob/main/PRIVACY.md
- **계정 삭제 URL:** https://wlgptjd333.github.io/coin-float/delete-account.html

## 2. 권한 신고 문구

**포그라운드 서비스 (특수 용도, FOREGROUND_SERVICE_SPECIAL_USE)**

```text
The app's core feature is a small floating window showing live cryptocurrency prices on top of other apps, which the
user turns on themselves. The foreground service keeps the WebSocket price stream and the overlay window alive while
the user is in other apps, and shows a persistent notification with Hide / Show / Stop actions. No other foreground
service type fits a continuously visible, user-started market-price overlay. If the service stopped, the prices on
screen would freeze or the window would disappear while the user is relying on it. The stream pauses when the screen
is off or the user hides the window.
```

**다른 앱 위에 표시 (SYSTEM_ALERT_WINDOW):** 앱의 핵심 기능이며, 사용자가 시스템 설정에서 직접 허용합니다. 시스템 UI를 가리거나 입력을 가로채지 않고, 사용자가 언제든 끌거나 숨길 수 있습니다.

**정확한 알람 (SCHEDULE_EXACT_ALARM):** 사용자가 만든 차트 알람을 봉 마감 시각에 확인합니다. 사용자가 시스템 설정에서 허용합니다.

**심사 안내 (App access 항목):**

```text
No account is needed; Google sign-in is optional. To see the core feature: open the app, turn on "시세창 켜기" on the
Home tab and allow "Display over other apps". The chart tab opens without any setup.
Market data comes from Binance's public API, which blocks some regions such as the United States. If the prices stay
empty, please test from a region where Binance is available (for example South Korea).
```

**심사 위험:** Binance 선물 API는 미국 등 일부 지역에서 HTTP 451로 막힌다고 보고됩니다(개발자 포럼 기준). 심사 환경이 미국이면 시세가 비어 "작동하지 않는 앱"으로 거절될 수 있습니다. 대응: 출시 국가를 Binance 이용 가능 지역으로 제한하고, 위 안내를 적고, 451을 받으면 빈 화면 대신 이유를 보여 주는 처리를 앱에 넣습니다(아직 안 됨).

## 3. 데이터 보안 양식

| 질문 | 답 |
|---|---|
| 데이터 수집 | 예 (Google 로그인을 쓰는 사용자만) |
| 수집 데이터 | 이메일 주소, 사용자 ID, 앱 내 설정(기타 앱 활동) |
| 수집 목적 | 앱 기능, 계정 관리 |
| 처리 방식 | 선택 사항 (로그인은 필수 아님) |
| 제3자 공유 | 아니요 (Firebase는 서비스 제공자) |
| 전송 중 암호화 | 예 |
| 삭제 요청 가능 | 예 (앱과 웹) |
| 광고 ID, 위치, 연락처, 금융 정보 | 수집 안 함 |

**금융 기능 신고:** 거래소, 지갑, 주문 기능이 없습니다. 시세 조회 전용으로 답합니다.

## 4. 앱 서명

Play 앱 서명을 켤 때 **기존 키를 업로드하는 방식**을 고릅니다. 그래야 GitHub APK와 Play 빌드가 서로 업데이트되고, Google 로그인의 Android 클라이언트(SHA-1)를 그대로 쓸 수 있습니다. Google이 만든 키를 쓰면 Google Cloud에 그 SHA-1로 Android 클라이언트를 추가해야 합니다. 비밀번호는 Play Console 안내에 따라 직접 처리하고, 채팅이나 AI 도구에 붙여 넣지 않습니다.

## 5. 테스터 모집

조건: 비공개 테스트에 12명 이상이 참여한 상태로 14일. 빠지는 사람에 대비해 15명 이상을 목표로 합니다.

**모집 글:**

```text
[테스터 모집] 다른 앱 위에 코인 시세 띄우는 앱 만들고 있어요

유튜브나 게임 하면서도 시세 보고 싶어서 직접 만든 앱입니다.
투명한 숫자로 화면 위에 떠 있고, 누르면 차트가 바로 열려요.
CVD, 호가 히트맵, 풋프린트, 합산 체결도 들어 있습니다.

플레이스토어에 정식으로 올리려면 2주간 12명 이상의 테스트가 필요해서 도움을 부탁드립니다.
무료이고, 광고와 결제가 없으며, 거래소 계정이나 API 키도 필요 없습니다. 소스도 공개돼 있어요.

참여 방법 (안드로이드 폰, 1분)
1. 참여 링크 열기: [Play Console 비공개 테스트 링크]
2. "테스터 되기" 누르기
3. 플레이스토어에서 설치하고 2주만 지워지지 않게 두기

불편한 점이나 원하는 기능을 알려 주시면 바로 반영할게요.
웹으로 먼저 구경하기: https://wlgptjd333.github.io/coin-float/
```

게시 전에 게시판의 홍보 규칙을 확인합니다.

**관리표:** 이름 또는 닉네임 / Google 계정 이메일(비공개 테스트 명단용) / 참여일 / 의견

## 6. 순서

1. 사용자: Play 개발자 계정 등록과 본인 인증
2. AAB 업로드, 위 자료 입력, 비공개 테스트 트랙 생성
3. 테스터 모집, 14일 진행, 받은 의견 반영
4. 정식 출시 신청
5. 원스토어 등록 검토, 사업자 등록 후 Galaxy Store 검토
