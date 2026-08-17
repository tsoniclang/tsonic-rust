import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("default export expressions initialize once and retain exact imported identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "default_export_expression" } },
    files: {
      "settings.ts": `
import type { int32 } from "@tsonic/core/types.js";

let calls: int32 = 0;

function load(): int32 {
  calls += 1;
  return 41;
}

export function loadCount(): int32 {
  return calls;
}

export default load();
`,
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
import settings, { loadCount } from "./settings.js";

export function main(): void {
  const selected: int32 = settings;
  check(selected === 41);
  check(settings === 41);
  check(loadCount() === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/settings.rs");
  assert.match(source, /pub static DEFAULT:/u);
  assert.equal(validateGeneratedProject("default-export-expression", result.artifacts, { run: true }).status, 0);
});

test("class static fields and blocks share exact source initialization order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_static_blocks" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let sequence: int32 = 0;

function mark(value: int32): int32 {
  sequence = sequence * 10 + value;
  return value;
}

class Registry {
  static first: int32 = mark(1);

  static {
    mark(2);
    Registry.first += 10;
  }

  static last: int32 = mark(3);
}

export function main(): void {
  check(sequence === 123);
  check(Registry.first === 11);
  check(Registry.last === 3);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  const first = source.indexOf("mark(1)");
  const block = source.indexOf("mark(2)");
  const last = source.indexOf("mark(3)");
  assert.ok(first >= 0 && first < block && block < last, source);
  assert.equal(validateGeneratedProject("class-static-blocks", result.artifacts, { run: true }).status, 0);
});

test("a static block preserves lexical bindings and abrupt control inside its own scope", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_static_block_scope" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let result: int32 = 0;

class Values {
  static {
    let local: int32 = 4;
    if (local === 4) {
      const nested: int32 = 5;
      result = local * 10 + nested;
    }
  }
}

export function main(): void {
  check(result === 45);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("class-static-block-scope", result.artifacts, { run: true }).status, 0);
});
