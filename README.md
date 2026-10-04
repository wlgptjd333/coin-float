# CoinFloat

> **Android 초소형 암호화폐 실시간 시세 오버레이 앱**

다른 앱(유튜브, 웹브라우징, 게임, 메신저 등)을 사용하는 동안에도 화면 위에 방해되지 않는 초소형 플로팅 오버레이를 띄워 Binance USDⓈ-M Futures 실시간 체결 시세를 확인할 수 있는 개인용 APK 앱입니다.

---

## 🚀 주요 기능

- **Binance USDⓈ-M Futures 실시간 현재가 표시**:
  - 공개 Aggregate Trade Stream (`wss://fstream.binance.com/market/stream`, 100ms 체결 갱신)
  - 단일(1개) WebSocket 커넥션으로 배터리 및 네트워크 리소스 최소화
- **초소형 플로팅 오버레이 (WindowManager TYPE_APPLICATION_OVERLAY)**:
  - 여백 없는 컴팩트 크기 (`WRAP_CONTENT`, 내부 패딩 0dp 기본 지원)
  - 원하는 위치로 자유롭게 드래그 & 이동 시 위치 좌표 자동 영구 저장
- **배경 투명도 & 글자 가독성 분리**:
  - 기본 설정: 글자 크기 11sp, 텍스트 색상 `#65D69A`, 배경색 `#EDEFF2`, 배경 투명도 10%
  - 창 전체 alpha가 아닌 배경 색상에만 투명도를 적용하여 글씨는 100% 선명하게 유지
- **3가지 심볼 표시 모드**:
  - **SHORT (기본)**: `BTC 118,250.50`, `ETH 4,325.20`
  - **FULL**: `BTCUSDT 118,250.50`, `ETHUSDT 4,325.20`
  - **HIDDEN**: `118,250.50`, `4,325.20` (초소형 화면 점유)
- **심볼 관리 및 검색**:
  - USDT 마진 무기한 선물(USDT-M Perpetual) 전체 실시간 검색 및 추가/삭제
  - 시세 표시 순서 위/아래(↑ / ↓) 재정렬 지원
- **Foreground Service & 무간섭 지속 알림**:
  - **숨기기 (Hide)**: 오버레이 창만 화면에서 숨기고 백그라운드 WebSocket 및 서비스는 그대로 유지
  - **표시 (Show)**: 숨겨진 오버레이를 즉시 복원하여 최신 시세 확인
  - **완전 종료 (Stop)**: WebSocket 해제, 알림 해제, 오버레이 제거 및 서비스 완전 중단
- **안정적인 네트워크 자동 재연결**:
  - 지수 백오프(Exponential Backoff + Jitter, 1s → 2s → 4s → 8s → 16s → 30s)
  - 재연결 시 현재 설정된 모든 심볼 자동 재구독

---

## 📱 요구 권한

1. **다른 앱 위에 표시 (`SYSTEM_ALERT_WINDOW`)**
   - 시세창 오버레이를 띄우기 위해 시스템 설정에서 사용자 승인이 필요합니다.
2. **알림 표시 (`POST_NOTIFICATIONS`)**
   - Android 13(API 33) 이상에서 지속적인 백그라운드 실시간 서비스 유지 및 알림바 숨기기/표시/종료 액션을 사용하기 위해 권한을 권장합니다.

---

## 🔒 데이터 출처 및 보안 주의사항

- **공개 시장 데이터(Public Market Data)만 사용**
  - Binance Futures 공개 WebSocket 및 공개 REST (`/fapi/v1/exchangeInfo`)만 호출합니다.
- **불필요한 기능 일절 배제**:
  - ❌ 로그인 / 회원가입 없음
  - ❌ API Key / Secret Key 입력창 없음
  - ❌ 주문 / 거래 / 잔고 / 포지션 조회 기능 없음
  - ❌ 외부 서버 / 데이터베이스 통신 없음

---

## ⚙️ Android 버전별 & 기기별 주의사항

- **Android 14 (API 34) & Android 15 (API 35)**:
  - Foreground Service Type으로 `specialUse`를 채택하여 장시간 실시간 시세 스트림을 안정적으로 수신합니다.
- **삼성 Galaxy / One UI**:
  - 삼성 기기의 적극적인 백그라운드 절전 정책으로 인해 서비스가 중단되는 것을 방지하려면:
    - `설정 > 배터리 > 백그라운드 사용 제한 > 절전 예외 앱`에 **CoinFloat**을 추가하는 것을 권장합니다.
    - `애플리케이션 정보 > CoinFloat > 배터리 > 제한 없음` 선택.

---

## 🛠️ 빌드 및 설치 방법

### 1. 테스트 실행
```bash
./gradlew test
```

### 2. Debug APK 빌드
```bash
./gradlew assembleDebug
```
생성된 APK 경로:
`app/build/outputs/apk/debug/app-debug.apk`

### 3. 기기 설치 (ADB)
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
