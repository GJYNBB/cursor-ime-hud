import * as assert from "node:assert";
import { parseHelloLine, parseLogLine, parseSnapshotLine } from "../../detector/helperProtocol";

suite("helperProtocol", () => {
  test("parses helper snapshot lines with diagnostics fields", () => {
    const snapshot = parseSnapshotLine(
      JSON.stringify({
        type: "state",
        state: "unknown",
        timestamp: "2026-04-23T00:00:00.000Z",
        imeName: "Test IME",
        isOpen: true,
        layoutHex: "0409",
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
    assert.equal(parseHelloLine("totally bogus"), undefined);
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

  test("rejects invalid helper state values", () => {
    const snapshot = parseSnapshotLine(
      JSON.stringify({
        type: "state",
        state: "japanese",
        timestamp: "2026-04-23T00:00:00.000Z"
      })
    );

    assert.equal(snapshot, undefined, "non-{cn,en,unknown} states are rejected");
  });

  test('coerces an unknown log level to "info"', () => {
    const entry = parseLogLine(
      JSON.stringify({
        type: "log",
        level: "debug",
        timestamp: "2026-04-23T00:00:00.000Z",
        message: "verbose"
      })
    );

    assert.ok(entry);
    assert.equal(entry?.level, "info", "non-{warn,error} levels coerce to info");
  });

  test("returns undefined when required snapshot fields are missing", () => {
    // `type` is required and must be the literal "state".
    const wrongType = parseSnapshotLine(
      JSON.stringify({
        type: "log",
        state: "cn"
      })
    );
    assert.equal(wrongType, undefined, "type must be 'state'");

    // An empty object has no `type` -> reject.
    const empty = parseSnapshotLine(JSON.stringify({}));
    assert.equal(empty, undefined, "missing type is rejected");

    const noState = parseSnapshotLine(
      JSON.stringify({
        type: "state"
      })
    );
    assert.equal(noState, undefined, "missing state is rejected");
  });

  test("returns undefined for log lines missing the required message field", () => {
    const noMessage = parseLogLine(
      JSON.stringify({
        type: "log",
        level: "warn"
      })
    );
    assert.equal(noMessage, undefined, "log line without message is rejected");
  });

  test("parses hello messages and surfaces a version mismatch", () => {
    const hello = parseHelloLine(
      JSON.stringify({
        type: "hello",
        version: 1,
        capabilities: ["state", "log"]
      })
    );

    assert.ok(hello);
    assert.equal(hello?.version, 1);
    assert.deepEqual(hello?.capabilities, ["state", "log"]);

    // Version mismatch: the wrapper is built against protocol version 1
    // (see `PROTOCOL_VERSION` in `helperProtocol.ts`). A helper that
    // speaks a different version must still parse cleanly so the
    // controller can detect the mismatch and log it.
    const future = parseHelloLine(
      JSON.stringify({
        type: "hello",
        version: 99,
        capabilities: []
      })
    );
    assert.ok(future);
    assert.notEqual(future?.version, 1, "future version surfaces as a different version");

    // Non-numeric version is rejected so we never accidentally treat
    // a malformed line as a successful handshake.
    const malformed = parseHelloLine(
      JSON.stringify({
        type: "hello",
        version: "v1",
        capabilities: []
      })
    );
    assert.equal(malformed, undefined, "non-numeric version is rejected");
  });
});
