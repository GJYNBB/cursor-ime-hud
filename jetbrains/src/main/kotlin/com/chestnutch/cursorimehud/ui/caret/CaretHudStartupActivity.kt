package com.chestnutch.cursorimehud.ui.caret

import com.intellij.openapi.application.EDT
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class CaretHudStartupActivity : ProjectActivity {
  override suspend fun execute(project: Project) {
    // start() registers Swing/AWT listeners and walks allEditors, so it must
    // run on EDT instead of the background thread ProjectActivity uses.
    withContext(Dispatchers.EDT) {
      project.service<CaretHudController>().start()
    }
  }
}
