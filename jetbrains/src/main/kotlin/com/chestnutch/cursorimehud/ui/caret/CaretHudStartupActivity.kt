package com.chestnutch.cursorimehud.ui.caret

import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.StartupActivity

class CaretHudStartupActivity : StartupActivity.DumbAware {
  override fun runActivity(project: Project) {
    project.service<CaretHudController>().start()
  }
}
