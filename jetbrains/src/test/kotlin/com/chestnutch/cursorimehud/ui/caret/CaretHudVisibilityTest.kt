package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.service.HudDisplayStateResolver
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaretHudVisibilityTest {
  @Test
  fun showsChineseAndEnglishLabelsByDefault() {
    val settings = CursorImeHudSettings.State()

    val cn = CaretHudVisibility.resolve(ImeSnapshot(ImeState.CN), settings, editorAvailable = true, editorFocused = true)
    val en = CaretHudVisibility.resolve(ImeSnapshot(ImeState.EN), settings, editorAvailable = true, editorFocused = true)

    assertTrue(cn.visible)
    assertEquals("中", cn.label)
    assertTrue(en.visible)
    assertEquals("英", en.label)
  }

  @Test
  fun usesLatinLabelsWhenPresetChanges() {
    val settings = CursorImeHudSettings.State(labelPreset = "en-zh")

    val cn = CaretHudVisibility.resolve(ImeSnapshot(ImeState.CN), settings, editorAvailable = true, editorFocused = true)
    val en = CaretHudVisibility.resolve(ImeSnapshot(ImeState.EN), settings, editorAvailable = true, editorFocused = true)

    assertTrue(cn.visible)
    assertEquals("ZH", cn.label)
    assertTrue(en.visible)
    assertEquals("EN", en.label)
  }

  @Test
  fun fallsBackToChineseLabelsForLegacyCustomPreset() {
    val settings = CursorImeHudSettings.State(labelPreset = "custom")

    val cn = CaretHudVisibility.resolve(ImeSnapshot(ImeState.CN), settings, editorAvailable = true, editorFocused = true)
    val en = CaretHudVisibility.resolve(ImeSnapshot(ImeState.EN), settings, editorAvailable = true, editorFocused = true)

    assertEquals("中", cn.label)
    assertEquals("英", en.label)
  }

  @Test
  fun hidesWhenDisabledUnknownOrEditorUnavailable() {
    assertFalse(
      CaretHudVisibility.resolve(
        ImeSnapshot(ImeState.CN),
        CursorImeHudSettings.State(caretHudEnabled = false),
        editorAvailable = true,
        editorFocused = true
      ).visible
    )
    assertFalse(
      CaretHudVisibility.resolve(
        ImeSnapshot(ImeState.UNKNOWN),
        CursorImeHudSettings.State(),
        editorAvailable = true,
        editorFocused = true
      ).visible
    )
    assertFalse(
      CaretHudVisibility.resolve(
        ImeSnapshot(ImeState.CN),
        CursorImeHudSettings.State(),
        editorAvailable = false,
        editorFocused = true
      ).visible
    )
  }

  @Test
  fun usesDisplaySnapshotDuringUnknownGracePeriod() {
    val displayState = HudDisplayStateResolver.resolve(
      detectedSnapshot = ImeSnapshot(ImeState.UNKNOWN),
      lastStableSnapshot = ImeSnapshot(ImeState.CN),
      unknownObservedAtMillis = 1_000,
      nowMillis = 1_499
    )

    val state = CaretHudVisibility.resolve(
      displayState,
      CursorImeHudSettings.State(),
      editorAvailable = true,
      editorFocused = true
    )

    assertTrue(state.visible)
    assertEquals("中", state.label)
    assertEquals(ImeState.CN, state.snapshot?.state)
  }

  @Test
  fun hidesUnknownAfterGracePeriod() {
    val displayState = HudDisplayStateResolver.resolve(
      detectedSnapshot = ImeSnapshot(ImeState.UNKNOWN),
      lastStableSnapshot = ImeSnapshot(ImeState.EN),
      unknownObservedAtMillis = 1_000,
      nowMillis = 1_500
    )

    val state = CaretHudVisibility.resolve(
      displayState,
      CursorImeHudSettings.State(),
      editorAvailable = true,
      editorFocused = true
    )

    assertFalse(state.visible)
    assertEquals("no-display-label", state.hiddenReason)
  }

  @Test
  fun respectsEditorFocusSetting() {
    assertFalse(
      CaretHudVisibility.resolve(
        ImeSnapshot(ImeState.CN),
        CursorImeHudSettings.State(hideWhenEditorUnfocused = true),
        editorAvailable = true,
        editorFocused = false
      ).visible
    )
    assertTrue(
      CaretHudVisibility.resolve(
        ImeSnapshot(ImeState.CN),
        CursorImeHudSettings.State(hideWhenEditorUnfocused = false),
        editorAvailable = true,
        editorFocused = false
      ).visible
    )
  }
}
