import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes, nativeCalls, nativeMethods, nativeType } from "../../../helpers/native-ast.mjs";
import { artifactText, compileRust } from "../../../helpers/rust-session.mjs";


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
  assert.match(text, /pub fn forwards\(\) -> Result<i32, rt::TsonicError> \{/u);
  assert.match(text, /pub fn forwards\(\) -> Result<i32, rt::TsonicError> \{\n    risky\(\)\n\}/u);
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
  const bad = nativeFunction(result, "bad");
  assert.equal(bad.params[0].type.path, "js_abi::JsArray");
  assert.deepEqual(bad.params[0].type.genericArguments, [{ kind: "type", type: nativeType("i32") }]);
  assert.deepEqual(bad.returnType, nativeType("bool"));
  assert.equal(bad.errorType.identity, "tsonic-rust-runtime:TsonicError");
  const selected = nativeMethods(bad.body, "try_some");
  assert.equal(selected.length, 1, "the fallible callback operation is selected");
  const callback = selected[0].args[0];
  assert.equal(callback.kind === "closure" || callback.kind === "closure-block", true);
  assert.equal(nativeNodes(callback, node => node.kind === "try" && nativeCalls(node.expr, "risky").length === 1).length, 1,
    "callback failure propagates rather than becoming a boolean");
  assert.equal(nativeNodes(callback, node => node.kind === "binary" && node.operator === "==" && node.right.text === "1").length, 1);
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
