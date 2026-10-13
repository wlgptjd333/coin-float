package com.coinfloat.app.ui.components

import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Brush
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coinfloat.app.ui.theme.Cf

// Building blocks shared by all screens: a grouped-list layout (section label → rounded group of rows), like the
// settings screens of polished banking / exchange apps.

@Composable
fun ScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    brand: Boolean = false,
    trailing: @Composable RowScope.() -> Unit = {}
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(start = 20.dp, end = 16.dp, top = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (brand) {
            BrandMark(28)
            Spacer(Modifier.width(10.dp))
        }
        Text(title, style = MaterialTheme.typography.headlineSmall, color = Cf.Text, modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 24.dp, end = 16.dp, top = 22.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = Cf.TextMuted, modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
fun Group(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Cf.Surface),
        content = content
    )
}

@Composable
fun GroupDivider(startInset: Int = 16) {
    Box(
        Modifier
            .padding(start = startInset.dp)
            .fillMaxWidth()
            .height(1.dp)
            .background(Cf.Line)
    )
}

@Composable
fun Caption(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = Cf.TextFaint,
        modifier = modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp)
    )
}

@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null && enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(12.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                color = if (enabled) Cf.Text else Cf.TextFaint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Cf.TextMuted)
            }
        }
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            trailing()
        }
    }
}

@Composable
fun Chevron() {
    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Cf.TextFaint, modifier = Modifier.size(20.dp))
}

@Composable
fun CfSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, enabled: Boolean = true) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedThumbColor = Color.White,
            checkedTrackColor = Cf.Accent,
            checkedBorderColor = Cf.Accent,
            uncheckedThumbColor = Cf.TextMuted,
            uncheckedTrackColor = Cf.SurfaceHigh,
            uncheckedBorderColor = Cf.Line
        )
    )
}

@Composable
fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    subtitle: String? = null,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null
) {
    ListRow(
        title = title,
        subtitle = subtitle,
        enabled = enabled,
        onClick = { onCheckedChange(!checked) },
        leading = leading,
        trailing = { CfSwitch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled) }
    )
}

/** Compact segmented control (replaces long radio-button lists). */
@Composable
fun <T> Segmented(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Cf.Bg)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 34.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (on) Cf.SurfaceHigh else Color.Transparent)
                    .clickable { onSelect(value) },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (on) Cf.Text else Cf.TextMuted,
                    maxLines = 1
                )
            }
        }
    }
}

/** A labelled control block inside a group: title (+ value on the right) above the control. */
@Composable
fun ControlBlock(title: String, value: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = Cf.Text, modifier = Modifier.weight(1f))
            if (value != null) Text(value, style = MaterialTheme.typography.labelLarge, color = Cf.Accent)
        }
        Spacer(Modifier.height(10.dp))
        content()
    }
}

/**
 * Slider that keeps its thumb in local state while being dragged. Binding the thumb straight to a value that is
 * written to DataStore and read back (async) makes it lag and jump during a drag; changes still go out immediately.
 */
@Composable
fun SmoothSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    modifier: Modifier = Modifier,
    steps: Int = 0
) {
    var local by remember { mutableFloatStateOf(value) }
    var dragging by remember { mutableStateOf(false) }
    LaunchedEffect(value) { if (!dragging) local = value }
    Slider(
        value = local,
        onValueChange = { dragging = true; local = it; onValueChange(it) },
        onValueChangeFinished = { dragging = false },
        valueRange = valueRange,
        steps = steps,
        modifier = modifier.height(28.dp),
        colors = SliderDefaults.colors(
            thumbColor = Color.White,
            activeTrackColor = Cf.Accent,
            inactiveTrackColor = Cf.SurfaceHigh,
            activeTickColor = Color.Transparent,
            inactiveTickColor = Color.Transparent
        )
    )
}

@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

/** The app icon (floating price window on mint) as a small mark for headers. */
@Composable
fun BrandMark(size: Int) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size * 0.28f).dp)),
        contentAlignment = Alignment.Center
    ) {
        // the adaptive-icon layers are 108 units with the visible part in the middle 72: draw them 1.5x and clip
        val layer = (size * 1.5f).dp
        androidx.compose.foundation.Image(
            androidx.compose.ui.res.painterResource(com.coinfloat.app.R.drawable.ic_launcher_background), null,
            modifier = Modifier.requiredSize(layer)
        )
        androidx.compose.foundation.Image(
            androidx.compose.ui.res.painterResource(com.coinfloat.app.R.drawable.ic_launcher_foreground), null,
            modifier = Modifier.requiredSize(layer)
        )
    }
}

// Brand colors of well-known coins; anything else gets a stable color from its name.
private val COIN_COLORS = mapOf(
    "BTC" to 0xFFF7931A, "ETH" to 0xFF627EEA, "SOL" to 0xFF9945FF, "XRP" to 0xFF2E3640, "BNB" to 0xFFF3BA2F,
    "DOGE" to 0xFFC2A633, "ADA" to 0xFF0033AD, "TRX" to 0xFFEB0029, "AVAX" to 0xFFE84142, "LINK" to 0xFF2A5ADA,
    "DOT" to 0xFFE6007A, "LTC" to 0xFF345D9D, "BCH" to 0xFF8DC351, "TON" to 0xFF0098EA, "SUI" to 0xFF4DA2FF,
    "PEPE" to 0xFF3D9A3B, "SHIB" to 0xFFFFA409, "HYPE" to 0xFF50D2C1, "ARB" to 0xFF28A0F0, "OP" to 0xFFFF0420,
    "NEAR" to 0xFF00C08B, "APT" to 0xFF2F3437, "UNI" to 0xFFFF007A, "ATOM" to 0xFF2E3148, "ETC" to 0xFF328332,
    "FIL" to 0xFF0090FF, "WIF" to 0xFFA07855, "ENA" to 0xFF3A3A44, "TIA" to 0xFF7B2BF9, "INJ" to 0xFF0082FA,
    "SEI" to 0xFF9B1C2E, "WLD" to 0xFF3A3A3A, "POL" to 0xFF8247E5, "MATIC" to 0xFF8247E5, "XLM" to 0xFF3A3F45,
    "AAVE" to 0xFFB6509E, "BONK" to 0xFFF8A30B, "ONDO" to 0xFF2C4B8F, "TAO" to 0xFF3B3B3B, "FET" to 0xFF1D2A4A
)
private val COIN_FALLBACK = listOf(
    0xFF2962FF, 0xFF7E57C2, 0xFF00897B, 0xFFE65100, 0xFFC2185B, 0xFF0097A7, 0xFF5D4037, 0xFF6D4C41, 0xFF3949AB, 0xFF00796B
)

/** Round coin badge in the coin's brand color with its initial ("1000PEPE" shows P). */
@Composable
fun CoinAvatar(base: String, size: Int = 36) {
    val name = base.uppercase().trimStart { it.isDigit() }.ifEmpty { base.uppercase() }
    val c = Color(COIN_COLORS[name] ?: COIN_FALLBACK[(name.hashCode() and 0x7fffffff) % COIN_FALLBACK.size])
    val light = c.luminance() > 0.55f
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(Brush.verticalGradient(listOf(c, lerp(c, Color.Black, 0.22f))))
            // near-black brand colors (XRP, APT ...) would vanish into the dark background
            .border(1.dp, Color.White.copy(alpha = if (c.luminance() < 0.06f) 0.16f else 0f), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            name.take(1),
            color = if (light) Color(0xFF15181E) else Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = (size * 0.42f).sp
        )
    }
}

/** Notice card for things the user must act on (permissions); soft tint instead of a loud error color. */
@Composable
fun Notice(
    icon: ImageVector,
    title: String,
    body: String,
    tint: Color = Cf.Warn,
    actions: @Composable RowScope.() -> Unit = {}
) {
    Column(
        modifier = Modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(tint.copy(alpha = 0.10f))
            .border(1.dp, tint.copy(alpha = 0.25f), RoundedCornerShape(16.dp))
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text(title, style = MaterialTheme.typography.titleSmall, color = Cf.Text)
        }
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodySmall, color = Cf.TextMuted)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), content = actions)
    }
}

@Composable
fun PillButton(text: String, onClick: () -> Unit, primary: Boolean = true, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .heightIn(min = 38.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (primary) Cf.Accent else Cf.SurfaceHigh)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (primary) Color.White else Cf.Text)
    }
}
