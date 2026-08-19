import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  acmeVectorsPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  createRustSession,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const counterSource = `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }

  current(): int32 {
    return this.value;
  }
}

export function drive(): int32 {
  const counter = new Counter(10);
  counter.add(5);
  return counter.current() + counter.value;
}
`;

test("fallibility propagates transitively to callers", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("boom");
}

export function forwards(): int32 {
  return risky();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn forwards\(\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /pub fn forwards\(\) -> rt::TsonicResult<i32> \{\n    risky\(\)\n\}/u);
  assert.doesNotMatch(text, /Ok\(risky\(\)\?\)/u);
});

test("fallible calls inside callbacks use the explicit fallible callback ABI", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(x: int32): int32 {
  throw new Error("boom");
}

export function bad(xs: int32[]): boolean {
  return xs.some((x) => risky(x) === 1);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn bad\(xs: js_abi::JsArray<i32>\) -> rt::TsonicResult<bool>/u);
  assert.match(text, /xs\.try_some\(\|x\| Ok::<_, rt::TsonicError>\(risky\(x\)\? == 1\)\)/u);
});

test("string literals mentioning runtime aliases do not create imports", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function describe(): string {
  return "js_abi:: rt:: node_fs:: js_string:: node_path:: node_os:: are just text";
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.ok(!text.includes("use tsonic_rust_js"), "no false js import");
  assert.ok(!text.includes("use tsonic_rust_node"), "no false node import");
  assert.ok(!text.includes("use tsonic_rust_runtime"), "no false runtime import");
});

test("throwing code importing nothing else still gets the runtime alias", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function fail(): void {
  throw new Error("rt:: is text here, the import comes from the throw");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /use tsonic_rust_runtime as rt;/u);
});
