package com.coinfloat.app.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.ui.components.Caption
import com.coinfloat.app.ui.components.CoinAvatar
import com.coinfloat.app.ui.components.Group
import com.coinfloat.app.ui.components.GroupDivider
import com.coinfloat.app.ui.components.ListRow
import com.coinfloat.app.ui.components.ScreenHeader
import com.coinfloat.app.ui.components.SectionLabel
import com.coinfloat.app.ui.theme.Cf

@Composable
fun SymbolsContent(
    selectedSymbols: List<String>,
    searchQuery: String,
    searchResults: List<SymbolInfo>,
    isLoadingSymbols: Boolean,
    symbolInfo: Map<String, SymbolInfo>,
    onSearchQueryChange: (String) -> Unit,
    onAddSymbol: (String) -> Unit,
    onRemoveSymbol: (String) -> Unit,
    onMoveUp: (String) -> Unit,
    onMoveDown: (String) -> Unit
) {
    Column {
        ScreenHeader("종목")
        SearchField(searchQuery, onSearchQueryChange)

        if (searchQuery.isNotBlank()) {
            SectionLabel(if (searchResults.isEmpty()) "검색 결과" else "검색 결과 ${searchResults.size}")
            when {
                isLoadingSymbols -> Group {
                    Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = Cf.Accent, strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("거래소 종목 정보를 불러오는 중…", style = MaterialTheme.typography.bodyMedium, color = Cf.TextMuted)
                    }
                }
                searchResults.isEmpty() -> Caption("'$searchQuery'와 일치하는 Binance 선물 종목이 없어요.")
                else -> Group {
                    searchResults.take(30).forEachIndexed { i, info ->
                        val added = selectedSymbols.contains(info.symbol)
                        ListRow(
                            title = info.baseAsset,
                            subtitle = "${info.symbol} · 무기한",
                            onClick = if (added) null else ({ onAddSymbol(info.symbol) }),
                            leading = { CoinAvatar(info.baseAsset) },
                            trailing = {
                                if (added) {
                                    Icon(Icons.Default.Check, contentDescription = "추가됨", tint = Cf.TextMuted, modifier = Modifier.size(20.dp))
                                } else {
                                    Box(
                                        Modifier.size(30.dp).clip(CircleShape).background(Cf.AccentSoft),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(Icons.Default.Add, contentDescription = "추가", tint = Cf.Accent, modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        )
                        if (i < minOf(searchResults.size, 30) - 1) GroupDivider(startInset = 64)
                    }
                }
            }
        } else {
            SectionLabel("내 종목 ${selectedSymbols.size}")
            Group {
                selectedSymbols.forEachIndexed { index, symbol ->
                    val info = symbolInfo[symbol.uppercase()]
                    val base = info?.baseAsset ?: symbol.removeSuffix("USDT")
                    ListRow(
                        title = base,
                        subtitle = symbol,
                        leading = { CoinAvatar(base) },
                        trailing = {
                            SmallIcon(Icons.Default.KeyboardArrowUp, "위로", index > 0) { onMoveUp(symbol) }
                            SmallIcon(Icons.Default.KeyboardArrowDown, "아래로", index < selectedSymbols.size - 1) { onMoveDown(symbol) }
                            SmallIcon(Icons.Default.Close, "삭제", selectedSymbols.size > 1) { onRemoveSymbol(symbol) }
                        }
                    )
                    if (index < selectedSymbols.size - 1) GroupDivider(startInset = 64)
                }
            }
            Caption("시세창에 이 순서대로 표시돼요. 최소 1개는 남겨 두어야 해요.")
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SmallIcon(icon: ImageVector, description: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(36.dp)) {
        Icon(icon, contentDescription = description, tint = if (enabled) Cf.TextMuted else Cf.Line, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit) {
    Row(
        modifier = Modifier
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .fillMaxWidth()
            .height(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Cf.Surface)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Default.Search, contentDescription = null, tint = Cf.TextMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) {
                Text("종목 검색 (예: SOL, XRP)", style = MaterialTheme.typography.bodyLarge, color = Cf.TextFaint)
            }
            BasicTextField(
                value = query,
                onValueChange = onChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = Cf.Text),
                cursorBrush = SolidColor(Cf.Accent),
                modifier = Modifier.fillMaxWidth()
            )
        }
        if (query.isNotEmpty()) {
            IconButton(onClick = { onChange("") }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.Close, contentDescription = "지우기", tint = Cf.TextMuted, modifier = Modifier.size(18.dp))
            }
        }
    }
}
