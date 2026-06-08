package com.chestnutch.cursorimehud.settings

import com.intellij.openapi.components.service
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.JComponent
import javax.swing.JPanel

class CursorImeHudConfigurable : SearchableConfigurable {
  private val settings = service<CursorImeHudSettings>()
  private var panel: JPanel? = null
  private lateinit var statusBarEnabled: JBCheckBox
  private lateinit var caretHudEnabled: JBCheckBox
  private lateinit var cnLabel: JBTextField
  private lateinit var enLabel: JBTextField
  private lateinit var opacity: JBTextField
  private lateinit var offsetX: JBTextField
  private lateinit var offsetY: JBTextField
  private lateinit var hideWhenEditorUnfocused: JBCheckBox

  override fun getId(): String = "cursorImeHud"

  override fun getDisplayName(): String = "Cursor IME HUD"

  override fun createComponent(): JComponent {
    val state = settings.state
    statusBarEnabled = JBCheckBox("Show IME state in the status bar", state.statusBarEnabled)
    caretHudEnabled = JBCheckBox("Enable caret-adjacent HUD setting (experimental in JetBrains MVP)", state.caretHudEnabled)
    cnLabel = JBTextField(state.cnLabel)
    enLabel = JBTextField(state.enLabel)
    opacity = JBTextField(state.opacity.toString())
    offsetX = JBTextField(state.offsetX.toString())
    offsetY = JBTextField(state.offsetY.toString())
    hideWhenEditorUnfocused = JBCheckBox("Hide caret HUD when editor is unfocused", state.hideWhenEditorUnfocused)

    panel = JPanel(GridBagLayout()).also { root ->
      var row = 0
      root.add(statusBarEnabled, constraints(row++, 0, 2))
      root.add(caretHudEnabled, constraints(row++, 0, 2))
      root.add(hideWhenEditorUnfocused, constraints(row++, 0, 2))
      addField(root, row++, "Chinese label", cnLabel)
      addField(root, row++, "English label", enLabel)
      addField(root, row++, "Opacity", opacity)
      addField(root, row++, "Offset X", offsetX)
      addField(root, row++, "Offset Y", offsetY)
      root.add(JBLabel("Windows-only MVP: macOS/Linux helper support is not included yet."), constraints(row, 0, 2))
    }

    return panel!!
  }

  override fun isModified(): Boolean {
    val state = settings.state
    return statusBarEnabled.isSelected != state.statusBarEnabled ||
      caretHudEnabled.isSelected != state.caretHudEnabled ||
      cnLabel.text != state.cnLabel ||
      enLabel.text != state.enLabel ||
      opacity.text != state.opacity.toString() ||
      offsetX.text != state.offsetX.toString() ||
      offsetY.text != state.offsetY.toString() ||
      hideWhenEditorUnfocused.isSelected != state.hideWhenEditorUnfocused
  }

  override fun apply() {
    settings.update { state ->
      state.statusBarEnabled = statusBarEnabled.isSelected
      state.caretHudEnabled = caretHudEnabled.isSelected
      state.cnLabel = cnLabel.text.ifBlank { "中" }
      state.enLabel = enLabel.text.ifBlank { "英" }
      state.opacity = opacity.text.toDoubleOrNull()?.coerceIn(0.15, 1.0) ?: 0.78
      state.offsetX = offsetX.text.toIntOrNull()?.coerceIn(0, 32) ?: 6
      state.offsetY = offsetY.text.toIntOrNull()?.coerceIn(-16, 16) ?: 0
      state.hideWhenEditorUnfocused = hideWhenEditorUnfocused.isSelected
    }
  }

  override fun reset() {
    val state = settings.state
    statusBarEnabled.isSelected = state.statusBarEnabled
    caretHudEnabled.isSelected = state.caretHudEnabled
    cnLabel.text = state.cnLabel
    enLabel.text = state.enLabel
    opacity.text = state.opacity.toString()
    offsetX.text = state.offsetX.toString()
    offsetY.text = state.offsetY.toString()
    hideWhenEditorUnfocused.isSelected = state.hideWhenEditorUnfocused
  }

  override fun disposeUIResources() {
    panel = null
  }

  private fun addField(root: JPanel, row: Int, label: String, field: JComponent) {
    root.add(JBLabel(label), constraints(row, 0, 1))
    root.add(field, constraints(row, 1, 1, fill = GridBagConstraints.HORIZONTAL, weightX = 1.0))
  }

  private fun constraints(
    row: Int,
    column: Int,
    width: Int,
    fill: Int = GridBagConstraints.NONE,
    weightX: Double = 0.0
  ): GridBagConstraints = GridBagConstraints().apply {
    gridx = column
    gridy = row
    gridwidth = width
    anchor = GridBagConstraints.WEST
    this.fill = fill
    this.weightx = weightX
    insets.set(4, 4, 4, 4)
  }
}
