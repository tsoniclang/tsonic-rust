import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeMethods, nativeType,
  nativeBorrow, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("node path and os lower through provider rows to tsonic_rust_node", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { join, dirname, basename, extname, isAbsolute } from "node:path";
import { platform, eol } from "node:os";

export function probe(dir: string, file: string): boolean {
  const full: string = join(dir, file);
  const parent: string = dirname(full);
  const name: string = basename(full);
  const ext: string = extname(name);
  return isAbsolute(full) && parent.length >= 0 && platform().length > 0 && eol().length > 0 && ext.length >= 0;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.doesNotMatch(text, /use tsonic_rust_node::path as node_path;/u);
  assert.match(text, /pub fn probe\(dir: String, file: String\)/u);
  assert.match(text, /tsonic_rust_node::path::join\(&\[dir\.as_str\(\), file\.as_str\(\)\]\)/u);
  assert.match(text, /tsonic_rust_node::path::dirname\(&full\)/u);
  assert.match(text, /tsonic_rust_node::path::basename\(&full, None\)/u);
  assert.match(text, /tsonic_rust_node::os::platform\(\)/u);
  assert.match(text, /tsonic_rust_node::os::eol\(\)/u);
  assert.doesNotMatch(text, /tsonic_rust_node::os::eol\(\)\.to_string\(\)/u);
  assert.match(artifactText(result, "Cargo.toml"), /tsonic_rust_node = \{ path = ".*rust-nodejs\/rust\/crates\/tsonic_rust_node" \}/u);
});

test("writable provider projections lower through their exact selected write evidence", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import process from "node:process";

export function setExitStatus(): void {
  process.exitCode = 2;
  process.exitCode = null;
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::process::set_exit_code\(Some\(2\)\)/u);
  assert.match(text, /tsonic_rust_node::process::set_exit_code\(Option::<i32>::None\)/u);
});

test("provider argument conversion does not change nested source operator semantics", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import type { int32 } from "@tsonic/core/types.js";

export function readOffset(bytes: Buffer): int32 {
  let index = 2;
  return bytes.readUInt8(index + 1);
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /read_uint8_number\(\s*&bytes,\s*index \+ 1\.0,?\s*\)/u);
  assert.match(text, /u8_to_i32\([\s\S]*read_uint8_number/u);
  assert.doesNotMatch(text, /f64_to_i32/u);
});

test("node path, filesystem, and crypto overloads lower through exact provider signatures", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, sep } from "node:path";

export function probe(
  root: string,
  bytes: Buffer,
  mode: number,
  maxRetries: number,
  retryDelay: number,
): string {
  const temporary = mkdtempSync(root);
  mkdirSync(temporary, { recursive: true, mode });
  const separator = sep;
  const file = temporary + separator + "payload.bin";
  writeFileSync(file, bytes);
  const loaded = readFileSync(file);
  const digest = createHash("sha256").update(loaded).digest("hex");
  const textFile = temporary + separator + "payload.txt";
  writeFileSync(textFile, "hello", "utf8");
  const text = readFileSync(textFile, "utf8");
  const symbolic = lstatSync(file).isSymbolicLink();
  const relativePath = relative(temporary, file);
  const result = text + digest;
  rmSync(temporary, { recursive: true, force: true, maxRetries, retryDelay });
  if (symbolic) return relativePath;
  return result;
}

export function defaultedOptions(path: string): void {
  mkdirSync(path, { recursive: true });
  rmSync(path, { recursive: true, force: true });
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::path::relative/u);
  assert.match(text, /String::from\(tsonic_rust_node::path::sep\(\)\)/u);
  assert.match(text, /tsonic_rust_node::fs::read_file_sync_buffer/u);
  assert.match(text, /tsonic_rust_node::fs::read_file_sync_string/u);
  assert.match(text, /tsonic_rust_node::fs::write_file_sync_buffer/u);
  assert.match(text, /tsonic_rust_node::fs::write_file_sync_string/u);
  assert.match(text, /\.update_buffer_owned\(/u);
  assert.match(text, /\.digest_string\(/u);
  assert.match(text, /\.is_symbolic_link\(\)/u);
  assert.match(
    text,
    /MakeDirectoryOptions\s*\{\s*recursive:\s*Some\(true\),\s*mode:\s*Some\(rt::conversions::checked_integer::<u32>\(mode\)\?\),\s*\}/u,
  );
  assert.match(
    text,
    /RmOptions\s*\{\s*recursive:\s*Some\(true\),\s*force:\s*Some\(true\),\s*max_retries:\s*Some\(rt::conversions::checked_integer::<u32>\(maxRetries\)\?\),\s*retry_delay_ms:\s*Some\(rt::conversions::checked_integer::<u64>\(retryDelay\)\?\),\s*\}/u,
  );
  assert.match(
    text,
    /MakeDirectoryOptions\s*\{\s*recursive:\s*Some\(true\),\s*\.\.Default::default\(\)\s*\}/u,
  );
  assert.match(
    text,
    /RmOptions\s*\{\s*recursive:\s*Some\(true\),\s*force:\s*Some\(true\),\s*\.\.Default::default\(\)\s*\}/u,
  );
  validateGeneratedProject("node-portable-contracts", result.artifacts);
});

test("provider-private boolean filesystem overloads are absent", async () => {
  const diagnostics = rustSourceDiagnostics(createRustSession({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { mkdirSync, rmSync } from "node:fs";

export function invalid(path: string): void {
  mkdirSync(path, true);
  rmSync(path, true);
}
`,
    },
  }));

  assert.equal([...diagnostics.matchAll(/TS2769/gu)].length, 2);
});

test("borrowed provider strings materialize ownership only in owned contexts", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "index.ts": `
import { sep } from "node:path";

export function ownedSeparator(): string {
  return sep;
}

export function endsWithSeparator(value: string): boolean {
  return value.endsWith(sep);
}

export function appendSeparator(value: string): string {
  return value + sep;
}

export function main(): void {
  const separator = ownedSeparator();
  const appended = appendSeparator("path");
  if (separator !== sep || appended !== "path" + separator || !endsWithSeparator(appended) || endsWithSeparator("path")) {
    throw new Error("borrowed separator contract");
  }
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const owned = nativeFunction(result, "ownedSeparator");
  assert.deepEqual(owned.returnType, nativeType("String"));
  const conversions = nativeNodes(owned.body, node => node.kind === "owned-string-from-borrowed-str" &&
    nativeCalls(node.expression, "tsonic_rust_node::path::sep").length === 1);
  assert.equal(conversions.length, 1, "ownership is materialized exactly at the owned result boundary");
  const ends = nativeFunction(result, "endsWithSeparator");
  const comparisons = nativeCalls(ends.body, "js_string::ends_with_at_end");
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].args[0].path, "core::convert::AsRef::<str>::as_ref");
  assert.equal(nativeCalls(comparisons[0].args[1], "tsonic_rust_node::path::sep").length, 1);
  assertNoNativeCalls(ends.body, ["to_owned", "to_string", "clone"], "read-only native separator stays borrowed");
  const append = nativeFunction(result, "appendSeparator");
  const parts = nativeNodes(append.body, node => node.kind === "string-concat");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].parts.length, 2);
  assert.equal(parts[0].parts[0].path, "value");
  assert.equal(nativeCalls(parts[0].parts[1], "tsonic_rust_node::path::sep").length, 1);
  assertNoNativeCalls(append.body, ["to_string"], "native concatenation does not materialize a separate separator");
  validateGeneratedProject("node-borrowed-provider-strings", result.artifacts, { run: true });
});

test("node assert.ok overloads lower through exact selected signatures", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { ok } from "node:assert";

function sumIsFour(left: number, right: number): boolean {
  return left + right === 4;
}

export function verify(value: boolean): void {
  ok(value);
  ok(value, "value must be true");
  ok(sumIsFour(2, 2), "nested operations must be finalized");
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /tsonic_rust_node::assert::ok\(value, None\)\?/u);
  assert.match(text, /tsonic_rust_node::assert::ok_with_message\(value, "value must be true"\)\?/u);
  assert.match(
    text,
    /tsonic_rust_node::assert::ok_with_message\(\s*sumIsFour\(2\.0, 2\.0\),\s*"nested operations must be finalized",\s*\)\?/u,
  );
});
