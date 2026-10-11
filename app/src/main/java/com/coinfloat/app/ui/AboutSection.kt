package com.coinfloat.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.coinfloat.app.ui.theme.Cf

/** Dialogs opened from the settings and home screens. Long legal texts are assets so they can change without code. */
enum class InfoSheet { LICENSES, PRIVACY, STABILITY, PERMISSION }

const val STABILITY_HELP = """Samsung Galaxy와 Android 13 이상에서는 절전·보안 정책 때문에 시세창이 꺼지거나 권한이 풀릴 수 있어요. 아래 설정을 한 번 해 두면 안정적이에요.

1. 제한된 설정 허용
   앱 정보 › 오른쪽 위 ⋮ › '제한된 설정 허용'

2. 배터리 사용 제한 없음
   앱 정보 › 배터리 › '제한 없음'

3. 권한 자동 삭제 끄기
   앱 정보 › '사용하지 않는 앱 권한 삭제' 끄기

4. 절전 예외 앱 등록
   설정 › 디바이스 케어 › 배터리 › 백그라운드 사용 제한 › '절전 예외 앱'에 CoinFloat 추가"""

const val PERMISSION_HELP = """직접 설치한 앱은 Android 13 이상에서 '다른 앱 위에 표시' 스위치가 회색으로 잠겨 있을 수 있어요.

1. 홈의 '권한 허용' 대신 설정 › 앱 › CoinFloat (앱 정보)를 엽니다.
2. 오른쪽 위 ⋮ › '제한된 설정 허용'을 누르고 화면 잠금으로 확인합니다.
3. 다시 '권한 허용'을 눌러 '다른 앱 위에 표시'를 켭니다.

권한이 자꾸 풀린다면 설정 탭 › '시세창이 꺼지거나 권한이 풀릴 때'도 확인해 주세요."""

@Composable
fun InfoDialog(sheet: InfoSheet, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val (title, body) = when (sheet) {
        InfoSheet.STABILITY -> "안정적으로 사용하기" to STABILITY_HELP
        InfoSheet.PERMISSION -> "권한이 허용되지 않을 때" to PERMISSION_HELP
        InfoSheet.LICENSES, InfoSheet.PRIVACY -> {
            val asset = if (sheet == InfoSheet.PRIVACY) "privacy.txt" else "licenses.txt"
            val text = remember(asset) {
                runCatching { context.assets.open(asset).bufferedReader().use { it.readText() } }.getOrDefault("문서를 불러오지 못했어요.")
            }
            (if (sheet == InfoSheet.PRIVACY) "개인정보 처리방침" else "오픈소스 라이선스") to text
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Cf.Surface,
        titleContentColor = Cf.Text,
        textContentColor = Cf.TextMuted,
        title = { Text(title, style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(modifier = Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState())) {
                Text(body, style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("확인", color = Cf.Accent) } }
    )
}
