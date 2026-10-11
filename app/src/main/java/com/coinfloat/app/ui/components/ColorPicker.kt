package com.coinfloat.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.onSizeChanged
import com.coinfloat.app.ui.theme.Cf

/** Picker state in HSV, so the saturation/brightness pad and the hue bar move independently. */
class HsvColor(hex: String) {
    var hue by mutableFloatStateOf(0f)
    var sat by mutableFloatStateOf(0f)
    var value by mutableFloatStateOf(1f)

    init { setHex(hex) }

    val color: Color get() = Color.hsv(hue.coerceIn(0f, 360f), sat.coerceIn(0f, 1f), value.coerceIn(0f, 1f))
    val hex: String get() = String.format("#%06X", color.toArgb() and 0xFFFFFF)

    fun setHex(hex: String): Boolean {
        val argb = runCatching { android.graphics.Color.parseColor(hex) }.getOrNull() ?: return false
        val hsv = FloatArray(3)
        android.graphics.Color.colorToHSV(argb, hsv)
        // keep the hue when the color is grey (its hue is undefined) so the bar does not jump to red
        if (hsv[1] > 0f && hsv[2] > 0f) hue = hsv[0]
        sat = hsv[1]
        value = hsv[2]
        return true
    }
}

private val HUES = listOf(0f, 60f, 120f, 180f, 240f, 300f, 360f).map { Color.hsv(it % 360f, 1f, 1f) }

/** Saturation/brightness pad, hue bar, before/after preview, HEX field and preset swatches. */
@Composable
fun ColorPickerPanel(state: HsvColor, original: String, presets: List<String>) {
    Column {
        // saturation (x) / brightness (y) pad
        var padSize by remember { mutableStateOf(IntSize.Zero) }
        val pad by rememberUpdatedState(padSize)
        fun setSv(o: Offset) {
            if (pad.width == 0 || pad.height == 0) return
            state.sat = (o.x / pad.width).coerceIn(0f, 1f)
            state.value = 1f - (o.y / pad.height).coerceIn(0f, 1f)
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(168.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Brush.horizontalGradient(listOf(Color.White, Color.hsv(state.hue, 1f, 1f))))
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                .onSizeChanged { padSize = it }
                .pointerInput(Unit) { detectTapGestures { setSv(it) } }
                .pointerInput(Unit) { detectDragGestures(onDragStart = { setSv(it) }) { change, _ -> setSv(change.position) } }
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val c = Offset(state.sat * size.width, (1f - state.value) * size.height)
                drawCircle(Color.White, radius = 9.dp.toPx(), center = c, style = Stroke(2.5.dp.toPx()))
                drawCircle(Color.Black.copy(alpha = 0.35f), radius = 10.5.dp.toPx(), center = c, style = Stroke(1.dp.toPx()))
            }
        }
        Spacer(Modifier.height(14.dp))

        // hue bar
        var barSize by remember { mutableStateOf(IntSize.Zero) }
        val bar by rememberUpdatedState(barSize)
        fun setHue(o: Offset) {
            if (bar.width == 0) return
            state.hue = (o.x / bar.width).coerceIn(0f, 1f) * 360f
            if (state.sat < 0.05f) state.sat = 1f          // picking a hue on grey: show that hue
            if (state.value < 0.05f) state.value = 1f
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(24.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Brush.horizontalGradient(HUES))
                .onSizeChanged { barSize = it }
                .pointerInput(Unit) { detectTapGestures { setHue(it) } }
                .pointerInput(Unit) { detectDragGestures(onDragStart = { setHue(it) }) { change, _ -> setHue(change.position) } }
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val x = state.hue / 360f * size.width
                drawCircle(Color.White, radius = size.height / 2f - 1.dp.toPx(), center = Offset(x.coerceIn(size.height / 2f, size.width - size.height / 2f), size.height / 2f), style = Stroke(3.dp.toPx()))
            }
        }
        Spacer(Modifier.height(16.dp))

        // before → after, and the HEX code
        Row(verticalAlignment = Alignment.CenterVertically) {
            val before = runCatching { Color(android.graphics.Color.parseColor(original)) }.getOrDefault(Color.Gray)
            Box(Modifier.size(width = 34.dp, height = 34.dp).clip(RoundedCornerShape(topStart = 10.dp, bottomStart = 10.dp)).background(before))
            Box(Modifier.size(width = 34.dp, height = 34.dp).clip(RoundedCornerShape(topEnd = 10.dp, bottomEnd = 10.dp)).background(state.color))
            Spacer(Modifier.width(12.dp))
            var text by remember(state.hex) { mutableStateOf(state.hex) }
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Cf.Bg)
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("HEX", style = MaterialTheme.typography.labelMedium, color = Cf.TextFaint)
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = text,
                    onValueChange = { v ->
                        text = v
                        val h = if (v.startsWith("#")) v else "#$v"
                        if (h.length == 7) state.setHex(h)
                    },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = Cf.Text, fontFamily = FontFamily.Monospace),
                    cursorBrush = SolidColor(Cf.Accent),
                    modifier = Modifier.weight(1f)
                )
            }
        }
        Spacer(Modifier.height(14.dp))

        // presets
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            presets.forEach { hex ->
                val c = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.Gray)
                val on = state.hex.equals(hex, ignoreCase = true)
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .border(2.dp, if (on) Cf.Accent else Color.Transparent, CircleShape)
                        .padding(3.dp)
                        .clip(CircleShape)
                        .background(c)
                        .border(1.dp, Color.White.copy(alpha = 0.12f), CircleShape)
                        .clickable { state.setHex(hex) }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ColorPickerSheet(
    title: String,
    initialHex: String,
    presets: List<String>,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val state = remember(initialHex) { HsvColor(initialHex) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Cf.Surface
    ) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 16.dp).navigationBarsPadding()) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = Cf.Text)
            Spacer(Modifier.height(14.dp))
            ColorPickerPanel(state, initialHex, presets)
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton("취소", onDismiss, primary = false, modifier = Modifier.weight(1f))
                PillButton("적용", { onPick(state.hex); onDismiss() }, modifier = Modifier.weight(1f))
            }
        }
    }
}
