import assert from "node:assert/strict";
import test from "node:test";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import { createRustCompilationSession } from "../../dist/compilation/session.js";
import { formatRustCompileResult } from "../../dist/toolchain/rustfmt.js";
import { fakeCompileInput } from "../helpers/fake-compile-input.mjs";

const warning = Object.freeze({ code: "FORMAT_OWNER_WARNING", category: "warning", message: "An earlier stage warning." });
const source = Object.freeze({ kind: "source", language: "rust", path: "src/lib.rs", text: "pub fn value()->i32{1}\n" });
const project = Object.freeze({ kind: "project", path: "Cargo.toml", text: "[workspace]\n" });

test("the Rust session hands the exact raw result and configured edition to its formatter once", () => {
  for (const edition of ["2021", "2024"]) {
    const raw = resolvedTargetStage(Object.freeze({ artifacts: Object.freeze([project, source]) }), [warning]);
    let backendCalls = 0;
    let formattingCalls = 0;
    let input;
    const session = createRustCompilationSession(context(edition), (received, receivedEdition) => {
      formattingCalls++;
      assert.equal(received === raw, true, "the callback receives the exact backend result");
      assert.equal(receivedEdition, edition);
      return formatRustCompileResult(received, receivedEdition);
    }, request => {
      backendCalls++;
      assert.equal(request.input === input, true, "the backend receives the exact compile input");
      assert.equal(request.configuration.edition, edition);
      return raw;
    });
    input = fakeCompileInput();
    try {
      assert.throws(() => session.compile(input), /expected 'runtime-contributed'/u);
      assert.equal(backendCalls, 0);
      assert.equal(formattingCalls, 0);
      prepare(session);
      const result = session.compile(input);
      assert.equal(backendCalls, 1);
      assert.equal(formattingCalls, 1);
      assert.equal(result.kind, "resolved");
      assert.equal(result === raw, false, "formatting creates the final result");
      assert.equal(result.value.artifacts === raw.value.artifacts, false);
      assert.equal(result.value.artifacts[0] === project, true, "non-Rust artifact identity is unchanged");
      assert.equal(result.value.artifacts[1].text, "pub fn value() -> i32 {\n    1\n}\n");
      assert.equal(result.diagnostics[0] === warning, true, "the original warning is retained");
      assert.throws(() => session.compile(input), /while in 'compiled'/u);
      assert.equal(backendCalls, 1);
      assert.equal(formattingCalls, 1);
    } finally {
      session.close();
      session.close();
    }
    assert.throws(() => session.compile(input), /while in 'closed'/u);
  }
});

test("rejected and non-Rust results bypass formatting without losing result identity", () => {
  const rejection = Object.freeze({ code: "SOURCE_REJECTED", category: "error", message: "Rejected before formatting." });
  const rejected = rejectedTargetStage([warning, rejection]);
  const noRust = resolvedTargetStage(Object.freeze({ artifacts: Object.freeze([project]) }), [warning]);
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-session-formatter";
  try {
    for (const raw of [rejected, noRust]) {
      let formattingCalls = 0;
      const session = createRustCompilationSession(context("2024"), (result, edition) => {
        formattingCalls++;
        assert.equal(result === raw, true);
        return formatRustCompileResult(result, edition);
      }, () => raw);
      try {
        prepare(session);
        assert.equal(session.compile(fakeCompileInput()) === raw, true);
        assert.equal(formattingCalls, 1, "the mandatory boundary is invoked once without spawning rustfmt");
      } finally {
        session.close();
      }
    }
  } finally {
    restoreFormatter(previous);
  }
});

test("formatting failure retains preceding warnings and returns no partial output", () => {
  const raw = resolvedTargetStage(Object.freeze({ artifacts: Object.freeze([project, source]) }), [warning]);
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-session-formatter";
  try {
    const result = formatRustCompileResult(raw, "2024");
    assert.equal(result.kind, "rejected");
    assert.equal(Object.hasOwn(result, "value"), false);
    assert.equal(result.diagnostics[0] === warning, true);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["FORMAT_OWNER_WARNING", "RUST_SOURCE_FORMATTING_FAILED"]);
    const diagnostic = result.diagnostics[1];
    assert.equal(diagnostic.category, "error");
    assert.equal(diagnostic.source, "tsonic-rust");
    assert.match(diagnostic.message, /Unable to execute Rust formatter/u);
    assert.deepEqual(diagnostic.evidence, ["target.capability=rust.toolchain.rustfmt"]);
    assert.equal(raw.value.artifacts[0] === project, true);
    assert.equal(raw.value.artifacts[1] === source, true);
    assert.equal(source.text, "pub fn value()->i32{1}\n");
    assert.equal(Object.isFrozen(result.diagnostics), true);
  } finally {
    restoreFormatter(previous);
  }
});

test("unknown formatter failures propagate unchanged rather than becoming source diagnostics", () => {
  const failure = new Error("Unexpected formatter input failure.");
  const raw = resolvedTargetStage({ get artifacts() { throw failure; } });
  assert.throws(() => formatRustCompileResult(raw, "2024"), error => error === failure);
});

test("backend and callback exceptions consume the session once and remain the identical exception", () => {
  for (const stage of ["backend", "formatter"]) {
    const failure = new Error(`${stage} failed`);
    let backendCalls = 0;
    let formatterCalls = 0;
    const session = createRustCompilationSession(context("2024"), result => {
      formatterCalls++;
      if (stage === "formatter") throw failure;
      return result;
    }, () => {
      backendCalls++;
      if (stage === "backend") throw failure;
      return resolvedTargetStage({ artifacts: [project] });
    });
    try {
      prepare(session);
      assert.throws(() => session.compile(fakeCompileInput()), error => error === failure);
      assert.throws(() => session.compile(fakeCompileInput()), /while in 'compiled'/u);
      assert.equal(backendCalls, 1);
      assert.equal(formatterCalls, stage === "backend" ? 0 : 1);
    } finally {
      session.close();
    }
  }
});

function prepare(session) {
  session.sourceProfileContributions();
  session.sourceCompilerContributions();
  session.runtimeContributions();
}

function context(edition) {
  const target = { id: "rust", options: { outputType: "lib", edition } };
  return {
    project: { entryPoint: "src/index.ts", targets: [target] },
    projectDirectory: process.cwd(),
    target,
    paths: {
      projectFilePath: `${process.cwd()}/tsonic.json`,
      projectRoot: process.cwd(),
      outputRoot: `${process.cwd()}/out`,
      targetOutputRoot: `${process.cwd()}/out/rust`,
      cacheRoot: `${process.cwd()}/.temp/session-formatting-cache`,
    },
    selectedSurfaceIds: [],
    capabilities: [],
  };
}

function restoreFormatter(previous) {
  if (previous === undefined) delete process.env.RUSTFMT;
  else process.env.RUSTFMT = previous;
}
