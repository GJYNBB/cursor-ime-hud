package com.chestnutch.cursorimehud.ui.caret

data class CaretHudRenderState(
  val editorIdentity: Int,
  val label: String,
  val opacity: Double,
  val x: Int,
  val y: Int,
  val width: Int,
  val height: Int
)
