import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTelemetryCapability, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";
import { rustTargetOperationFactKey } from "../dist/index.js";
import { finalizeRustProviderOperationAbi } from "../dist/source/rust-facts/finalized-operation-abi.js";
import { applyFallibleShape, rustBlockTerminates } from "../dist/backend/planner/functions.js";
import {
  requireProviderArgumentPassingFacts,
  sourceCallSelectedMemberMatches,
} from "../dist/backend/planner/expressions.js";

test("value-returning fallible bodies never synthesize an invalid Ok unit", () => {
  const incomplete = { statements: [{ kind: "expr", expr: { kind: "path", path: "work" } }] };
  const complete = {
    statements: [{
      kind: "if",
      condition: { kind: "path", path: "flag" },
      then: { statements: [{ kind: "return", expr: { kind: "int-literal", text: "1" } }] },
      else: { statements: [{ kind: "throw", message: { kind: "str-literal", value: "x" } }] },
    }],
  };

  assert.equal(rustBlockTerminates(incomplete), false);
  assert.equal(rustBlockTerminates(complete), true);
  assert.deepEqual(applyFallibleShape(incomplete, true, true), incomplete);
});

test("operation fact equality is structural and independent of metadata key order", () => {
  const resultCarrier = {
    kind: "target-specific",
    target: "rust",
    name: "named-type",
    value: { id: "acme.Value", path: "acme::Value", typeArguments: [] },
  };
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: { form: "call", path: "acme::run" },
    sourceArgumentCarriers: [],
    resultCarrier,
    isAsync: false,
    isFallible: false,
  });
  assert.ok(abi);
  const left = {
    kind: "provider-operation",
    operationId: "acme.run",
    resultCarrier,
    abi,
  };
  const right = {
    abi,
    resultCarrier,
    operationId: "acme.run",
    kind: "provider-operation",
  };

  assert.equal(rustTargetOperationFactKey.equals(left, right), true);
  assert.equal(rustTargetOperationFactKey.equals(left, {
    ...right,
    abi: { ...abi, target: { form: "call", path: "acme::different" } },
  }), false);
});

test("project-source call consumption requires exact selected member kind, target, and ABI", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const fact = {
    kind: "source-call",
    operationId: "source:add",
    target: { form: "function", fileName: "/src/math.ts", name: "add" },
    parameterCarriers: [int32],
    argumentModes: ["value"],
    resultCarrier: int32,
  };
  const member = {
    id: fact.operationId,
    sourceName: "add",
    targetName: "add",
    kind: "method",
    parameters: [{ name: "value", type: int32, passingMode: "by-value" }],
    returnType: int32,
  };
  const selected = { member };
  assert.equal(sourceCallSelectedMemberMatches(fact, selected), true);
  assert.equal(sourceCallSelectedMemberMatches(fact, { member: { ...member, kind: "property" } }), false);
  assert.equal(sourceCallSelectedMemberMatches(fact, { member: { ...member, targetName: "other" } }), false);
  assert.equal(sourceCallSelectedMemberMatches(fact, { member: { ...member, parameters: [,] } }), false);
});

test("compile-time provider arguments never require runtime carrier or passing facts", () => {
  const jsValue = { kind: "target-named", id: "rust.js.JsValue" };
  const sourceNullish = { kind: "target-specific", target: "rust", name: "source-nullish" };
  const float64 = { kind: "source-primitive", name: "float64" };
  const string = { kind: "target-named", id: "rust.std.String" };
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "method",
    form: {
      form: "call",
      path: "js_abi::json_stringify_with_indent",
      argModes: ["ref"],
      argOrder: [0],
      trailingArguments: [{ kind: "string", value: "  " }],
    },
    sourceArgumentCarriers: [jsValue, sourceNullish, float64],
    declaredSourceArgumentCarriers: [jsValue],
    compileTimeSourceArgumentIndexes: [1, 2],
    resultCarrier: string,
    isAsync: false,
    isFallible: true,
  });
  assert.ok(abi);
  const runtimeArgument = {};
  const compileTimeNull = {};
  const compileTimeIndent = {};
  const context = {
    diagnostics: [],
    input: {
      facts: {
        getArgumentPassingFact(node) {
          assert.equal(node, runtimeArgument);
          return { mode: "borrow-shared" };
        },
        getRuntimeCarrierFact(node) {
          assert.equal(node, runtimeArgument);
          return { carrier: jsValue };
        },
        getTargetConversionFact(node) {
          assert.equal(node, runtimeArgument);
          return undefined;
        },
      },
    },
  };
  const fact = {
    kind: "provider-operation",
    operationId: "tsonic.rust.js.JSON.stringify.indent",
    resultCarrier: string,
    abi,
  };

  assert.equal(requireProviderArgumentPassingFacts(
    context,
    fact,
    [runtimeArgument, compileTimeNull, compileTimeIndent],
  ), true);
  assert.deepEqual(context.diagnostics, []);
});

test("top-level mutable bindings never masquerade as Rust constants", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export let VALUE: int32 = 1;
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_AST" &&
    diagnostic.message.includes("annotated const bindings")));
});

test("singleton tuples render with the Rust-required trailing comma", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function singleton(value: int32): [int32] {
  return [value];
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /pub fn singleton\(value: i32\) -> \(i32,\) \{\n    \(value,\)\n\}/u);
  validateGeneratedProject("backend-singleton-tuple", result.artifacts);
});

test("empty classes retain reference identity through an empty object state", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class Empty {
  constructor() {}
}

export function make(): Empty {
  return new Empty();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub struct Empty \{\n    pub\(crate\) __tsonic_state: rt::ObjectHandle<\(\)>,\n\}/u);
  assert.match(text, /__tsonic_state: rt::ObjectHandle::new\(\(\)\)/u);
  validateGeneratedProject("backend-empty-class", result.artifacts);
});

test("duplicate TypeScript enum discriminants fail before Rust emission", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export enum Duplicate {
  First = 1,
  Second = 1,
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_UNSUPPORTED_AST" &&
    diagnostic.message.includes("same discriminant 1")));
});

test("private class members remain private in generated Rust", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Secret {
  private value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  private hidden(): int32 {
    return this.value;
  }

  reveal(): int32 {
    return this.hidden();
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /    pub\(crate\) __tsonic_state: rt::ObjectHandle<\(i32,\)>,/u);
  assert.doesNotMatch(text, /    (?:pub )?value: i32,/u);
  assert.match(text, /    fn hidden\(&self\) -> i32/u);
  assert.doesNotMatch(text, /    pub fn hidden\(&self\)/u);
  assert.match(text, /    pub fn reveal\(&self\) -> i32/u);
  validateGeneratedProject("backend-private-members", result.artifacts);
});

test("binary entry modules are emitted through the structured Rust AST", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "structured_main" } },
    files: {
      "index.ts": `
export function main(): void {}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/main.rs"),
    /fn main\(\) \{\n    structured_main::index::main\(\);\n\}/u,
  );
  validateGeneratedProject("backend-structured-main", result.artifacts, { run: true });
});

test("fallible binary entry modules preserve structured Result return types", () => {
  const { result } = compileRust({
    packages: [acmeTelemetryCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "fallible_main" } },
    files: {
      "index.ts": `
import { createMeter } from "telemetry";

export function main(): void {
  createMeter("requests");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(
    artifactText(result, "src/main.rs"),
    /fn main\(\) -> tsonic_rust_runtime::TsonicResult<\(\)> \{\n    fallible_main::index::main\(\)\n\}/u,
  );
  validateGeneratedProject("backend-fallible-main", result.artifacts, { run: true });
});
