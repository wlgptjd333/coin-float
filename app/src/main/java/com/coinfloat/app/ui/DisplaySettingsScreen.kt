package com.coinfloat.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coinfloat.app.market.PriceFormatter
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.SymbolDisplayMode

@Composable
fun DisplaySettingsContent(
    settings: OverlaySettings,
    onSymbolDisplayModeChange: (SymbolDisplayMode) -> Unit,
    onFontSizeChange: (Float) -> Unit,
    onTextColorChange: (String) -> Unit,
    onTextOpacityChange: (Float) -> Unit,
    onBackgroundColorChange: (String) -> Unit,
    onBackgroundOpacityChange: (Float) -> Unit,
    onPaddingChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Overlay Preview Card
        OverlayPreviewCard(settings = settings)

        // Symbol Display Mode
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "심볼 이름 표시",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))

                listOf(
                    SymbolDisplayMode.SHORT to "짧은 이름 (BTC 118,250.50)",
                    SymbolDisplayMode.FULL to "전체 이름 (BTCUSDT 118,250.50)",
                    SymbolDisplayMode.HIDDEN to "이름 숨김 (118,250.50)"
                ).forEach { (mode, label) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSymbolDisplayModeChange(mode) }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = settings.symbolDisplayMode == mode,
                            onClick = { onSymbolDisplayModeChange(mode) }
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        // Font Size (Ultra-wide range from 3sp to 24sp)
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "글자 크기 (초소형 3sp ~ 24sp)",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "${settings.fontSizeSp.toInt()} sp",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                Slider(
                    value = settings.fontSizeSp,
                    onValueChange = { onFontSizeChange(it.toInt().toFloat()) },
                    valueRange = 3f..24f,
                    steps = 20
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(text = "3sp (초소형)", style = MaterialTheme.typography.labelSmall)
                    Text(text = "11sp (기본)", style = MaterialTheme.typography.labelSmall)
                    Text(text = "24sp", style = MaterialTheme.typography.labelSmall)
                }
            }
        }

        // Text Color & Text Opacity
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "글자 색상 및 투명도",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))

                val textColors = listOf(
                    "#65D69A" to "기본 민트",
                    "#00E676" to "네온 그린",
                    "#FFFFFF" to "화이트",
                    "#FF5252" to "레드",
                    "#FFD600" to "골드",
                    "#40C4FF" to "스카이"
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    textColors.forEach { (hex, _) ->
                        val parsedColor = try {
                            Color(android.graphics.Color.parseColor(hex))
                        } catch (_: Exception) {
                            Color.White
                        }
                        val isSelected = settings.textColorHex.equals(hex, ignoreCase = true)

                        Box(
                            modifier = Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(parsedColor)
                                .border(
                                    width = if (isSelected) 3.dp else 1.dp,
                                    color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Gray,
                                    shape = CircleShape
                                )
                                .clickable { onTextColorChange(hex) }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))
                var hexInput by remember(settings.textColorHex) { mutableStateOf(settings.textColorHex) }
                OutlinedTextField(
                    value = hexInput,
                    onValueChange = {
                        hexInput = it
                        if (it.startsWith("#") && (it.length == 7 || it.length == 9)) {
                            onTextColorChange(it)
                        }
                    },
                    label = { Text("HEX 색상 코드") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "글자 투명도", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "${(settings.textOpacity * 100).toInt()}%",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Slider(
                    value = settings.textOpacity,
                    onValueChange = onTextOpacityChange,
                    valueRange = 0.1f..1.0f
                )
            }
        }

        // Background Color & Opacity
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "배경 색상 및 투명도",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))

                val bgColors = listOf(
                    "#EDEFF2" to "라이트 그레이",
                    "#121316" to "다크 그레이",
                    "#000000" to "블랙",
                    "#1E293B" to "슬레이트"
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    bgColors.forEach { (hex, _) ->
                        val parsedColor = try {
                            Color(android.graphics.Color.parseColor(hex))
                        } catch (_: Exception) {
                            Color.DarkGray
                        }
                        val isSelected = settings.backgroundColorHex.equals(hex, ignoreCase = true)

                        Box(
                            modifier = Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(parsedColor)
                                .border(
                                    width = if (isSelected) 3.dp else 1.dp,
                                    color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Gray,
                                    shape = CircleShape
                                )
                                .clickable { onBackgroundColorChange(hex) }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "배경 투명도", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "${(settings.backgroundOpacity * 100).toInt()}%",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Slider(
                    value = settings.backgroundOpacity,
                    onValueChange = onBackgroundOpacityChange,
                    valueRange = 0f..1f
                )
                Text(
                    text = "* 글자와 배경의 투명도를 각각 독립적으로 조절할 수 있습니다.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        // Box Size & Padding Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "박스 크기 & 여백 조절",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = "내부 여백 (패딩)", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "${settings.paddingDp} dp",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Slider(
                    value = settings.paddingDp.toFloat(),
                    onValueChange = { onPaddingChange(it.toInt()) },
                    valueRange = 0f..16f,
                    steps = 15
                )
                Text(
                    text = "* 0dp로 설정하면 화면 점유를 최소화하는 극초소형 모드가 됩니다.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
fun OverlayPreviewCard(settings: OverlaySettings) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "오버레이 미리보기",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(12.dp))

            val parsedBg = try {
                val c = android.graphics.Color.parseColor(settings.backgroundColorHex)
                Color(
                    red = android.graphics.Color.red(c) / 255f,
                    green = android.graphics.Color.green(c) / 255f,
                    blue = android.graphics.Color.blue(c) / 255f,
                    alpha = settings.backgroundOpacity.coerceIn(0f, 1f)
                )
            } catch (_: Exception) {
                Color(0x1AEDEFF2)
            }

            val parsedText = try {
                val c = android.graphics.Color.parseColor(settings.textColorHex)
                Color(
                    red = android.graphics.Color.red(c) / 255f,
                    green = android.graphics.Color.green(c) / 255f,
                    blue = android.graphics.Color.blue(c) / 255f,
                    alpha = settings.textOpacity.coerceIn(0.1f, 1.0f)
                )
            } catch (_: Exception) {
                Color(0xFF65D69A).copy(alpha = settings.textOpacity.coerceIn(0.1f, 1.0f))
            }

            val strokeAlpha = (settings.backgroundOpacity.coerceIn(0f, 1f) * 1.5f).coerceIn(0.2f, 0.85f)
            val strokeColor = try {
                val c = android.graphics.Color.parseColor(settings.backgroundColorHex)
                Color(
                    red = android.graphics.Color.red(c) / 255f,
                    green = android.graphics.Color.green(c) / 255f,
                    blue = android.graphics.Color.blue(c) / 255f,
                    alpha = strokeAlpha
                )
            } catch (_: Exception) {
                Color.LightGray.copy(alpha = 0.5f)
            }

            // Preview box representing the overlay on top of screen content
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(parsedBg)
                    .border(1.dp, strokeColor, RoundedCornerShape(6.dp))
                    .padding(
                        horizontal = (settings.paddingDp * 1.5f + 4f).dp,
                        vertical = (settings.paddingDp + 2f).dp
                    )
            ) {
                Column {
                    listOf(
                        "BTCUSDT" to "BTC" to "85,136.70",
                        "ETHUSDT" to "ETH" to "3,240.20"
                    ).forEach { (pair, mockPrice) ->
                        val (fullSym, shortSym) = pair
                        val label = when (settings.symbolDisplayMode) {
                            SymbolDisplayMode.FULL -> "$fullSym "
                            SymbolDisplayMode.SHORT -> "$shortSym "
                            SymbolDisplayMode.HIDDEN -> ""
                        }
                        Text(
                            text = "$label$mockPrice",
                            color = parsedText,
                            fontSize = settings.fontSizeSp.sp,
                            fontFamily = FontFamily.Monospace,
                            lineHeight = settings.fontSizeSp.sp * 1.25f
                        )
                    }
                }
            }
        }
    }
}
