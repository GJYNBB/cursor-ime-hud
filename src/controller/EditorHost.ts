import * as vscode from "vscode";

/**
 * Minimal snapshot of the workbench window state. Mirrors the subset of
 * `vscode.window.state` the controller needs so the controller does not have
 * to depend on the global `vscode` namespace directly.
 */
export interface WindowState {
  /** True when the workbench window currently has keyboard focus. */
  focused: boolean;
}

/**
 * Narrow abstraction over the parts of the VS Code workbench that the
 * `HudController` reads. Splitting this out lets the controller be unit
 * tested with a fake `EditorHost` (no Extension Host required) and decouples
 * it from `vscode.window` so a future alternative workbench (e.g. a web
 * playground) can plug in a different implementation.
 */
export interface EditorHost extends vscode.Disposable {
  /** The text editor the user is currently editing, or `undefined`. */
  getActiveEditor(): vscode.TextEditor | undefined;
  /** The current focused/unfocused state of the workbench window. */
  getWindowState(): WindowState;

  /**
   * Fires when the active text editor changes (focus moves between editors
   * or the user closes the active editor). Subscribers should treat this
   * as an immediate render trigger.
   */
  readonly onDidChangeActiveTextEditor: vscode.Event<vscode.TextEditor | undefined>;
  /**
   * Fires when the workbench window gains or loses focus. Subscribers should
   * treat this as an immediate render trigger so the HUD hides itself when
   * the user alt-tabs away.
   */
  readonly onDidChangeWindowState: vscode.Event<WindowState>;
  /**
   * Fires when the selection inside any visible text editor changes.
   * Subscribers should debounce this because selection changes can fire
   * dozens of times per second while the user navigates with the keyboard.
   */
  readonly onDidChangeTextEditorSelection: vscode.Event<vscode.TextEditorSelectionChangeEvent>;
  /**
   * Fires when the visible ranges of any text editor change (e.g. after
   * scrolling). Subscribers should debounce this just like selection
   * changes.
   */
  readonly onDidChangeTextEditorVisibleRanges: vscode.Event<vscode.TextEditorVisibleRangesChangeEvent>;
}

/**
 * Concrete `EditorHost` backed by the real `vscode.window` singletons. This
 * is the only implementation that should be used in production; tests should
 * provide their own fake that satisfies `EditorHost`.
 */
export class VSCodeEditorHost implements EditorHost {
  public getActiveEditor(): vscode.TextEditor | undefined {
    return vscode.window.activeTextEditor;
  }

  public getWindowState(): WindowState {
    return { focused: vscode.window.state.focused };
  }

  public get onDidChangeActiveTextEditor(): vscode.Event<vscode.TextEditor | undefined> {
    return vscode.window.onDidChangeActiveTextEditor;
  }

  public get onDidChangeWindowState(): vscode.Event<WindowState> {
    // Adapt the raw vscode WindowState into our narrowed shape so listeners
    // do not have to depend on the global namespace themselves.
    return (listener) => {
      const subscription = vscode.window.onDidChangeWindowState((state) =>
        listener({ focused: state.focused })
      );
      return { dispose: () => subscription.dispose() };
    };
  }

  public get onDidChangeTextEditorSelection(): vscode.Event<vscode.TextEditorSelectionChangeEvent> {
    return vscode.window.onDidChangeTextEditorSelection;
  }

  public get onDidChangeTextEditorVisibleRanges(): vscode.Event<vscode.TextEditorVisibleRangesChangeEvent> {
    return vscode.window.onDidChangeTextEditorVisibleRanges;
  }

  public dispose(): void {
    // The host does not own the underlying vscode singletons, so it has
    // nothing to release. Each consumer subscribes via the event accessors
    // above and disposes its own subscription; the host itself is a thin
    // facade over the workbench APIs.
  }
}
