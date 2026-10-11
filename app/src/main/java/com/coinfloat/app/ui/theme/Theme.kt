package com.coinfloat.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * CoinFloat design tokens. One dark palette for the whole app so the screens, the in-app chart (TradingView-like
 * #131722) and the floating window look like one product; trading apps are dark by convention.
 */
object Cf {
    val Bg = Color(0xFF0E1116)
    val Surface = Color(0xFF161A21)
    val SurfaceHigh = Color(0xFF1E232C)
    val Line = Color(0xFF262B35)
    val Text = Color(0xFFE8EAED)
    val TextMuted = Color(0xFF8D95A3)
    val TextFaint = Color(0xFF5E6573)
    val Accent = Color(0xFF4C8DFF)
    val AccentSoft = Color(0xFF1D2C47)
    val Brand = Color(0xFF3DDC97)
    val Up = Color(0xFF0ECB81)
    val Down = Color(0xFFF6465D)
    val Warn = Color(0xFFF0B90B)
    val WarnSoft = Color(0xFF2B2513)
}

private val ColorScheme = darkColorScheme(
    primary = Cf.Accent,
    onPrimary = Color.White,
    primaryContainer = Cf.AccentSoft,
    onPrimaryContainer = Color(0xFFD6E3FF),
    secondary = Cf.Brand,
    onSecondary = Color(0xFF00391E),
    secondaryContainer = Cf.AccentSoft,
    onSecondaryContainer = Color(0xFFD6E3FF),
    tertiary = Cf.Warn,
    background = Cf.Bg,
    onBackground = Cf.Text,
    surface = Cf.Bg,
    onSurface = Cf.Text,
    surfaceVariant = Cf.SurfaceHigh,
    onSurfaceVariant = Cf.TextMuted,
    surfaceContainer = Cf.Surface,
    surfaceContainerHigh = Cf.SurfaceHigh,
    surfaceContainerHighest = Cf.SurfaceHigh,
    surfaceContainerLow = Cf.Surface,
    surfaceContainerLowest = Cf.Bg,
    outline = Cf.Line,
    outlineVariant = Cf.Line,
    error = Cf.Down,
    onError = Color.White,
    errorContainer = Color(0xFF3A1A20),
    onErrorContainer = Color(0xFFFFDAD9)
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp),
    titleLarge = TextStyle(fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 12.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium)
)

@Composable
fun CoinFloatTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ColorScheme, typography = AppTypography, content = content)
}
