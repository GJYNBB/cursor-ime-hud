import * as assert from "node:assert";
import { parseLogLine, parseSnapshotLine } from "../../detector/helperProtocol";

suite("helperProtocol", () => {
  test("parses helper snapshot lines with diagnostics fields", () => {
    const snapshot = parseSnapshotLine(
      JSON.stringify({
        type: "state",
        state: "unknown",
        timestamp: "2026-04-23T00:00:00.000Z",
        imeName: "Test IME",
        isOpen: true,
        layoutHex: "0x409",
        threadId: 1,
        hwnd: "0x123",
        reason: "open-non-chinese-layout-conflict",
        confidence: 0.25,
        rawStateAvailable: true
      })
    );

    assert.ok(snapshot);
    assert.equal(snapshot?.state, "unknown");
    assert.equal(snapshot?.reason, "open-non-chinese-layout-conflict");
    assert.equal(snapshot?.confidence, 0.25);
    assert.equal(snapshot?.rawStateAvailable, true);
  });

  test("returns undefined for invalid helper lines", () => {
    assert.equal(parseSnapshotLine("not json"), undefined);
    assert.equal(parseLogLine("still not json"), undefined);
  });

  test("parses helper log lines", () => {
    const entry = parseLogLine(
      JSON.stringify({
        type: "log",
        level: "warn",
        timestamp: "2026-04-23T00:00:00.000Z",
        message: "test warning",
        source: "native-helper"
      })
    );

    assert.ok(entry);
    assert.equal(entry?.level, "warn");
    assert.equal(entry?.message, "test warning");
  });
});
