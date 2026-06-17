package com.chestnutch.cursorimehud.ui;

import com.chestnutch.cursorimehud.service.ImeHudService;
import com.chestnutch.cursorimehud.settings.CursorImeHudSettingsListener;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.CustomStatusBarWidget;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.messages.MessageBusConnection;
import java.awt.Component;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import javax.swing.JComponent;
import org.jetbrains.annotations.NotNull;

public final class ImeStatusBarWidget implements CustomStatusBarWidget, ImeHudService.Listener {
  private final ImeHudService service;
  private final JBLabel component;
  private StatusBar statusBar;
  private MessageBusConnection settingsConnection;

  public ImeStatusBarWidget(@NotNull Project project) {
    service = project.getService(ImeHudService.class);
    component = new JBLabel();
    component.setAlignmentX(Component.CENTER_ALIGNMENT);
    component.addMouseListener(new MouseAdapter() {
      @Override
      public void mouseClicked(MouseEvent event) {
        service.refresh();
      }
    });
  }

  @Override
  public @NotNull String ID() {
    return "CursorImeHudStatusBar";
  }

  @Override
  public void install(@NotNull StatusBar statusBar) {
    this.statusBar = statusBar;
    updateComponent();
    service.addListener(this);
    settingsConnection = ApplicationManager.getApplication().getMessageBus().connect();
    settingsConnection.subscribe(CursorImeHudSettingsListener.Companion.getTOPIC(), new CursorImeHudSettingsListener() {
      @Override
      public void settingsChanged() {
        updateComponent();
        statusBar.updateWidget(ID());
      }
    });
    service.start();
  }

  @Override
  public void dispose() {
    if (settingsConnection != null) {
      settingsConnection.disconnect();
      settingsConnection = null;
    }
    service.removeListener(this);
    statusBar = null;
  }

  @Override
  public @NotNull JComponent getComponent() {
    return component;
  }

  @Override
  public void onImeHudChanged() {
    updateComponent();
    if (statusBar != null) {
      statusBar.updateWidget(ID());
    }
  }

  private void updateComponent() {
    component.setText(service.displayText());
    component.setToolTipText(service.tooltipText());
  }
}
