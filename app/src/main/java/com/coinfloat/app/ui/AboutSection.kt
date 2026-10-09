package com.coinfloat.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/** "Open-source licenses" and "Privacy" entries of the about card; texts are plain assets so they can be updated without code. */
@Composable
fun AboutLegalButtons() {
    var dialog by rememberSaveable { mutableStateOf<String?>(null) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { dialog = "licenses" }, modifier = Modifier.weight(1f)) { Text("오픈소스 라이선스") }
        OutlinedButton(onClick = { dialog = "privacy" }, modifier = Modifier.weight(1f)) { Text("개인정보 처리방침") }
    }
    val which = dialog ?: return
    LegalDialog(
        title = if (which == "privacy") "개인정보 처리방침" else "오픈소스 라이선스",
        asset = if (which == "privacy") "privacy.txt" else "licenses.txt",
        onDismiss = { dialog = null }
    )
}

@Composable
private fun LegalDialog(title: String, asset: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val text = remember(asset) {
        runCatching { context.assets.open(asset).bufferedReader().use { it.readText() } }.getOrDefault("문서를 불러오지 못했습니다.")
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(text, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
}
