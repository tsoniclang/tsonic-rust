import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
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
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";

import { recordRustBindingPatternFacts } from "../../../dist/analysis/control-flow/binding-patterns.js";
import { resolveArrayLiteralCarrier } from "../../../dist/analysis/operations/array-literals.js";
import { selectRustFixedArrayElementAccess, selectRustFixedArrayLengthProperty } from "../../../dist/analysis/operations/collections/fixed-arrays.js";
import { resolveRustTargetTypeRef, resolveRustTargetTypeSyntax } from "../../../dist/analysis/source-evidence/types/resolution/source.js";
import { resolveRustTargetType } from "../../../dist/analysis/source-evidence/types/resolution/target.js";
import {
  rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustTargetConstInteger, rustTargetConstSafeInteger,
  rustVecTargetType, rustJsArrayTargetType, rustSourcePrimitiveTargetType, rustOptionTargetType,
  rustAbsenceTargetType, rustCallableTargetType, rustStringTargetType,
} from "../../../dist/target-model/types/index.js";
import { rustTupleTargetType } from "../../../dist/policy/types/collections/tuple-carrier.js";
import { selectRustSourceParameterBorrowCarrier } from "../../../dist/policy/ownership/source-parameter-contracts.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSpreadElementCarrier } from "../../../dist/target-model/operations/rest-assembly.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/carrier-syntax.js";
import { printRustType } from "../../../dist/print/source/types.js";
import { acmePlatformPackage, acmeTestingPackage, analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const element = Object.freeze({ kind: "source-primitive", name: "uint32" });
const integer = value => ({ kind: "integer", value: value.toString() });

test("binding defaults select the projected native context once before sealing normalization", () => {
  const pattern = {}, binding = {}, name = {}, initializer = {};
  const ast = {
    kindName: node => node === pattern ? "KindArrayBindingPattern"
      : node === binding ? "KindBindingElement" : "KindIdentifier",
    elements: node => node === pattern ? [binding] : [],
    name: node => node === binding ? name : undefined,
    is: { IsBindingElement: node => node === binding, IsVariableDeclaration: () => false,
      IsParameterDeclaration: () => false, IsPropertyDeclaration: () => false },
    as: { AsBindingElement: () => ({ Initializer: initializer }) },
  };
  for (const width of ["int32", "uint32", "int64", "uint64"]) {
    const value = rustSourcePrimitiveTargetType(width);
    for (const sourceCarrier of [rustVecTargetType(value), rustJsArrayTargetType(value),
      rustFixedArrayTargetType(value, 1), rustTupleTargetType([rustOptionTargetType(value)])]) {
      for (const admitsDefault of [true, false]) {
        const records = createRustProgramRecordBuilder();
        let resolutions = 0;
        const recorded = recordRustBindingPatternFacts(pattern, sourceCarrier, {
          ast, records, requiredRecords: [], setCarrier: () => {},
          resolveCarrier: () => assert.fail("binding defaults must not select an uncontextualized initializer type"),
          resolveExpressionCarrier: (selected, expected) => {
            resolutions++;
            assert.equal(selected === initializer, true, "exact initializer");
            assert.equal(rustTargetTypeRefEquals(expected, value), true, `${width} native projected context`);
            return admitsDefault ? value : undefined;
          },
        });
        assert.equal(recorded.kind, admitsDefault ? "recorded" : "unresolved", "the exact recorded versus missing-proof outcome is preserved");
        assert.equal(resolutions, 1, "one contextual initializer resolution");
        const projection = records.bindingProjection.get(binding);
        assert.equal(projection !== undefined, admitsDefault, "rejected defaults cannot publish projection facts");
        if (admitsDefault) assert.equal(rustTargetTypeRefEquals(projection.bindingCarrier, value), true);
      }
    }
  }
});

test("pure-absence binding defaults infer one present initializer without an absence context", () => {
  const pattern = {}, binding = {}, name = {}, initializer = {};
  const ast = {
    kindName: node => node === pattern ? "KindArrayBindingPattern"
      : node === binding ? "KindBindingElement" : "KindIdentifier",
    elements: node => node === pattern ? [binding] : [],
    name: node => node === binding ? name : undefined,
    is: { IsBindingElement: node => node === binding, IsVariableDeclaration: () => false,
      IsParameterDeclaration: () => false, IsPropertyDeclaration: () => false },
    as: { AsBindingElement: () => ({ Initializer: initializer }) },
  };
  for (const value of [rustSourcePrimitiveTargetType("int64"),
    rustCallableTargetType([], rustSourcePrimitiveTargetType("int32"))]) {
    for (const admitsDefault of [true, false]) {
      const records = createRustProgramRecordBuilder();
      let resolutions = 0;
      const recorded = recordRustBindingPatternFacts(pattern, rustTupleTargetType([rustAbsenceTargetType()]), {
        ast, records, requiredRecords: [], setCarrier: () => {},
        resolveCarrier: () => assert.fail("the exact initializer must resolve only once"),
        resolveExpressionCarrier: (selected, expected) => {
          resolutions++;
          assert.equal(selected === initializer, true);
          assert.equal(expected === undefined, true, "absence has no contextual payload");
          return admitsDefault ? value : undefined;
        },
      });
      assert.equal(recorded.kind, admitsDefault ? "recorded" : "unresolved", "the exact recorded versus missing-proof outcome is preserved");
      assert.equal(resolutions, 1);
      const projection = records.bindingProjection.get(binding);
      assert.equal(projection !== undefined, admitsDefault);
      if (admitsDefault) assert.equal(rustTargetTypeRefEquals(projection.bindingCarrier, value), true);
    }
  }
});

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
    ast: { kind: () => undefined, getSourceFile: () => undefined, is: {
      IsTypeQueryNode: () => false, IsIndexedAccessTypeNode: () => false,
    } },
    source: { sourceFacts },
    records: createRustProgramRecordBuilder(),
    extensionId: "tsonic.rust.policy",
    currentSemantics: {
      facts: { typeSubjects: () => [] },
      declarations: {
        typeAliasSymbol: () => undefined,
        typeSymbol: type => argumentsByType.has(type) ? arraySymbol : type === elementSourceType ? elementSymbol : undefined,
        symbolDeclarations: () => [],
      },
      types: {
        isNonPrimitive: () => false,
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
    const records = createRustProgramRecordBuilder();
    const requiredRecords = [];
    const carriers = new Map();
    const sourceCarrier = rustFixedArrayTargetType(element, integer(length));
    const remainder = rustFixedArrayTargetType(element, integer(length - 1n));
    assert.equal(recordRustBindingPatternFacts(pattern, sourceCarrier, {
      ast, records, requiredRecords, setCarrier: (subject, carrier) => carriers.set(subject, carrier),
    }).kind, "recorded", "the same exact fixed-array binding is recorded");
    assert.deepEqual(carriers.get(firstName), element);
    assert.deepEqual(carriers.get(restName), remainder);
    assert.deepEqual(records.bindingProjection.get(rest), {
      sourceCarrier, projectedCarrier: remainder, storageCarrier: remainder, bindingCarrier: remainder,
      projection: { kind: "fixed-array-rest", start: 1 }, normalization: "identity",
    });
    // The planner renders the projection analysis sealed for a compiled destructuring of the same extent.
    const { result } = compileRust({ files: { "index.ts": `import type { FixedArray, uint32 } from "@tsonic/core/types.js";
export function split(values: FixedArray<uint32, ${length}n>): uint32 {
  const [first, ...rest] = values;
  return first + rest[0];
}
` } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/index.rs");
    const binding = output.match(/let (\w+) = values;/u)?.[1];
    assert.equal(binding !== undefined, true, "the destructured source is evaluated once");
    assert.match(output, new RegExp(`let first: u32 = ${binding}\\[0\\];`, "u"));
    assert.match(output, new RegExp(`let rest: \\[u32; ${length - 1n}\\] = ${binding}\\[1\\.\\.${length}\\]\\s*` +
      `\\.try_into\\(\\)\\s*\\.expect\\("validated fixed-array destructuring length"\\);`, "u"));
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
    const walk = { context: { ast: { elements: () => [] }, diagnostics }, rejectedExpressions: new Set(), resolving: new Set() };
    assert.equal(resolveArrayLiteralCarrier(walk, expression, {}, rustFixedArrayTargetType(element, integer(length))), undefined);
    assert.deepEqual(diagnostics.map(({ code, message }) => ({ code, message })), [{
      code: "RUST_FIXED_ARRAY_LITERAL_LENGTH_MISMATCH",
      message: `Fixed-array literal has 0 elements, but its exact extent is ${length}.`,
    }]);
  }
  const diagnostics = [];
  const records = createRustProgramRecordBuilder();
  const zero = rustFixedArrayTargetType(element, integer(0n));
  assert.deepEqual(resolveArrayLiteralCarrier({ context: { ast: { elements: () => [] }, diagnostics, records, requiredRecords: [] } },
    expression, {}, zero), zero);
  assertNoTargetDiagnostics(diagnostics);
  assert.deepEqual(records.runtimeCarrier.get(expression)?.carrier, zero);
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
      main();
      `,
    },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /\[i32; 3\]/u);
  assert.match(output, /values\.len\(\) != 3/u);
  assert.doesNotMatch(output, /usize_to_(?:i32|f64)\(values\.len\(\)\)/u);
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
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn left\(values: \[i32; 9007199254740992\]\)/u);
  assert.match(output, /pub fn right\(values: \[i32; 9007199254740993\]\)/u);
  assert.match(output, /values\[0\]/u);
  assert.doesNotMatch(output, /usize_to_i32|as f64/u);
});

test("fixed-array ordinals preserve exact native integers beyond floating precision", () => {
  const { result } = compileRust({ files: { "index.ts": `
    import type { FixedArray, int32 } from "@tsonic/core/types.js";
    export function last(values: FixedArray<int32, 9007199254740994n>): int32 {
      return values[9007199254740993];
    }
  ` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /values\[9007199254740993\]/u);
  assert.doesNotMatch(output, /values\[9007199254740992\]|i32_to_usize|as f64/u);
});

test("fixed-array ordinal validation rejects inconsistent and malformed checker evidence", () => {
  const expression = Object.freeze({});
  const argument = Object.freeze({});
  const carrier = rustFixedArrayTargetType(element, integer(2));
  const context = {
    extensionId: "tsonic.rust.policy",
    ast: {
      kindName: () => "KindNumericLiteral",
      is: { IsParenthesizedExpression: () => false, IsPrefixUnaryExpression: () => false },
      authoredRange: () => ({ kind: "synthetic" }),
      text: () => "1",
    },
  };
  for (const selected of [NaN, Infinity, -Infinity, 0.5, -1, 0, 2, 9007199254740992]) {
    const result = selectRustFixedArrayElementAccess({ expression, argument,
      sourceSelectedElementIndex: selected }, carrier, context, {});
    assert.equal(result.kind, "reject", String(selected));
    assert.equal(result.diagnostic.extensionCode, "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN");
    assert.equal(result.diagnostic.nodeOrSpan, expression);
  }
});

test("fixed-array literals reject out-of-range ordinals and noninteger dynamic indices", () => {
  for (const [index, code] of [
    ["-1", "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN"],
    ["2", "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN"],
    ["9007199254740993", "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN"],
    ["1.5", "RUST_INTEGER_LITERAL_NOT_EXACT"],
  ]) {
    const { result } = compileRust({ files: { "index.ts": `
      import type { FixedArray, int32 } from "@tsonic/core/types.js";
      export function select(values: FixedArray<string, 2>, index: int32): string {
        return values[${index}];
      }
    ` } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code),
      `${index}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.artifacts.length, 0);
  }
});

test("fixed-array formal borrowing requires the exact non-Copy native input lane", () => {
  const value = rustFixedArrayTargetType(rustStringTargetType(), 2);
  const selected = selectRustSourceParameterBorrowCarrier(value, value);
  assert.equal(selected?.kind === "reference" && selected.mutable === false &&
    rustTargetTypeRefEquals(selected.referent, value), true,
  "a readonly native affine array uses a reference to that exact extent and element carrier");
  for (const [label, base, lane] of [
    ["Copy array keeps its existing native value ABI", rustFixedArrayTargetType(element, 2), rustFixedArrayTargetType(element, 2)],
    ["missing selected input is not invented", value, undefined],
    ["different exact extent cannot borrow this input", value, rustFixedArrayTargetType(rustStringTargetType(), 3)],
    ["different element carrier cannot borrow this input", value, rustFixedArrayTargetType(element, 2)],
    ["an already borrowed lane is not reinterpreted", value, { kind: "reference", referent: value, mutable: false }],
  ]) assert.equal(selectRustSourceParameterBorrowCarrier(base, lane) === undefined, true, label);
});

test("fixed-array formal borrowing preserves whole-value retention, writes and captures", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { FixedArray, int32 } from "@tsonic/core/types.js";
export function read(values: FixedArray<string, 2>, index: int32): string { return values[index]; }
export function own(values: FixedArray<string, 2>): FixedArray<string, 2> { return values; }
export function replace(values: FixedArray<string, 2>, replacement: FixedArray<string, 2>): FixedArray<string, 2> {
  values = replacement;
  return values;
}
export function write(values: FixedArray<string, 2>, value: string): string {
  values[0] = value;
  return values[0];
}
export function capture(values: FixedArray<string, 2>): () => string { return () => values[0]; }
` } });
  const { ast } = program.source;
  const selected = new Map();
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) {
      const name = ast.text(ast.name(node));
      if (["read", "own", "replace", "write", "capture"].includes(name)) {
        selected.set(name, program.records.sourceParameterAbi.get(ast.parameters(node)[0]));
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected.size, 5, "all five original checked source formals publish their own ABI");
  for (const [name, mode] of [["read", "ref"], ["own", "value"], ["replace", "value"], ["write", "value"], ["capture", "value"]]) {
    const abi = selected.get(name);
    assert.equal(abi?.mode === mode, true, `${name}: only the actual nonretaining readonly formal borrows`);
    assert.equal(rustFixedArrayCarrierValue(abi?.valueCarrier)?.length.value === "2", true,
      `${name}: the body retains its exact native array value carrier`);
    assert.equal(mode === "ref"
      ? abi.parameterCarrier.kind === "reference" && abi.parameterCarrier.mutable === false &&
        rustTargetTypeRefEquals(abi.parameterCarrier.referent, abi.valueCarrier)
      : rustTargetTypeRefEquals(abi.parameterCarrier, abi.valueCarrier), true,
    `${name}: the physical input implements the completed checked ownership obligation`);
  }
});

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`fixed-array dynamic String reads use their actual native Clone contract (${surface})`, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "fixed_array_dynamic_string" } },
      files: { "index.ts": `
import type { FixedArray, int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
export function select(values: FixedArray<string, 2>, index: int32): string { return values[index]; }
export function main(): void {
  const values: FixedArray<string, 2> = ["first", "second"] as const;
  check(select(values, 1 as int32) === "second");
  check(select(values, 0 as int32) === "first");
}
main();
` } });
    assertNoTargetDiagnostics(result.diagnostics);
    const generated = artifactText(result, "src/index.rs");
    assert.match(generated, /fn select\(/u, "the actual dynamic native index callable is retained");
    assert.match(generated, /\]\.clone\(\)/u, "an owned non-Copy String result uses its real native Clone operation");
    assert.doesNotMatch(generated, /values\.clone\(\)|Box::|unsafe\s*\{/u,
      "selecting one owned String never clones its whole array or invents a dynamic storage owner");
    validateGeneratedProject(`fixed-array-dynamic-string-${surface}`, result.artifacts, { run: true });
  });

  test(`fixed-array dynamic owned reads retain the actual non-Clone refusal (${surface})`, () => {
    const { result } = compileRust({ surfaces, packages: [acmePlatformPackage()], files: { "index.ts": `
import type { FixedArray, int32 } from "@tsonic/core/types.js";
import { Store } from "@acme/platform";
export function select(values: FixedArray<Store, 2>, index: int32): Store { return values[index]; }
` } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_UNSUPPORTED_AST" &&
      diagnostic.message === "A provider index read requires an exact Copy or Clone result-carrier contract. Node kind: KindElementAccessExpression." &&
      diagnostic.evidence?.includes("target.capability=rust.backend.provider-index-read-ownership")), true,
      result.diagnostics.slice(0, 4).map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("; "));
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      "a non-Clone native element cannot become an owned result through a borrowed array index");
  });
}

for (const length of ["2n", "9007199254740993n"]) {
  for (const [name, expression] of [["direct", "values.length"], ["inferred", "inferred(values).length"]]) {
    test(`${name} bigint fixed-array length ${length} retains its exact native extent`, () => {
      const { result } = compileRust({ files: { "index.ts": `
        import type { FixedArray, int32 } from "@tsonic/core/types.js";
        function inferred(values: FixedArray<int32, ${length}>) { return values; }
        export function length(values: FixedArray<int32, ${length}>) { return ${expression}; }
      ` } });
      assertNoTargetDiagnostics(result.diagnostics);
      const output = artifactText(result, "src/index.rs");
      assert.match(output, /pub fn length\(values: \[i32; \d+\]\) -> usize/u);
      assert.match(output, /\.len\(\)/u);
      assert.doesNotMatch(output, /usize_to_i32|usize_to_f64|as f64/u);
    });
  }
}

test("numeric fixed-array length beyond int32 is not artificially narrowed", () => {
  const { result } = compileRust({ files: { "index.ts": `
    import type { FixedArray, int32, nativeUint } from "@tsonic/core/types.js";
    export function length(values: FixedArray<int32, 2147483648>): nativeUint { return values.length; }
  ` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /-> usize/u);
  assert.match(output, /\.len\(\)/u);
  assert.doesNotMatch(output, /usize_to_i32|usize_to_f64|as f64/u);
});
