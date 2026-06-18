import { DetectorLogEntry, ImeDetectorDebugInfo, ImeSnapshot } from "../model/types";
import { Disposable, Event } from "../model/events";

export interface ImeDetector extends Disposable {
  readonly onDidChangeSnapshot: Event<ImeSnapshot>;
  readonly onDidLog: Event<DetectorLogEntry>;

  start(): Promise<void>;
  refresh(): void;

  /**
   * Optional lifecycle hook allowing the controller to suspend native
   * processes without fully disposing the detector instance.
   */
  stop?(): void;

  getSnapshot(): ImeSnapshot;
  getDebugInfo(): ImeDetectorDebugInfo;
}
