package com.chestnutch.cursorimehud.ui;

import com.chestnutch.cursorimehud.action.ShowDiagnosticsAction;
import com.chestnutch.cursorimehud.action.ToggleCaretHudAction;
import com.chestnutch.cursorimehud.service.ImeHudService;
import com.chestnutch.cursorimehud.settings.CursorImeHudConfigurable;
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings;
import com.chestnutch.cursorimehud.settings.CursorImeHudSettingsListener;
import com.intellij.ide.DataManager;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.actionSystem.DataContext;
import com.intellij.openapi.actionSystem.DefaultActionGroup;
import com.intellij.openapi.actionSystem.Presentation;
import com.intellij.openapi.actionSystem.Separator;
import com.intellij.openapi.actionSystem.Toggleable;
import com.intellij.openapi.actionSystem.impl.SimpleDataContext;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.options.ShowSettingsUtil;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.ui.popup.ListPopup;
import com.intellij.openapi.wm.CustomStatusBarWidget;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.ui.awt.RelativePoint;
import com.intellij.ui.components.JBLabel;
import com.intellij.util.messages.MessageBusConnection;
import java.awt.Component;
import java.awt.Point;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import javax.swing.JComponent;
import org.jetbrains.annotations.NotNull;

public final class ImeStatusBarWidget implements CustomStatusBarWidget, ImeHudService.Listener {
  private static final String SERVICE_CONSUMER_ID = "status-bar";

  private final Project project;
  private final ImeHudService service;
  private final JBLabel component;
  private StatusBar statusBar;
  private MessageBusConnection settingsConnection;

  public ImeStatusBarWidget(@NotNull Project project) {
    this.project = project;
    service = project.getService(ImeHudService.class);
    component = new JBLabel();
    component.setAlignmentX(Component.CENTER_ALIGNMENT);
    component.addMouseListener(new MouseAdapter() {
      @Override
      public void mouseClicked(MouseEvent event) {
        if (event.getButton() == MouseEvent.BUTTON1) {
          showStatusPopup();
        }
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
    service.acquireConsumer(SERVICE_CONSUMER_ID);
  }

  @Override
  public void dispose() {
    if (settingsConnection != null) {
      settingsConnection.disconnect();
      settingsConnection = null;
    }
    service.removeListener(this);
    service.releaseConsumer(SERVICE_CONSUMER_ID);
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

  private void showStatusPopup() {
    if (project.isDisposed()) {
      return;
    }

    DefaultActionGroup group = new DefaultActionGroup();
    group.add(new StatusSummaryAction(service.statusSummaryLine()));
    group.add(Separator.getInstance());
    group.add(new ToggleCaretHudMenuAction());
    group.add(Separator.getInstance());
    group.add(new DumbAwareAction("刷新输入法状态") {
      @Override
      public void actionPerformed(@NotNull AnActionEvent e) {
        service.refresh();
      }
    });
    group.add(new DumbAwareAction("显示诊断信息") {
      @Override
      public void actionPerformed(@NotNull AnActionEvent e) {
        new ShowDiagnosticsAction().actionPerformed(e);
      }
    });
    group.add(new DumbAwareAction("打开插件设置…") {
      @Override
      public void actionPerformed(@NotNull AnActionEvent e) {
        ShowSettingsUtil.getInstance().showSettingsDialog(project, CursorImeHudConfigurable.class);
      }
    });

    DataContext parent = DataManager.getInstance().getDataContext(component);
    DataContext dataContext = SimpleDataContext.builder()
      .setParent(parent)
      .add(CommonDataKeys.PROJECT, project)
      .build();

    ListPopup popup = JBPopupFactory.getInstance().createActionGroupPopup(
      "输入法状态",
      group,
      dataContext,
      JBPopupFactory.ActionSelectionAid.SPEEDSEARCH,
      true
    );
    popup.show(new RelativePoint(component, new Point(0, 0)));
  }

  /** Non-action row that only shows the current IME summary. */
  private static final class StatusSummaryAction extends AnAction {
    private StatusSummaryAction(String text) {
      super(text);
      getTemplatePresentation().setEnabled(false);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
      // no-op summary row
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
      e.getPresentation().setEnabled(false);
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
      return ActionUpdateThread.EDT;
    }
  }

  /**
   * Menu row that reuses {@link ToggleCaretHudAction} for the flip, while
   * showing a checkmark for the current caret-HUD enabled state.
   */
  private static final class ToggleCaretHudMenuAction extends DumbAwareAction {
    private final ToggleCaretHudAction delegate = new ToggleCaretHudAction();

    private ToggleCaretHudMenuAction() {
      super("点击开关光标旁图标");
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
      Presentation presentation = e.getPresentation();
      presentation.setEnabled(true);
      boolean enabled = ApplicationManager.getApplication()
        .getService(CursorImeHudSettings.class)
        .getState()
        .getCaretHudEnabled();
      presentation.setText(enabled ? "关闭光标旁图标" : "开启光标旁图标");
      presentation.setDescription("立即开关编辑器光标旁的输入法图标");
      Toggleable.setSelected(presentation, enabled);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
      delegate.actionPerformed(e);
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
      return ActionUpdateThread.EDT;
    }
  }
}
