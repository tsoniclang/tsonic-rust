import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeType, nativeBorrow } from "../../helpers/native-ast.mjs";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("never remains bottom through provider and project-source calls", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    files: {
      "index.ts": `
import { fail } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function terminate(): never {
  return fail("stop");
}

export function choose(flag: boolean): int32 {
  if (flag) {
    return terminate();
  }
  return 42;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn terminate\(\) -> !/u);
  assert.match(source, /acme_testing::fail\(String::from\("stop"\)\)/u);
  assert.match(source, /pub fn choose\(flag: bool\) -> i32/u);
  assert.match(source, /terminate\(\)/u);
  validateGeneratedProject("never-infallible", result.artifacts);
});

test("throwing sync and async never callables preserve bottom after propagation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class Failure {
  stop(message: string): never {
    throw new Error(message);
  }

  choose(flag: boolean): int32 {
    if (flag) {
      return this.stop("sync");
    }
    return 42;
  }
}

async function stopAsync(): Promise<never> {
  throw new Error("async");
}

export async function chooseAsync(flag: boolean): Promise<int32> {
  if (flag) {
    return await stopAsync();
  }
  return new Failure().choose(false);
}

export async function chooseAliasedAsync(flag: boolean): Promise<int32> {
  if (flag) {
    const pending = stopAsync();
    return await pending;
  }
  return 42;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const stop = nativeFunction(result, "stop");
  assert.deepEqual(stop.params.find(parameter => parameter.name === "message").type, nativeBorrow(nativeType("str")));
  assert.equal(stop.returnType === undefined || stop.returnType.kind === "unit", true);
  assert.equal(stop.errorType.identity, "tsonic-rust-runtime:TsonicError");
  const model = nativeSource(result);
  assert.equal(nativeNodes(model, node => node.kind === "try" && node.expr.kind === "method-call" && node.expr.method === "stop" &&
    node.expr.args[0]?.kind === "str-literal" && node.expr.args[0].value === "sync").length, 1);
  assert.equal(nativeNodes(model, node => node.kind === "unreachable").length > 0, true, "bottom never becomes a fabricated result");
  const asynchronous = nativeFunction(result, "stopAsync");
  assert.equal(asynchronous.returnType.path, "js_abi::JsPromise");
  assert.deepEqual(asynchronous.returnType.genericArguments[0], { kind: "lifetime", lifetime: { kind: "static" } });
  assert.deepEqual(asynchronous.returnType.genericArguments[1].type, nativeType("()"));
  assert.equal(asynchronous.returnType.genericArguments[2].type.identity, "tsonic-rust-runtime:TsonicError");
  assert.equal(nativeNodes(nativeFunction(result, "chooseAsync"), node => node.kind === "try" && node.expr.kind === "await" &&
    node.expr.expr.kind === "method-call" && node.expr.expr.method === "into_result" &&
    nativeCalls(node.expr, "stopAsync").length === 1).length, 1, "awaited bottom propagates the original rejection");
  validateGeneratedProject("never-fallible", result.artifacts);
});

test("never is rejected as stored data instead of becoming a generic Rust type", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class InvalidNeverStorage {
  value: never;

  constructor(value: never) {
    this.value = value;
  }
}
`,
    },
  });

  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_MISSING_TARGET_FACT" &&
    diagnostic.message ===
      "Class field 'value' has no supported Rust storage identity or carrier fact. " +
        "Node kind: KindPropertyDeclaration."));
  assert.equal(result.artifacts.length, 0);
});
