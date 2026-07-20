package com.chestnutch.cursorimehud.settings

import com.chestnutch.cursorimehud.model.CursorImeHudLabelPreset
import com.chestnutch.cursorimehud.ui.ImeStatusBarWidgetFactory
import com.intellij.openapi.components.service
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.impl.status.widget.StatusBarWidgetsManager
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.JComboBox
import javax.swing.JComponent
import javax.swing.JPanel

class CursorImeHudConfigurable : SearchableConfigurable {
  private val settings = service<CursorImeHudSettings>()
  private var panel: JPanel? = null
  private lateinit var statusBarEnabled: JBCheckBox
  private lateinit var caretHudEnabled: JBCheckBox
  private lateinit var labelPreset: JComboBox<CursorImeHudLabelPreset>
  private lateinit var cnColor: JBTextField
  private lateinit var enColor: JBTextField
  private lateinit var opacity: JBTextField
  private lateinit var offsetX: JBTextField
  private lateinit var offsetY: JBTextField
  private lateinit var hideWhenEditorUnfocused: JBCheckBox

  override fun getId(): String = "cursorImeHud"

  override fun getDisplayName(): String = CursorImeHudBundle.message("settings.displayName")

  override fun createComponent(): JComponent {
    val state = settings.state
    statusBarEnabled = JBCheckBox(CursorImeHudBundle.message("settings.statusBarEnabled"), state.statusBarEnabled)
    caretHudEnabled = JBCheckBox(CursorImeHudBundle.message("settings.caretHudEnabled"), state.caretHudEnabled)
    labelPreset = JComboBox(CursorImeHudLabelPreset.entries.toTypedArray()).also {
      it.selectedItem = CursorImeHudLabelPreset.fromId(state.labelPreset)
    }
    cnColor = JBTextField(state.cnColor)
    enColor = JBTextField(state.enColor)
    opacity = JBTextField(state.opacity.toString())
    offsetX = JBTextField(state.offsetX.toString())
    offsetY = JBTextField(state.offsetY.toString())
    hideWhenEditorUnfocused = JBCheckBox(
      CursorImeHudBundle.message("settings.hideWhenEditorUnfocused"),
      state.hideWhenEditorUnfocused
    )

    panel = JPanel(GridBagLayout()).also { root ->
      var row = 0
      root.add(statusBarEnabled, constraints(row++, 0, 2))
      root.add(caretHudEnabled, constraints(row++, 0, 2))
      root.add(hideWhenEditorUnfocused, constraints(row++, 0, 2))
      addField(root, row++, CursorImeHudBundle.message("settings.labelPreset"), labelPreset)
      addField(root, row++, CursorImeHudBundle.message("settings.cnColor"), cnColor)
      addField(root, row++, CursorImeHudBundle.message("settings.enColor"), enColor)
      root.add(JBLabel(CursorImeHudBundle.message("settings.colorFormatHint")), constraints(row++, 0, 2))
      addField(root, row++, CursorImeHudBundle.message("settings.opacity"), opacity)
      addField(root, row++, CursorImeHudBundle.message("settings.offsetX"), offsetX)
      addField(root, row++, CursorImeHudBundle.message("settings.offsetY"), offsetY)
      root.add(JBLabel(CursorImeHudBundle.message("settings.platformSupportNote")), constraints(row, 0, 2))
    }

    return panel!!
  }

  override fun isModified(): Boolean {
    val state = settings.state
    return statusBarEnabled.isSelected != state.statusBarEnabled ||
      caretHudEnabled.isSelected != state.caretHudEnabled ||
      selectedPreset().id != state.labelPreset ||
      normalizedColor(cnColor.text, CursorImeHudColors.DEFAULT_CN_COLOR) != normalizedColor(state.cnColor, CursorImeHudColors.DEFAULT_CN_COLOR) ||
      normalizedColor(enColor.text, CursorImeHudColors.DEFAULT_EN_COLOR) != normalizedColor(state.enColor, CursorImeHudColors.DEFAULT_EN_COLOR) ||
      opacity.text != state.opacity.toString() ||
      offsetX.text != state.offsetX.toString() ||
      offsetY.text != state.offsetY.toString() ||
      hideWhenEditorUnfocused.isSelected != state.hideWhenEditorUnfocused
  }

  override fun apply() {
    val statusBarAvailabilityChanged = statusBarEnabled.isSelected != settings.state.statusBarEnabled
    settings.update { state ->
      state.statusBarEnabled = statusBarEnabled.isSelected
      state.caretHudEnabled = caretHudEnabled.isSelected
      state.labelPreset = selectedPreset().id
      state.cnColor = normalizedColor(cnColor.text, CursorImeHudColors.DEFAULT_CN_COLOR)
      state.enColor = normalizedColor(enColor.text, CursorImeHudColors.DEFAULT_EN_COLOR)
      state.opacity = opacity.text.toDoubleOrNull()?.coerceIn(0.15, 1.0) ?: 0.78
      state.offsetX = offsetX.text.toIntOrNull()?.coerceIn(-50, 50) ?: 6
      state.offsetY = offsetY.text.toIntOrNull()?.coerceIn(-50, 50) ?: 20
      state.hideWhenEditorUnfocused = hideWhenEditorUnfocused.isSelected
    }
    reset()
    settings.publishChanged()
    if (statusBarAvailabilityChanged) {
      refreshStatusBarWidgetAvailability()
    }
  }

  override fun reset() {
    val state = settings.state
    statusBarEnabled.isSelected = state.statusBarEnabled
    caretHudEnabled.isSelected = state.caretHudEnabled
    labelPreset.selectedItem = CursorImeHudLabelPreset.fromId(state.labelPreset)
    cnColor.text = normalizedColor(state.cnColor, CursorImeHudColors.DEFAULT_CN_COLOR)
    enColor.text = normalizedColor(state.enColor, CursorImeHudColors.DEFAULT_EN_COLOR)
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

  private fun selectedPreset(): CursorImeHudLabelPreset = labelPreset.selectedItem as? CursorImeHudLabelPreset
    ?: CursorImeHudLabelPreset.ZH_EN

  private fun normalizedColor(value: String, fallback: String): String = CursorImeHudColors.normalizeHex(value, fallback)

  private fun refreshStatusBarWidgetAvailability() {
    ProjectManager.getInstance().openProjects.forEach { project ->
      project.service<StatusBarWidgetsManager>().updateWidget(ImeStatusBarWidgetFactory::class.java)
    }
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
