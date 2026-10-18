package com.cafequest.agent

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The tokens from dashboard/src/styles.css, so the headset and the café PC read
 * as one tool. Colors carry meaning: Ready = connected, Idle = offline.
 */
object CqColors {
    val Board = Color(0xFF0F1620)
    val Bay = Color(0xFF18212C)
    val Raised = Color(0xFF212C39)
    val Rail = Color(0xFF2C3846)
    val Chalk = Color(0xFFE8EEF5)
    val ChalkDim = Color(0xFF8D9AAB)
    val Ready = Color(0xFF58D3D0)
    val Live = Color(0xFFFFB020)
    val Alert = Color(0xFFF25C5C)
    val Idle = Color(0xFF5B6878)
}

fun LinkTone.color(): Color = when (this) {
    LinkTone.READY -> CqColors.Ready
    LinkTone.WAITING -> CqColors.ChalkDim
    LinkTone.OFFLINE -> CqColors.Idle
}

private val CafeQuestColors = darkColorScheme(
    primary = CqColors.Chalk,
    onPrimary = CqColors.Board,
    secondary = CqColors.Ready,
    onSecondary = CqColors.Board,
    background = CqColors.Board,
    onBackground = CqColors.Chalk,
    surface = CqColors.Board,
    onSurface = CqColors.Chalk,
    surfaceVariant = CqColors.Bay,
    onSurfaceVariant = CqColors.ChalkDim,
    // Field borders need 3:1 against the board; Rail is for dividers only.
    outline = CqColors.Idle,
    outlineVariant = CqColors.Rail,
    error = CqColors.Alert,
    onError = CqColors.Board,
)

// A step larger than phone defaults: this panel is read through headset lenses.
private val CafeQuestType = Typography(
    displaySmall = TextStyle(fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp),
    headlineSmall = TextStyle(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.Bold),
    bodyLarge = TextStyle(fontSize = 18.sp, lineHeight = 26.sp, fontFeatureSettings = "tnum"),
    bodyMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontFeatureSettings = "tnum"),
    labelLarge = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
)

@Composable
fun CafeQuestTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = CafeQuestColors, typography = CafeQuestType, content = content)
}
