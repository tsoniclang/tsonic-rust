import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileRustTarget } from "../../../dist/backend/compile.js";
import {
  formatRustCompileOutput,
  RustFormattingError,
} from "../../../dist/backend/emission/rustfmt.js";
import { createRustTargetConfiguration } from "../../../dist/options/rust-target-options.js";
import { composeRustProviderSemantics } from "../../../dist/providers/packages/semantics.js";
import { fakeCompileInput, fakeSourceFile } from "../../helpers/fake-compile-input.mjs";

test("generated Rust sources are canonically formatted without changing other artifacts", () => {
  const project = Object.freeze({
    kind: "project",
    path: "Cargo.toml",
    text: "[package]\nname = \"sample\"\n",
  });
  const source = rustSource("src/lib.rs", "pub fn add(left:i32,right:i32)->i32{left+right}\n");
  const output = Object.freeze({ artifacts: Object.freeze([project, source]) });

  const formatted = formatRustCompileOutput(output, "2024");

  assert.equal(formatted.artifacts[0], project);
  assert.equal(formatted.artifacts[1]?.text, [
    "pub fn add(left: i32, right: i32) -> i32 {",
    "    left + right",
    "}",
    "",
  ].join("\n"));
  assert.equal(source.text, "pub fn add(left:i32,right:i32)->i32{left+right}\n");
});

test("formatting is deterministic for every supported edition", () => {
  const output = Object.freeze({
    artifacts: Object.freeze([
      rustSource("src/lib.rs", "pub fn value()->i32{1}\n"),
    ]),
  });

  for (const edition of ["2021", "2024"]) {
    const first = formatRustCompileOutput(output, edition);
    const second = formatRustCompileOutput(output, edition);
    assert.deepEqual(second, first);
    assert.deepEqual(formatRustCompileOutput(first, edition), first);
  }
});

test("nested fallible tuple and match calls reach native formatter stability", () => {
  const invocation = `capture_reject.call((rt::TsonicError::from(match error {
    Some(flow_value) => flow_value,
    None => unreachable!("checked flow selected a missing optional value"),
  }),))?;`;
  for (const edition of ["2021", "2024"]) {
    for (const depth of [6, 8, 10, 12]) {
      const text = `fn run() {${"if error.is_some() {".repeat(depth)}${invocation}${"}".repeat(depth)}}\n`;
      const formatted = formatRustCompileOutput({ artifacts: [rustSource("src/lib.rs", text)] }, edition);
      assert.deepEqual(formatRustCompileOutput(formatted, edition), formatted,
        `edition ${edition} at depth ${depth} is idempotent`);
      assert.match(formatted.artifacts[0].text, /Some\(flow_value\) => flow_value/u);
      assert.match(formatted.artifacts[0].text, /None =>\s*(?:\{\s*)?unreachable!\(/u);
    }
  }
});

test("a nonconverging formatter fails closed at the bounded pass limit", () => {
  const root = mkdtempSync(resolve(".temp", "nonconverging-rustfmt-"));
  const executable = resolve(root, "rustfmt.mjs");
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
for (const path of process.argv.slice(process.argv.indexOf("--") + 1)) appendFileSync(path, "\\n");
`);
  chmodSync(executable, 0o700);
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = executable;
  const source = rustSource("src/lib.rs", "fn run() {}\n");
  const output = Object.freeze({ artifacts: Object.freeze([source]) });
  try {
    assert.throws(() => formatRustCompileOutput(output, "2024"),
      error => error instanceof RustFormattingError && /did not stabilize within 4 passes/u.test(error.message));
    assert.equal(output.artifacts[0], source);
    assert.equal(source.text, "fn run() {}\n");
  } finally {
    restoreEnvironment("RUSTFMT", previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatter batches preserve every generated Rust artifact and its order", () => {
  const artifacts = Object.freeze(Array.from({ length: 257 }, (_, index) =>
    rustSource(`src/generated_${String(index).padStart(3, "0")}.rs`, `pub fn value_${index}()->i32{${index}}\n`)));

  const formatted = formatRustCompileOutput(Object.freeze({ artifacts }), "2024");

  assert.deepEqual(formatted.artifacts.map((artifact) => artifact.path),
    artifacts.map((artifact) => artifact.path));
  assert.equal(formatted.artifacts.length, 257);
  for (const [index, artifact] of formatted.artifacts.entries()) {
    assert.match(artifact.text, new RegExp(`pub fn value_${index}\\(\\) -> i32 \\{`, "u"));
  }
});

test("formatter treats generated paths as operands rather than options", () => {
  const output = Object.freeze({
    artifacts: Object.freeze([rustSource("-generated.rs", "pub fn value()->i32{1}\n")]),
  });

  const formatted = formatRustCompileOutput(output, "2024");

  assert.match(formatted.artifacts[0]?.text ?? "", /pub fn value\(\) -> i32 \{/u);
});

test("a missing formatter fails closed", () => {
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-rustfmt";
  try {
    assert.throws(
      () => formatRustCompileOutput({ artifacts: [rustSource("src/lib.rs", "fn main() {}\n")] }, "2024"),
      (error) => error instanceof RustFormattingError &&
        /Unable to execute Rust formatter/u.test(error.message),
    );
  } finally {
    restoreEnvironment("RUSTFMT", previous);
  }
});

test("target compilation reports formatter failure as an exact diagnostic", () => {
  const input = fakeCompileInput({
    sourceFiles: [fakeSourceFile({ fileName: "src/empty.ts", statements: [] })],
  });
  const configuration = createRustTargetConfiguration(
    input.target,
    dirname(input.paths.projectFilePath),
    input.paths.targetOutputRoot,
  );
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-rustfmt";
  try {
    const result = compileRustTarget(Object.freeze({
      input,
      configuration,
      providerSemantics: composeRustProviderSemantics([]),
      jsEnabled: false,
      rootPublishesLibrary: true,
    }));
    assert.equal(result.kind, "rejected");
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
      "RUST_SOURCE_FORMATTING_FAILED",
    ]);
    assert.match(result.diagnostics[0]?.message ?? "", /Unable to execute Rust formatter/u);
  } finally {
    restoreEnvironment("RUSTFMT", previous);
  }
});

test("invalid generated Rust fails at the formatter boundary", () => {
  assert.throws(
    () => formatRustCompileOutput({
      artifacts: [rustSource("src/lib.rs", "pub fn broken( {\n")],
    }, "2024"),
    (error) => error instanceof RustFormattingError &&
      /Rust formatter .*exited with status/u.test(error.message) &&
      !error.message.includes("tsonic-rustfmt-"),
  );
});

test("unsafe, duplicate, and file-directory source paths fail before formatter execution", () => {
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-rustfmt";
  try {
    assert.throws(
      () => formatRustCompileOutput({ artifacts: [rustSource("../escape.rs", "fn value() {}\n")] }, "2024"),
      /escapes the formatter staging root/u,
    );
    assert.throws(
      () => formatRustCompileOutput({
        artifacts: [
          rustSource("src/../same.rs", "fn first() {}\n"),
          rustSource("same.rs", "fn second() {}\n"),
        ],
      }, "2024"),
      /occurs more than once/u,
    );
    assert.throws(
      () => formatRustCompileOutput({
        artifacts: [
          rustSource("src/module.rs", "fn first() {}\n"),
          rustSource("src/module.rs/child.rs", "fn second() {}\n"),
        ],
      }, "2024"),
      /conflict as a file and directory/u,
    );
  } finally {
    restoreEnvironment("RUSTFMT", previous);
  }
});

test("outputs without Rust source bypass the formatter unchanged", () => {
  const output = Object.freeze({
    artifacts: Object.freeze([{ kind: "project", path: "Cargo.toml", text: "[workspace]\n" }]),
  });
  const previous = process.env.RUSTFMT;
  process.env.RUSTFMT = "/definitely/missing/tsonic-rustfmt";
  try {
    assert.equal(formatRustCompileOutput(output, "2024"), output);
  } finally {
    restoreEnvironment("RUSTFMT", previous);
  }
});

function rustSource(path, text) {
  return Object.freeze({ kind: "source", language: "rust", path, text });
}

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
