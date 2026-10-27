import { rustTargetOperationFactEquals } from "../../../dist/target-model/records/operation-equality.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTelemetryCapability, analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";
import {
  applyFallibleShape,
  applyRustFallibleResultExpression,
} from "../../../dist/backend/planner/types/fallible-shape.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/carrier-syntax.js";
import { requireProviderArgumentPassingFacts } from "../../../dist/backend/planner/expressions/index.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/analysis/callables/calls/source-call-evidence.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { analyzeRustSourceCallArguments } from "../../../dist/analysis/callables/calls/source-call-arguments.js";
import { createRustSourceCallArgumentProducer } from "../../../dist/analysis/program/records/source-call-arguments.js";
import { selectRustProviderSourceOccurrence } from "../../../dist/analysis/operations/provider-source-inputs.js";
import {
  isRustNamedTypeTraitContract,
  rustNamedTypeCarrierValue,
  rustNamedTargetType,
} from "../../../dist/target-model/types/index.js";

test("native trait contracts preserve exact conditional Copy and Clone semantics", () => {
  const traits = {
    implementations: [
      {
        trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] },
        requirements: [{ typeArgumentIndex: 0, trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] } }],
      },
      {
        trait: { kind: "trait-ref", id: "core::marker::Copy", path: "core::marker::Copy", genericArguments: [], associatedConstraints: [] },
        requirements: [{ typeArgumentIndex: 0, trait: { kind: "trait-ref", id: "core::marker::Copy", path: "core::marker::Copy", genericArguments: [], associatedConstraints: [] } }],
      },
    ],
  };
  assert.equal(isRustNamedTypeTraitContract(traits), true);
  assert.ok(rustNamedTypeCarrierValue(rustNamedTargetType(
    "acme.Cell",
    "acme::Cell",
    [{ kind: "type", type: { kind: "source-primitive", name: "int32" } }],
    [],
    traits,
  )));
  assert.equal(rustNamedTypeCarrierValue(rustNamedTargetType(
    "acme.Cell",
    "acme::Cell",
    [],
    [],
    traits,
  )), undefined, "trait requirements cannot address a missing type argument");
});

test("named carriers elide only an exact trailing Rust generic-default suffix", () => {
  const int32 = { kind: "type", type: { kind: "source-primitive", name: "int32" } };
  const boolean = { kind: "type", type: { kind: "source-primitive", name: "bool" } };
  const float64 = { kind: "type", type: { kind: "source-primitive", name: "float64" } };
  const uint8 = { kind: "type", type: { kind: "source-primitive", name: "uint8" } };

  assert.deepEqual(
    rustTypeFromCarrier(rustNamedTargetType(
      "acme.Family",
      "acme::Family",
      [int32, boolean, float64],
      [boolean, float64],
    )),
    {
      kind: "named",
      path: "acme::Family",
      identity: "acme.Family",
      genericArguments: [{ kind: "type", type: { kind: "primitive", name: "i32" } }],
    },
  );
  assert.deepEqual(
    rustTypeFromCarrier(rustNamedTargetType(
      "acme.Family",
      "acme::Family",
      [int32, uint8, float64],
      [boolean, float64],
    )),
    {
      kind: "named",
      path: "acme::Family",
      identity: "acme.Family",
      genericArguments: [
        { kind: "type", type: { kind: "primitive", name: "i32" } },
        { kind: "type", type: { kind: "primitive", name: "u8" } },
      ],
    },
  );
  assert.equal(rustNamedTypeCarrierValue({
    ...rustNamedTargetType("acme.Invalid", "acme::Invalid", [int32]),
    value: {
      id: "acme.Invalid",
      path: "acme::Invalid",
      traits: { implementations: [] },
      genericArguments: [int32],
      genericDefaults: [boolean, float64],
    },
  }), undefined);
});

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

  assert.deepEqual(applyFallibleShape(incomplete, {
    fallible: true,
    hasReturnValue: true,
    errorType: { kind: "named", path: "rt::TsonicError" },
    inferErrorTypeFromReturnType: true,
  }), incomplete);
});

test("fallible result expressions preserve conversion into the enclosing program error", () => {
  const providerCall = { kind: "call", path: "provider::read", args: [] };
  const runtimeError = { kind: "named", path: "rt::TsonicError" };
  const providerError = { kind: "named", path: "provider::Error" };
  const projectError = { kind: "named", path: "project::Error" };

  assert.deepEqual(
    applyRustFallibleResultExpression(
      {
        kind: "try",
        expr: providerCall,
        operandErrorType: providerError,
        resultErrorType: runtimeError,
      },
      { errorType: runtimeError },
    ),
    {
      kind: "method-call",
      receiver: providerCall,
      method: "map_err",
      args: [{
        kind: "associated-value",
        owner: runtimeError,
        name: "from",
      }],
    },
  );
  assert.deepEqual(
    applyRustFallibleResultExpression(
      {
        kind: "try",
        expr: providerCall,
        operandErrorType: runtimeError,
        resultErrorType: runtimeError,
      },
      { errorType: runtimeError },
    ),
    providerCall,
  );
  assert.deepEqual(
    applyRustFallibleResultExpression(
      {
        kind: "try",
        expr: providerCall,
        operandErrorType: projectError,
        resultErrorType: projectError,
      },
      { errorType: projectError },
    ),
    providerCall,
  );
});

test("operation fact equality is structural and independent of metadata key order", () => {
  const resultCarrier = {
    kind: "target-specific",
    target: "rust",
    name: "named-type",
    value: {
      id: "acme.Value",
      path: "acme::Value",
      traits: { implementations: [] },
      genericArguments: [],
      genericDefaults: [],
      upcasts: [],
    },
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

  assert.equal(rustTargetOperationFactEquals(left, right), true);
  assert.equal(rustTargetOperationFactEquals(left, {
    ...right,
    abi: { ...abi, target: { form: "call", path: "acme::different" } },
  }), false);
});

test("project-source call consumption requires exact selected member kind, target, and ABI", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const fact = {
    kind: "source-call",
    operationId: "source:add",
    target: {
      form: "function",
      fileName: "/src/math.ts",
      name: "add",
      selectedTargetName: "add",
    },
    parameters: [{
      form: "required",
      valueCarrier: int32,
      parameterCarrier: int32,
      mode: "value",
      inputs: [{
        sourceArgumentIndex: 0,
        sourceForm: "value",
        sourceParameterForm: "parameter",
        carrier: int32,
      }],
    }],
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
  const normalize = carrier => carrier;
  assert.equal(sourceCallSelectedMemberMatches(fact, selected, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), true);
  assert.equal(sourceCallSelectedMemberMatches(fact, { member: { ...member, kind: "property" } }, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), false);
  assert.equal(sourceCallSelectedMemberMatches(fact, { member: { ...member, targetName: "other" } }, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), false);
  assert.equal(sourceCallSelectedMemberMatches(fact, { member: { ...member, parameters: [,] } }, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), false);
});

test("project-source call consumption accepts only proven target-finalized inferred type arguments", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const float64 = { kind: "source-primitive", name: "float64" };
  const typeParameter = { kind: "type-parameter", identity: "T", name: "T" };
  const targetArgument = { kind: "type", type: int32 };
  const selectedArgument = { kind: "type", type: float64 };
  const fact = {
    kind: "source-call",
    operationId: "source:identity",
    target: {
      form: "function",
      fileName: "/src/identity.ts",
      name: "identity",
      selectedTargetName: "identity",
    },
    parameters: [{
      form: "required",
      valueCarrier: int32,
      parameterCarrier: int32,
      mode: "value",
      inputs: [{
        sourceArgumentIndex: 0,
        sourceForm: "value",
        sourceParameterForm: "parameter",
        carrier: int32,
      }],
    }],
    targetGenericArguments: [targetArgument],
    resultCarrier: int32,
  };
  const member = {
    id: fact.operationId,
    sourceName: "identity",
    targetName: "identity",
    kind: "method",
    genericParameters: [{ kind: "type", targetIdentity: "T", sourceName: "T" }],
    parameters: [{ name: "value", type: typeParameter, passingMode: "by-value" }],
    returnType: typeParameter,
  };
  const inferredSourceArgument = {
    typeParameterName: "T",
    typeParameter: {},
    selectedType: {},
  };
  const selected = {
    member,
    targetGenericArguments: [selectedArgument],
    sourceSelectedMethodTypeArguments: [inferredSourceArgument],
  };

  const normalize = carrier => carrier;
  assert.equal(sourceCallSelectedMemberMatches(fact, selected, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), true);
  assert.equal(sourceCallSelectedMemberMatches(fact, {
    ...selected,
    sourceSelectedMethodTypeArguments: [{
      ...inferredSourceArgument,
      explicitTypeNode: {},
    }],
  }, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), false);
  assert.equal(sourceCallSelectedMemberMatches(fact, {
    ...selected,
    member: {
      ...member,
      genericParameters: [{ kind: "lifetime", sourceName: "T", targetIdentity: "life:T" }],
    },
  }, member.returnType, normalize, undefined, [], emptyRustTypeDefinitions, new Map()), false);
});

test("evaluation-only provider arguments do not require native parameter-passing facts", () => {
  const jsValue = { kind: "target-named", id: "rust.js.JsValue" };
  const sourceNullish = { kind: "target-named", id: "rust.native.absence" };
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
    evaluationOnlySourceArgumentIndexes: [1, 2],
    resultCarrier: string,
    isAsync: false,
    isFallible: true,
    errorBoundary: "provider-native",
    errorCarrier: { kind: "target-named", id: "rust.test.ProviderError" },
  });
  assert.ok(abi);
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function observed(value: unknown, indent: number): string | undefined {
  return JSON.stringify(value, undefined, indent);
}
` } });
  const ast = program.source.ast;
  let call;
  const visit = node => {
    if (ast.is.IsCallExpression(node) && ast.arguments(node).length === 3) call = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(call !== undefined, true, "the fixture uses the actual checked three-argument operation");
  const [runtimeArgument, omittedNull, omittedIndent] = ast.arguments(call);
  const fact = {
    kind: "provider-operation",
    operationId: "tsonic.rust.js.JSON.stringify.indent",
    resultCarrier: string,
    abi,
  };
  const occurrence = selectRustProviderSourceOccurrence(call, fact, undefined, [runtimeArgument, omittedNull, omittedIndent]);
  assert.equal(occurrence !== undefined, true, "every runtime and evaluation-only source slot has an exact checked identity");
  const reads = [];
  const records = createRustRecordFixture({ argumentPassing: { get: node => {
    reads.push(node);
    assert.equal(node === runtimeArgument, true, "only the runtime input requires a native parameter-passing fact");
    return program.records.argumentPassing.get(node);
  } } }, program.records);
  const admission = { ...program, records, physicalEmissionContexts: {
    ...program.physicalEmissionContexts, sourceOccurrences: [occurrence],
  } };
  const producer = createRustSourceCallArgumentProducer(() => undefined);
  const issues = analyzeRustSourceCallArguments(admission, [], producer, program.source);
  assert.equal(issues.length, 0, "the actual pre-seal passing owner admits all three original source arguments");
  assert.equal(reads.length, 1, "neither evaluation-only operand is queried for native passing");
  const context = { diagnostics: [], input: { program: { ...program,
    records: createRustRecordFixture({ ...producer.records }, records),
  } } };

  assert.equal(requireProviderArgumentPassingFacts(
    context,
    fact,
    [runtimeArgument, omittedNull, omittedIndent],
  ), true);
  assertNoTargetDiagnostics(context.diagnostics);
  assert.throws(() => requireProviderArgumentPassingFacts({ ...context, input: { program } }, fact,
    [runtimeArgument, omittedNull, omittedIndent]),
  error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT",
  "a newly constructed ABI cannot borrow another operation's passing admission");
  for (const passing of [undefined, { mode: "value" }]) {
    const rejected = analyzeRustSourceCallArguments({ ...admission, records: createRustRecordFixture({
      argumentPassing: { get: node => {
        assert.equal(node === runtimeArgument, true, "negative controls still never query omitted parameter facts");
        return passing;
      } },
    }, program.records) }, [], createRustSourceCallArgumentProducer(() => undefined), program.source);
    assert.equal(rejected.length, 1, "a missing or conflicting runtime passing fact is rejected before sealing");
    assert.equal(rejected[0].code, passing === undefined ? "RUST_MISSING_TARGET_FACT" : "RUST_UNSUPPORTED_AST",
      "the exact runtime admission failure is not replaced by an evaluation-only refusal");
  }
});

test("runtime module bindings publish one explicit Rust crate startup contract", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export let VALUE: int32 = 1;
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/lib.rs"),
    /pub fn initialize\(\) \{\s*crate::index::module_init\(\);\s*\}/su,
  );
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

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(artifactText(result, "src/index.rs"), /pub fn singleton\(value: i32\) -> \(i32,\) \{\n    \(value,\)\n\}/u);
  validateGeneratedProject("backend-singleton-tuple", result.artifacts);
});

test("empty classes retain reference identity through an empty object state", () => {
  const files = {
      "index.ts": `
export class Empty {
  constructor() {}
}

export function make(): Empty {
  return new Empty();
}

`,
  };
  const { result } = compileRust({ files });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub struct Empty \{\n    #\[doc\(hidden\)\]\n    pub identity: rt::ObjectIdentity,\n    #\[doc\(hidden\)\]\n    pub dispatch: alloc::rc::Rc<dyn EmptyDispatch \+ 'static>,\n\}/u);
  assert.match(text, /dispatch: alloc::rc::Rc::new\(EmptyRoot \{/u);
  validateGeneratedProject("backend-empty-class", result.artifacts);
  const executable = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "empty_class_identity" } },
    files: { "index.ts": (`${files["index.ts"]}
export function main(): void {
  const original = make();
  const alias = original;
  const different = make();
  if (original !== alias || original === different) throw new Error("empty class identity was lost");
}` + "\nmain();\n") },
  }).result;
  assertNoTargetDiagnostics(executable.diagnostics);
  const native = validateGeneratedProject("backend-empty-class-identity", executable.artifacts, { run: true });
  assert.equal(native.status, 0, JSON.stringify(native));
});

test("duplicate TypeScript enum discriminants retain every alias without allocation", () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "duplicate_enum_discriminants" },
    },
    files: {
      "index.ts": `
export enum Duplicate {
  First = 1,
  Second = 1,
  Third = 2,
}

function same(left: Duplicate, right: Duplicate): boolean {
  return left === right;
}

export function main(): void {
  if (!same(Duplicate.First, Duplicate.Second) || same(Duplicate.First, Duplicate.Third)) {
    throw new Error("duplicate enum discriminants were not preserved");
  }
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(
    text,
    /#\[repr\(transparent\)\]\n#\[derive\(Clone, Copy, Debug, PartialEq, Eq, Hash\)\]\npub struct Duplicate \{/u,
  );
  assert.equal(
    text.match(/#\[allow\(non_upper_case_globals, reason = "preserves the authored source name"\)\]/gu)?.length,
    3,
  );
  assert.match(text, /pub const First: Self = Self \{ value: 1 \};/u);
  assert.match(text, /pub const Second: Self = Self \{ value: 1 \};/u);
  assert.match(text, /pub const Third: Self = Self \{ value: 2 \};/u);
  validateGeneratedProject("duplicate-enum-discriminants", result.artifacts, { run: true });
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

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub struct Secret \{\n    #\[doc\(hidden\)\]\n    pub identity: rt::ObjectIdentity,\n    #\[doc\(hidden\)\]\n    pub dispatch: alloc::rc::Rc<dyn SecretDispatch \+ 'static>,\n\}/u);
  assert.match(text, /    value: i32,/u);
  assert.doesNotMatch(text, /    pub(?:\(crate\))? value: i32,/u);
  assert.match(text, /fn exact_secret_hidden\(self: alloc::rc::Rc<Self>\) -> i32/u);
  assert.doesNotMatch(text, /pub fn (?:exact_secret_hidden|hidden)\(/u);
  assert.match(text, /fn dispatch_secret_reveal\(self: alloc::rc::Rc<Self>\) -> i32/u);
  validateGeneratedProject("backend-private-members", result.artifacts);
});

test("binary entry modules are emitted through the structured Rust AST", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "structured_main" } },
    files: {
      "index.ts": `
export function main(): void {}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/main.rs"),
    /fn main\(\) \{\n    structured_main::initialize\(\);\n\}/u,
  );
  validateGeneratedProject("backend-structured-main", result.artifacts, { run: true });
});

test("binary entry selection uses the exact project-root path rather than a matching basename", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin", crateName: "exact_entry_path" } },
    files: {
      "dependency/index.ts": `
export function helper(): void {}
`,
      "index.ts": `
import { helper } from "./dependency/index.js";

export function main(): void {
  helper();
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/main.rs"),
    /exact_entry_path::initialize\(\);/u,
  );
  validateGeneratedProject("backend-exact-entry-path", result.artifacts, { run: true });
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
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  assert.match(
    artifactText(result, "src/main.rs"),
    /fn main\(\) -> Result<\(\), tsonic_rust_runtime::TsonicError> \{\n    fallible_main::initialize\(\)\?;\n    Ok::<\(\), tsonic_rust_runtime::TsonicError>\(\(\)\)\n\}/u,
  );
  validateGeneratedProject("backend-fallible-main", result.artifacts, { run: true });
});
