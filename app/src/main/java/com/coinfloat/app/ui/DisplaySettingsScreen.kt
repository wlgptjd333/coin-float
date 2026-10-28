package com.coinfloat.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.coinfloat.app.settings.ChartSizeProfile
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.RefreshRateProfile
import com.coinfloat.app.settings.SymbolDisplayMode
import com.coinfloat.app.ui.components.Caption
import com.coinfloat.app.ui.components.Chevron
import com.coinfloat.app.ui.components.ControlBlock
import com.coinfloat.app.ui.components.Group
import com.coinfloat.app.ui.components.GroupDivider
import com.coinfloat.app.ui.components.ListRow
import com.coinfloat.app.ui.components.ScreenHeader
import com.coinfloat.app.ui.components.SectionLabel
import com.coinfloat.app.ui.components.Segmented
import com.coinfloat.app.ui.components.SmoothSlider
import com.coinfloat.app.ui.components.SwitchRow
import com.coinfloat.app.ui.theme.Cf

private val TEXT_COLORS = listOf("#65D69A", "#00E676", "#FFFFFF", "#FF5252", "#FFD600", "#40C4FF")
private val BG_COLORS = listOf("#1E2024", "#0B0E11", "#131722", "#000000", "#181A20", "#1E293B", "#1A1D24", "#EDEFF2")
private val MINI_INTERVALS = listOf("1m" to "1분", "3m" to "3분", "5m" to "5분", "15m" to "15분", "30m" to "30분", "1h" to "1시간", "4h" to "4시간", "1d" to "1일")

@Composable
fun SettingsContent(
    settings: OverlaySettings,
    appVersion: String,
    onSymbolDisplayModeChange: (SymbolDisplayMode) -> Unit,
    onShow24hChangeChange: (Boolean) -> Unit,
    onUpDownSchemeChange: (com.coinfloat.app.settings.UpDownScheme) -> Unit,
    onFontSizeChange: (Float) -> Unit,
    onTextColorChange: (String) -> Unit,
    onTextOpacityChange: (Float) -> Unit,
    onBackgroundColorChange: (String) -> Unit,
    onBackgroundOpacityChange: (Float) -> Unit,
    onPaddingChange: (Int) -> Unit,
    onChartEnabledChange: (Boolean) -> Unit,
    onChartIntervalChange: (String) -> Unit,
    onChartSizeProfileChange: (ChartSizeProfile) -> Unit,
    onCustomChartSizeChange: (widthDp: Int, heightDp: Int) -> Unit,
    onRefreshRateProfileChange: (RefreshRateProfile) -> Unit,
    onOpenAppInfo: () -> Unit,
    onShowStabilityHelp: () -> Unit,
    onShowGuide: () -> Unit,
    onShowLicenses: () -> Unit,
    onShowPrivacy: () -> Unit
) {
    Column {
        ScreenHeader("설정")

        SectionLabel("시세창 모양")
        Group {
            OverlayPreview(settings, Modifier.padding(12.dp))
            GroupDivider(startInset = 0)
            ControlBlock("종목 이름") {
                Segmented(
                    options = listOf(SymbolDisplayMode.SHORT to "짧게 (BTC)", SymbolDisplayMode.FULL to "전체", SymbolDisplayMode.HIDDEN to "숨김"),
                    selected = settings.symbolDisplayMode,
                    onSelect = onSymbolDisplayModeChange
                )
            }
            GroupDivider()
            SwitchRow(
                title = "24시간 등락률 함께 표시",
                subtitle = "가격 옆에 +1.23% 처럼 상승·하락 색으로",
                checked = settings.show24hChange,
                onCheckedChange = onShow24hChangeChange
            )
            GroupDivider()
            ControlBlock("글자 크기", "${settings.fontSizeSp.toInt()}sp") {
                SmoothSlider(settings.fontSizeSp, { onFontSizeChange(it.toInt().toFloat()) }, 3f..24f, steps = 20)
            }
            GroupDivider()
            ControlBlock("글자 색") {
                ColorRow(TEXT_COLORS, settings.textColorHex, "글자 색", onTextColorChange)
            }
            GroupDivider()
            ControlBlock("글자 진하기", "${(settings.textOpacity * 100).toInt()}%") {
                SmoothSlider(settings.textOpacity, onTextOpacityChange, 0.1f..1f)
            }
            GroupDivider()
            ControlBlock("배경 색") {
                ColorRow(BG_COLORS, settings.backgroundColorHex, "배경 색", onBackgroundColorChange)
            }
            GroupDivider()
            ControlBlock("배경 진하기", "${(settings.backgroundOpacity * 100).toInt()}%") {
                SmoothSlider(settings.backgroundOpacity, onBackgroundOpacityChange, 0f..1f)
            }
            GroupDivider()
            ControlBlock("여백", "${settings.paddingDp}dp") {
                SmoothSlider(settings.paddingDp.toFloat(), { onPaddingChange(it.toInt()) }, 0f..16f, steps = 15)
            }
        }

        SectionLabel("상승 · 하락 색")
        Group {
            ControlBlock("등락률 · 미니 차트 · 관심종목") {
                Segmented(
                    options = com.coinfloat.app.settings.UpDownScheme.values().map { it to it.label },
                    selected = settings.upDownScheme,
                    onSelect = onUpDownSchemeChange
                )
            }
        }

        SectionLabel("갱신 속도")
        Group {
            ControlBlock("초당 갱신 횟수") {
                Segmented(
                    options = listOf(
                        RefreshRateProfile.FPS_10 to "10회",
                        RefreshRateProfile.FPS_5 to "5회",
                        RefreshRateProfile.FPS_2 to "2회",
                        RefreshRateProfile.FPS_1 to "1회"
                    ),
                    selected = settings.refreshRateProfile,
                    onSelect = onRefreshRateProfileChange
                )
            }
        }
        Caption(
            when (settings.refreshRateProfile) {
                RefreshRateProfile.FPS_10 -> "가장 빠르지만 화면을 자주 다시 그려 발열과 배터리 소모가 늘어요."
                RefreshRateProfile.FPS_5 -> "추천 · 실시간으로 느껴지면서 발열이 적어요."
                RefreshRateProfile.FPS_2 -> "배터리 절약 · 0.5초마다 갱신해요."
                RefreshRateProfile.FPS_1 -> "최대 절약 · 1초마다 갱신해요."
            }
        )

        SectionLabel("미니 차트")
        Group {
            SwitchRow(
                title = "시세창을 누르면 미니 차트",
                subtitle = "그 자리에 캔들 차트를 펼쳐요",
                checked = settings.isChartEnabled,
                onCheckedChange = onChartEnabledChange
            )
            if (settings.isChartEnabled) {
                GroupDivider()
                ControlBlock("기본 봉 주기") {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        MINI_INTERVALS.forEach { (value, label) ->
                            Chip(label, settings.defaultChartInterval == value) { onChartIntervalChange(value) }
                        }
                    }
                }
                GroupDivider()
                ControlBlock("창 크기") {
                    Segmented(
                        options = listOf(ChartSizeProfile.SMALL to "작게", ChartSizeProfile.MEDIUM to "보통", ChartSizeProfile.LARGE to "크게", ChartSizeProfile.CUSTOM to "직접"),
                        selected = settings.chartSizeProfile,
                        onSelect = onChartSizeProfileChange
                    )
                }
                if (settings.chartSizeProfile == ChartSizeProfile.CUSTOM) {
                    ControlBlock("가로", "${settings.customChartWidthDp}dp") {
                        SmoothSlider(settings.customChartWidthDp.toFloat(), { onCustomChartSizeChange(it.toInt(), settings.customChartHeightDp) }, 160f..400f, steps = 23)
                    }
                    ControlBlock("세로", "${settings.customChartHeightDp}dp") {
                        SmoothSlider(settings.customChartHeightDp.toFloat(), { onCustomChartSizeChange(settings.customChartWidthDp, it.toInt()) }, 110f..350f, steps = 23)
                    }
                }
            }
        }
        if (settings.isChartEnabled) Caption("미니 차트 오른쪽 아래 손잡이를 끌면 크기를, 위쪽을 끌면 위치를 바꿀 수 있어요.")

        SectionLabel("차트 · 알람 도움말")
        Group {
            ListRow(
                title = "상황별 지표 · 알람 사용 설명서",
                subtitle = "추천 프로필 5종 · 알람 3단계 대응법 · 백테스트 요약",
                onClick = onShowGuide,
                trailing = { Chevron() }
            )
        }

        SectionLabel("안정적으로 사용하기")
        Group {
            ListRow(
                title = "시세창이 꺼지거나 권한이 풀릴 때",
                subtitle = "삼성 · Android 13 이상 설정 안내",
                onClick = onShowStabilityHelp,
                trailing = { Chevron() }
            )
            GroupDivider()
            ListRow(title = "앱 정보 열기", subtitle = "배터리 · 권한 · 제한된 설정", onClick = onOpenAppInfo, trailing = { Chevron() })
        }

        SectionLabel("정보")
        Group {
            ListRow(title = "버전", trailing = { Text("v$appVersion", style = MaterialTheme.typography.bodyMedium, color = Cf.TextMuted) })
            GroupDivider()
            ListRow(title = "오픈소스 라이선스", onClick = onShowLicenses, trailing = { Chevron() })
            GroupDivider()
            ListRow(title = "개인정보 처리방침", subtitle = "개인정보를 수집하지 않아요", onClick = onShowPrivacy, trailing = { Chevron() })
        }
        Caption(
            "Binance 선물 공개 시세를 사용하며 로그인·API 키·주문 기능이 없어요. 표시되는 시세·지표·추정치는 정보 제공용이며 " +
                "투자 권유가 아니에요. 데이터는 지연되거나 틀릴 수 있어요."
        )
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Cf.AccentSoft else Cf.Bg)
            .border(1.dp, if (selected) Cf.Accent else Cf.Line, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp)
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = if (selected) Cf.Text else Cf.TextMuted)
    }
}

/** Preset swatches plus "직접", which opens the full color picker. */
@Composable
private fun ColorRow(presets: List<String>, current: String, title: String, onPick: (String) -> Unit) {
    var showPicker by rememberSaveable { mutableStateOf(false) }
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        presets.forEach { hex ->
            val color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.Gray)
            val on = current.equals(hex, ignoreCase = true)
            Box(
                Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .border(2.dp, if (on) Cf.Accent else Color.Transparent, CircleShape)
                    .padding(3.dp)
                    .clip(CircleShape)
                    .background(color)
                    .border(1.dp, Color.White.copy(alpha = 0.12f), CircleShape)
                    .clickable { onPick(hex) }
            )
        }
        // a custom color shows as its own swatch next to the "직접" button
        val isCustom = presets.none { it.equals(current, ignoreCase = true) }
        Row(
            Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(if (isCustom) Cf.AccentSoft else Cf.Bg)
                .border(1.dp, if (isCustom) Cf.Accent else Cf.Line, RoundedCornerShape(8.dp))
                .clickable { showPicker = true }
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (isCustom) {
                val c = runCatching { Color(android.graphics.Color.parseColor(current)) }.getOrDefault(Color.Gray)
                Box(Modifier.size(14.dp).clip(CircleShape).background(c).border(1.dp, Color.White.copy(alpha = 0.2f), CircleShape))
                Spacer(Modifier.width(6.dp))
            }
            Text("직접", style = MaterialTheme.typography.labelMedium, color = if (isCustom) Cf.Text else Cf.TextMuted)
        }
    }
    if (showPicker) {
        com.coinfloat.app.ui.components.ColorPickerSheet(
            title = title,
            initialHex = current,
            presets = presets,
            onPick = onPick,
            onDismiss = { showPicker = false }
        )
    }
}
