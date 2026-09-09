import assert from "node:assert/strict";
import { test } from "node:test";
import { providerVirtualDeclarationFactKey, sourcePrimitiveFactKey } from "@tsonic/tsts";
import {
  tsonicCoreProviderVersion,
  tsonicCoreTypesModule,
  tsonicCoreVirtualModulesProviderId,
  tsonicFixedArrayFactKey,
  tsonicFixedArrayProviderIds,
} from "@tsonic/source-core/facts";
import { createRustPlanBuilder } from "../../../dist/analysis/facts/plan-store.js";
import { rustBindingProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
import { recordRustBindingPatternFacts } from "../../../dist/analysis/control-flow/binding-patterns.js";
import { resolveArrayLiteralCarrier } from "../../../dist/analysis/operations/inputs.js";
import { selectRustFixedArrayLengthProperty } from "../../../dist/analysis/operations/provider/structural-properties.js";
import {
  resolveRustTargetTypeRef,
  resolveRustTargetTypeSyntax,
} from "../../../dist/policy/types/resolution/source.js";
import { resolveRustTargetType } from "../../../dist/policy/types/resolution/target.js";
import {
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustTargetConstInteger,
  rustTargetConstSafeInteger,
} from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSpreadElementCarrier } from "../../../dist/target-model/operations/rest-assembly.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/render.js";
import { planRustBindingPattern } from "../../../dist/backend/planner/bindings/patterns.js";
import { printRustType } from "../../../dist/print/source/types.js";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const element = Object.freeze({ kind: "source-primitive", name: "uint32" });
const integer = value => ({ kind: "integer", value: value.toString() });

function fixedArraySourceFixture() {
  const elementSourceType = Object.freeze({});
  const elementSymbol = Object.freeze({});
  const arraySymbol = Object.freeze({});
  const argumentsByType = new Map();
  const lengths = new Map();
  const authoredFacts = new Map();
  const identity = Object.freeze({
    providerId: tsonicCoreVirtualModulesProviderId,
    providerVersion: tsonicCoreProviderVersion,
    providerModuleId: tsonicCoreTypesModule,
    moduleSpecifier: tsonicCoreTypesModule,
    exportId: tsonicFixedArrayProviderIds.exportId,
    exportName: tsonicFixedArrayProviderIds.exportId,
  });
  const sourceFacts = {
    getFact(subject, key) {
      if (key === tsonicFixedArrayFactKey) return authoredFacts.get(subject);
      if (subject === elementSymbol && key === sourcePrimitiveFactKey) return { kind: "uint32" };
      if (subject === arraySymbol && key === providerVirtualDeclarationFactKey) return identity;
      return undefined;
    },
  };
  const context = {
    ast: { kind: () => undefined, getSourceFile: () => undefined },
    source: { sourceFacts },
    facts: createRustPlanBuilder(sourceFacts),
    extensionId: "tsonic.rust.policy",
    currentSemantics: {
      facts: { typeSubjects: () => [] },
      declarations: {
        typeAliasSymbol: () => undefined,
        typeSymbol: type => argumentsByType.has(type) ? arraySymbol : type === elementSourceType ? elementSymbol : undefined,
        symbolDeclarations: () => [],
      },
      types: {
        isTypeReference: type => argumentsByType.has(type),
        typeReferenceTarget: () => undefined,
        typeArguments: type => argumentsByType.get(type) ?? [],
        numericLiteralValue: type => lengths.get(type),
      },
    },
  };
  const arrayType = (length, selectedElement = elementSourceType) => {
    const sourceType = Object.freeze({});
    const lengthType = Object.freeze({});
    lengths.set(lengthType, length);
    argumentsByType.set(sourceType, [selectedElement, lengthType]);
    return sourceType;
  };
  return { context, arrayType, elementSourceType, argumentsByType, authoredFacts };
}

test("fixed-array extents stay exact across the number boundary and native rendering", () => {
  const extents = [0n, 3n, 9007199254740991n, 9007199254740992n, 9007199254740993n, 18446744073709551616n];
  const carriers = extents.map(length => rustFixedArrayTargetType(element, integer(length)));
  for (const [index, length] of extents.entries()) {
    const carrier = carriers[index];
    assert.deepEqual(rustFixedArrayCarrierValue(carrier), { element, length: integer(length) });
    assert.equal(rustTargetConstInteger(integer(length)), length);
    assert.equal(printRustType(rustTypeFromCarrier(carrier)), `[u32; ${length}]`);
    if (index > 0) assert.equal(rustTargetTypeRefEquals(carriers[index - 1], carrier), false);
  }
  assert.equal(rustTargetConstSafeInteger(integer(9007199254740991n)), Number.MAX_SAFE_INTEGER);
  assert.equal(rustTargetConstSafeInteger(integer(9007199254740992n)), undefined);
  assert.equal(rustTargetConstSafeInteger(integer(-9007199254740991n)), Number.MIN_SAFE_INTEGER);
  assert.equal(rustTargetConstSafeInteger(integer(-9007199254740992n)), undefined);
  assert.equal(rustTargetConstInteger({ kind: "parameter", identity: "length", name: "Length" }), undefined);
  assert.deepEqual(rustFixedArrayTargetType(element, 3), rustFixedArrayTargetType(element, integer(3n)));
});

test("fixed-array spread selects finite ordinals against exact large extents", () => {
  const boundary = rustFixedArrayTargetType(element, integer(9007199254740991n));
  const larger = rustFixedArrayTargetType(element, integer(9007199254740993n));
  assert.equal(rustSpreadElementCarrier(boundary, Number.MAX_SAFE_INTEGER), undefined);
  assert.deepEqual(rustSpreadElementCarrier(larger, Number.MAX_SAFE_INTEGER), element);
  for (const index of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
    assert.equal(rustSpreadElementCarrier(larger, index), undefined);
  }
  assert.equal(rustSpreadElementCarrier(rustFixedArrayTargetType(element, 0), 0), undefined);
});

test("fixed-array destructuring retains exact remainder carriers and native slice bounds", () => {
  const pattern = Object.freeze({});
  const first = Object.freeze({});
  const rest = Object.freeze({});
  const firstName = Object.freeze({});
  const restName = Object.freeze({});
  const kinds = new Map([
    [pattern, "KindArrayBindingPattern"], [first, "KindBindingElement"],
    [rest, "KindBindingElement"], [firstName, "KindIdentifier"], [restName, "KindIdentifier"],
  ]);
  const ast = {
    kindName: node => kinds.get(node),
    elements: node => node === pattern ? [first, rest] : [],
    name: node => node === first ? firstName : node === rest ? restName : undefined,
    is: {
      IsBindingElement: node => node === first || node === rest,
      IsVariableDeclaration: () => false,
      IsParameterDeclaration: () => false,
      IsPropertyDeclaration: () => false,
    },
    as: { AsBindingElement: node => node === rest ? { DotDotDotToken: {} } : {} },
  };
  for (const length of [3n, 9007199254740992n, 9007199254740993n]) {
    const facts = createRustPlanBuilder({ getFact: () => undefined });
    const carriers = new Map();
    const sourceCarrier = rustFixedArrayTargetType(element, integer(length));
    const remainder = rustFixedArrayTargetType(element, integer(length - 1n));
    assert.equal(recordRustBindingPatternFacts(pattern, sourceCarrier, {
      ast, facts, setCarrier: (subject, carrier) => carriers.set(subject, carrier),
    }), true);
    assert.deepEqual(carriers.get(firstName), element);
    assert.deepEqual(carriers.get(restName), remainder);
    assert.deepEqual(facts.getFact(rest, rustBindingProjectionFactKey), {
      sourceCarrier, projectedCarrier: remainder, bindingCarrier: remainder,
      projection: { kind: "fixed-array-rest", start: 1 }, normalization: "identity",
    });
    const diagnostics = [];
    const source = { kind: "path", path: "values" };
    const statements = planRustBindingPattern(pattern, source, sourceCarrier, {
      diagnostics,
      input: { program: {
        source: { ast }, facts: facts.seal(),
        names: { nameForDeclaration: node => node === first ? "first" : "rest" },
      } },
    }, () => assert.fail("fixed-array rest must not reconstruct a source expression"));
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(statements?.[0]?.init, {
      kind: "index", receiver: source, index: { kind: "int-literal", text: "0" },
    });
    assert.equal(printRustType(statements?.[1]?.type), `[u32; ${length - 1n}]`);
    assert.deepEqual(statements?.[1]?.init, {
      kind: "method-call", method: "expect",
      args: [{ kind: "str-literal", value: "validated fixed-array destructuring length" }],
      receiver: {
        kind: "method-call", method: "try_into", args: [],
        receiver: {
          kind: "index", receiver: source,
          index: { kind: "range", start: { kind: "int-literal", text: "1" },
            end: { kind: "int-literal", text: length.toString() } },
        },
      },
    });
  }
});

test("syntax-free fixed-array facts retain selected element types and exact lengths", () => {
  const { context, arrayType, elementSourceType, argumentsByType, authoredFacts } = fixedArraySourceFixture();
  const sourceType = arrayType(9007199254740993n);
  const syntax = Object.freeze({});
  const fact = Object.freeze({
    sourceType,
    elementSourceType,
    length: 9007199254740993n,
    lengthRuntimeBase: "bigint",
  });
  authoredFacts.set(syntax, fact);
  assert.equal(context.source.sourceFacts.getFact(sourceType, tsonicFixedArrayFactKey), undefined);
  const options = { sourceTypes: { structuralObjectForType: () => undefined } };
  const expected = rustFixedArrayTargetType(element, integer(fact.length));
  assert.deepEqual(resolveRustTargetTypeRef(syntax, context, options), expected);
  assert.deepEqual(resolveRustTargetTypeRef(sourceType, context, options), expected);
  assert.deepEqual(resolveRustTargetTypeSyntax(syntax, context, options, new Set()), expected);
  assert.deepEqual(resolveRustTargetType(sourceType, context, options, new Set()), expected);
  const nestedType = arrayType(2, sourceType);
  assert.deepEqual(resolveRustTargetType(nestedType, context, options, new Set()),
    rustFixedArrayTargetType(expected, integer(2n)));
  const cyclicType = arrayType(0);
  argumentsByType.get(cyclicType)[0] = cyclicType;
  const resolving = new Set();
  assert.equal(resolveRustTargetType(cyclicType, context, options, resolving), undefined);
  assert.deepEqual([...resolving], []);
  assert.deepEqual(resolveRustTargetType(sourceType, context, options, resolving), expected);
  assert.equal(resolveRustTargetType(arrayType(-1), context, options, resolving), undefined);
  assert.deepEqual(resolveRustTargetType(elementSourceType, context, options, resolving), element);
});

test("fixed-array literal cardinality rejects exact mismatches without extent expansion", () => {
  const expression = Object.freeze({});
  for (const length of [3n, 9007199254740992n, 9007199254740993n]) {
    const diagnostics = [];
    const walk = { context: { ast: { elements: () => [] }, diagnostics } };
    assert.equal(resolveArrayLiteralCarrier(walk, expression, {}, rustFixedArrayTargetType(element, integer(length))), undefined);
    assert.deepEqual(diagnostics.map(({ code, message }) => ({ code, message })), [{
      code: "RUST_FIXED_ARRAY_LITERAL_LENGTH_MISMATCH",
      message: `Fixed-array literal has 0 elements, but its exact extent is ${length}.`,
    }]);
  }
  const diagnostics = [];
  const facts = createRustPlanBuilder({ getFact: () => undefined });
  const zero = rustFixedArrayTargetType(element, integer(0n));
  assert.deepEqual(resolveArrayLiteralCarrier({ context: { ast: { elements: () => [] }, diagnostics, facts } },
    expression, {}, zero), zero);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(facts.getRuntimeCarrierFact(expression)?.carrier, zero);
});

test("fixed-array length fails closed on missing, contradictory or writable selected evidence", () => {
  const { context, arrayType, elementSourceType } = fixedArraySourceFixture();
  const receiver = Object.freeze({});
  const expression = Object.freeze({});
  const sourceType = arrayType(3);
  const exactMessage = "The selected FixedArray.length access requires a source fixed-array fact whose exact extent agrees with its receiver carrier.";
  for (const [selectedType, carrier, accessMode, message] of [
    [undefined, rustFixedArrayTargetType(element, 3), "read", exactMessage],
    [elementSourceType, rustFixedArrayTargetType(element, 3), "read", exactMessage],
    [arrayType(-1), rustFixedArrayTargetType(element, 3), "read",
      "FixedArray<T, N> requires N to be one exact non-negative safe numeric or bigint literal type."],
    [sourceType, rustFixedArrayTargetType(element, 2), "read", exactMessage],
    [sourceType, rustFixedArrayTargetType(element, { kind: "parameter", identity: "length", name: "Length" }), "read", exactMessage],
    [sourceType, rustFixedArrayTargetType(element, 3), "write",
      "The selected FixedArray.length access requires one exact fixed-array receiver and readonly access."],
  ]) {
    const selected = selectRustFixedArrayLengthProperty({
      expression, receiver, sourceReceiverType: selectedType, accessMode,
    }, carrier, context, {});
    assert.equal(selected.kind, "reject");
    assert.equal(selected.diagnostic.extensionCode, "RUST_FIXED_ARRAY_LENGTH_NOT_CLOSED");
    assert.equal(selected.diagnostic.message, message);
    assert.equal(selected.diagnostic.nodeOrSpan, expression);
  }
});

test("numeric shared arrays preserve cross-file carriers, length, indexing and native iteration", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "values.ts": `
        import type { FixedArray, int32 } from "@tsonic/core/types.js";
        export type Values = FixedArray<int32, 3>;
        export function make(): Values {
          const values: Values = [2, 3, 4];
          return values;
        }
        export function nested(): FixedArray<Values, 2> {
          const values: FixedArray<Values, 2> = [[1, 2, 3], [4, 5, 6]];
          return values;
        }
        export function sum(values: Values): int32 {
          let total: int32 = 0;
          for (const value of values) total += value;
          return total;
        }
      `,
      "index.ts": `
        import { make, nested, sum } from "./values.js";
        import type { Values } from "./values.js";
        import type { int32 } from "@tsonic/core/types.js";
        export function main(): void {
          const values: Values = [2, 3, 4];
          const inferred = make();
          const matrix = nested();
          const index: int32 = 1;
          values[index] += 2;
          let finalKey = false;
          for (const key in values) if (key === "2") finalKey = true;
          if (values.length !== 3 || values[1] !== 5 || sum(values) !== 11 || !finalKey ||
              inferred.length !== 3 || make().length !== 3 || inferred[2] !== 4 ||
              matrix.length !== 2 || matrix[0].length !== 3 || matrix[1][2] !== 6) {
            throw new Error("numeric fixed-array contract");
          }
        }
      `,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /\[i32; 3\]/u);
  assert.match(output, /usize_to_i32\(values\.len\(\)\)/u);
  assert.match(output, /let for_in_length\w* = values\.len\(\);/u);
  assert.match(output, /0\.\.for_in_length/u);
  assert.doesNotMatch(output, /as f64|as i32/u);
  const declarations = artifactText(result, "src/values.rs");
  assert.match(declarations, /pub fn make\(\) -> \[i32; 3\]/u);
  assert.match(declarations, /pub fn nested\(\) -> \[\[i32; 3\]; 2\]/u);
  assert.equal(validateGeneratedProject("exact-numeric-fixed-arrays", result.artifacts, { run: true }).status, 0);
});

test("large fixed-array value types and finite indexes emit exact native extents without preflight rejection", () => {
  const { result } = compileRust({ files: { "index.ts": `
    import type { FixedArray, int32 } from "@tsonic/core/types.js";
    export function left(values: FixedArray<int32, 9007199254740992n>): int32 { return values[0]; }
    export function right(values: FixedArray<int32, 9007199254740993n>): int32 { return values[0]; }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn left\(values: \[i32; 9007199254740992\]\)/u);
  assert.match(output, /pub fn right\(values: \[i32; 9007199254740993\]\)/u);
  assert.match(output, /values\[rt::conversions::i32_to_usize\(0\)\?\]/u);
  assert.doesNotMatch(output, /usize_to_i32|as f64/u);
});

for (const length of ["2n", "9007199254740993n"]) {
  for (const [name, expression] of [["direct", "values.length"], ["inferred", "inferred(values).length"]]) {
    test(`${name} bigint fixed-array length ${length} rejects instead of selecting a number result`, () => {
      const { result } = compileRust({ files: { "index.ts": `
        import type { FixedArray, int32 } from "@tsonic/core/types.js";
        function inferred(values: FixedArray<int32, ${length}>) { return values; }
        export function length(values: FixedArray<int32, ${length}>): bigint { return ${expression}; }
      ` } });
      assert.ok(result.diagnostics.some(({ code, message }) => code === "RUST_FIXED_ARRAY_LENGTH_RUNTIME_BASE_UNSUPPORTED" &&
        message === "Rust FixedArray.length does not implement the selected bigint runtime result; numeric length conversion is not permitted."),
      JSON.stringify(result.diagnostics));
      assert.deepEqual(result.artifacts, []);
    });
  }
}

test("numeric fixed-array length beyond int32 rejects with its exact extent", () => {
  const { result } = compileRust({ files: { "index.ts": `
    import type { FixedArray, int32 } from "@tsonic/core/types.js";
    export function length(values: FixedArray<int32, 2147483648>): number { return values.length; }
  ` } });
  assert.ok(result.diagnostics.some(({ code, message }) => code === "RUST_FIXED_ARRAY_LENGTH_RANGE_UNSUPPORTED" &&
    message === "Rust FixedArray.length uses a checked int32 result; exact extent 2147483648 exceeds 2147483647."),
  JSON.stringify(result.diagnostics));
  assert.deepEqual(result.artifacts, []);
});
