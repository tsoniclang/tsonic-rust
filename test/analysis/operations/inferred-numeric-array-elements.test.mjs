import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import {
  isRustVecCarrier,
  rustJsArrayLikeElementTargetType,
  rustSourcePrimitiveTargetType,
  rustSourceUnionTargetType,
} from "../../../dist/target-model/types/index.js";

const header = 'import type { FixedArray, float32, int32, int64, uint32 } from "@tsonic/core/types.js";\n';
const fractionalForms = ["[signed, unsigned, 0.5]", "[signed, 0.5, unsigned]", "[0.5, signed, unsigned]"];
const integerForms = ["[signed, 1]", "[1, signed]", "[signed, 1, 2]", "[1, signed, 2]", "[1, 2, signed]",
  "[signed, otherSigned, 1]", "[signed, 1, otherSigned]", "[1, signed, otherSigned]"];

function bindings(program) {
  const result = new Map();
  const { ast } = program.source;
  const visit = node => {
    if (ast.is.IsVariableDeclaration(node)) {
      const initializer = ast.as.AsVariableDeclaration(node)?.Initializer;
      if (initializer !== undefined) result.set(ast.text(ast.name(node)), initializer);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return result;
}

function assertArray(program, initializers, name, primitive) {
  const node = initializers.get(name);
  const fact = node === undefined ? undefined : program.records.targetOperation.get(node);
  assert.equal(fact?.kind === "array-literal", true, `${name}: one admitted array operation, got ${fact?.kind ?? "absent"}`);
  assert.equal(rustTargetTypeRefEquals(fact.elementCarrier, rustSourcePrimitiveTargetType(primitive)), true,
    `${name}: exact native ${primitive} element`);
  assert.equal(Object.isFrozen(fact.contributions), true, `${name}: immutable ordered contributions`);
  const resultElement = isRustVecCarrier(fact.resultCarrier) ? fact.resultCarrier.element
    : rustJsArrayLikeElementTargetType(fact.resultCarrier);
  assert.equal(rustTargetTypeRefEquals(resultElement, fact.elementCarrier), true, `${name}: storage uses the selected element`);
  return fact;
}

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`C102 ${lane}: fractional permutations use every actual numeric contribution`, () => {
    const declarations = fractionalForms.map((form, index) => `const fraction${index} = ${form};`).join("\n");
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(signed: int32, unsigned: uint32): void { ${declarations} }
` } });
    const initializers = bindings(program);
    for (const index of fractionalForms.keys()) {
      const fact = assertArray(program, initializers, `fraction${index}`, "float64");
      assert.equal(fact.contributions.length, 3, `fraction${index}: every contribution retained`);
      for (const contribution of fact.contributions) {
        assert.equal(contribution.kind === "value" && contribution.carrier.name === "float64", true,
          `fraction${index}: final scalar conversion admitted once`);
      }
    }
  });

  test(`C102 ${lane}: all integer literal permutations retain their native peer width`, () => {
    const declarations = integerForms.map((form, index) => `const integer${index} = ${form};`).join("\n");
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(signed: int32, otherSigned: int32): void { ${declarations} }
` } });
    const initializers = bindings(program);
    for (const index of integerForms.keys()) assertArray(program, initializers, `integer${index}`, "int32");
  });

  test(`C102 ${lane}: wide, floating, contextual and spread carriers retain their existing owners`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(signed: int32, unsigned: uint32, wide: int64, narrow: float32, computed: number, values: number[]): void {
  const widePair = [wide, wide];
  const wideLiteral = [wide, 1];
  const explicit: number[] = [signed, unsigned];
  const spread = [1, ...values, 2];
  const suffix = [...values, 1, 2];
  const signedLiteral = [signed, -(1)];
  const parenthesized = [(1), signed];
  const negativeZero = [signed, -0];
  const computedFloat = [signed, computed];
  const literalBoundary = [signed, 2147483648];
  const nativeFloat32 = [narrow, 0.1];
  const tuple: [int32, int32] = [signed, signed];
  const fixed: FixedArray<int32, 2> = [signed, 1] as const;
  const empty: int32[] = [];
}
` } });
    const initializers = bindings(program);
    for (const name of ["widePair", "wideLiteral"]) assertArray(program, initializers, name, "int64");
    for (const name of ["explicit", "spread", "suffix", "negativeZero", "computedFloat", "literalBoundary"]) {
      assertArray(program, initializers, name, "float64");
    }
    for (const name of ["signedLiteral", "parenthesized", "empty"]) assertArray(program, initializers, name, "int32");
    assertArray(program, initializers, "nativeFloat32", "float32");
    assert.equal(program.records.targetOperation.get(initializers.get("tuple"))?.kind, "tuple-literal", "tuple keeps its own admission");
    const fixed = program.source.ast.as.AsAsExpression(initializers.get("fixed"))?.Expression;
    assert.equal(program.records.targetOperation.get(fixed)?.kind, "fixed-array-literal", "fixed array keeps its extent owner");
    const zero = program.source.ast.elements(initializers.get("negativeZero"))[1];
    const literal = program.records.literalValue.get(zero);
    assert.equal(literal?.numeric?.kind === "authored" && literal.numeric.token.negative &&
      literal.numeric.token.coefficient === 0n && Object.is(literal.number, -0), true, "negative zero retains canonical authored sign evidence");
  });

  test(`C102 ${lane}: genuine native width and heterogeneous unions do not become floating arrays`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(signed: int32, unsigned: uint32, wide: int64, flag: boolean, value: string): boolean {
  const narrowWide = [signed, wide];
  const heterogeneous = [value, flag];
  const absent: (int32 | null | undefined)[] = [signed, undefined, null];
  return narrowWide[0] === signed && narrowWide[1] === wide && heterogeneous[0] === value &&
    heterogeneous[1] === flag && absent[0] === signed && absent[1] === undefined && absent[2] === null;
}
` } });
    const initializers = bindings(program);
    for (const [name, names] of [["narrowWide", ["int32", "int64"]]]) {
      const fact = program.records.targetOperation.get(initializers.get(name));
      assert.equal(fact?.kind === "array-literal", true, `${name}: an array is admitted`);
      const leaves = rustUnionLeaves(fact.elementCarrier, program.typeDefinitions);
      assert.equal(leaves?.length, 2, `${name}: both exact checked union arms retained`);
      for (const primitive of names) assert.equal(leaves.some(leaf =>
        rustTargetTypeRefEquals(leaf.carrier, rustSourcePrimitiveTargetType(primitive))), true, `${name}: ${primitive} arm retained`);
    }
    const heterogeneous = program.records.targetOperation.get(initializers.get("heterogeneous"));
    assert.equal(heterogeneous?.kind === "array-literal" &&
      rustUnionLeaves(heterogeneous.elementCarrier, program.typeDefinitions)?.length === 2, true, "string and Boolean stay heterogeneous");
    const absent = program.records.targetOperation.get(initializers.get("absent"));
    assert.equal(absent?.kind === "array-literal" && absent.contributions.length === 3, true, "both nullish source forms keep one native absence lane");
  });

  test(`C102 ${lane}: incompatible integer peers are refused before publication without an invented floating carrier`, () => {
    for (const expression of ["[signed, unsigned]", "[signed, unsigned, 1]", "[signed, 1, unsigned]", "[1, signed, unsigned]"]) {
      const { result, source } = compileRust({ surfaces, files: { "index.ts": header +
        `export function inspect(signed: int32, unsigned: uint32) { const values = ${expression}; return values; }` } });
      assert.equal(result.artifacts.length, 0, `${expression}: no output from an unsupported native element set`);
      const issues = result.diagnostics.filter(issue => issue.category === "error");
      assert.equal(issues.length, 1, `${expression}: exactly one inference-owner refusal`);
      assert.equal(issues[0].code, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH", `${expression}: original array admission owner`);
      const range = source.ast.authoredRange(issues[0].sourceNode);
      const text = source.ast.getSourceText(source.ast.getSourceFile(issues[0].sourceNode));
      assert.equal(range.kind === "authored" && text.slice(range.start, range.end) === expression, true,
        `${expression}: exact aggregate source span`);
    }
  });

  test(`C102 ${lane}: omitted optional tuple keeps its existing exact initializer refusal`, () => {
    const { result, source } = compileRust({ surfaces, files: { "index.ts": header +
      "export function inspect(signed: int32): void { const tuple: [int32, int32?] = [signed]; }" } });
    assert.equal(result.artifacts.length, 0, "the original optional tuple remains unpublished");
    assert.deepEqual(result.diagnostics.map(({ code, message, evidence }) => ({ code, message, evidence })), [{
      code: "RUST_INITIALIZER_CARRIER_MISMATCH",
      message: "The initializer cannot be represented by the declaration's exact Rust carrier.",
      evidence: ["target.capability=rust.initializer-carrier"],
    }], "the exact existing tuple-owner refusal is not hidden by numeric array inference");
    const range = source.ast.authoredRange(result.diagnostics[0].sourceNode);
    const text = source.ast.getSourceText(source.ast.getSourceFile(result.diagnostics[0].sourceNode));
    assert.equal(range.kind === "authored" && text.slice(range.start, range.end) === "[signed]", true,
      "the unchanged refusal anchors to the omitted tuple initializer");
  });

  for (const [name, body, code] of [
    ["fractional integer destination", "export function invalid(): int32[] { return [0.5]; }", "RUST_INTEGER_LITERAL_NOT_EXACT"],
    ["out-of-range integer destination", "export function invalid(): int32[] { return [2147483648]; }", "RUST_INTEGER_LITERAL_NOT_EXACT"],
    ["mutable widening", "export function invalid(values: string[]): (string | number)[] { return values; }", "RUST_RETURN_CARRIER_MISMATCH"],
    ["non-Clone mutable references", 'import type { Mut } from "@tsonic/rust/types.js"; export function invalid(values: Mut<int32>[]): Mut<int32>[] { return [...values]; }', "RUST_CALLABLE_CONTRACT_CLOSURE_REJECTED"],
  ]) {
    test(`C102 ${lane}: ${name} remains refused without output`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": header + body } });
      assert.equal(result.artifacts.length, 0, `${name}: no target artifacts`);
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.category === "error" &&
        diagnostic.code === code), true, `${name}: precise existing owner refusal`);
      if (name === "non-Clone mutable references") {
        assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === code &&
          diagnostic.message === "A generated Rust operation requires an exact Rust Clone implementation that its exact target carrier does not provide."),
        true, "the native Clone obligation, not an unrelated error, refuses the spread");
      }
      if (name === "mutable widening") {
        assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === code &&
          diagnostic.message === "The returned source value cannot be represented by the callable's exact Rust return carrier."),
        true, "the existing mutable storage conversion is refused at its return owner");
      }
    });
  }

  test(`C102 ${lane}: fixed extent mismatch remains refused without output`, () => {
    let targetEntered = false;
    assert.throws(() => compileRust({ surfaces, files: { "index.ts": header +
      "export function invalid(): FixedArray<int32, 2> { return [1]; }" },
    compileTarget() { targetEntered = true; throw new Error("invalid fixed extent reached the target"); } }),
    /TypeScript diagnostics:[\s\S]*TS(?:2322|2741)[\s\S]*length/u, "checked fixed extent is rejected at the source boundary");
    assert.equal(targetEntered, false, "no target operation or output is published for a source extent mismatch");
  });

  test(`C102 ${lane}: erased aggregate bodies create no native facts or demands`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(): number {
  function erased(signed: int32, unsigned: uint32) { const neverSelected = [signed, unsigned, 0.5]; return neverSelected; }
  return 1;
}
` } });
    const initializer = bindings(program).get("neverSelected");
    assert.equal(initializer !== undefined, true, "the checked erased source remains available");
    assert.equal(program.records.runtimeCarrier.get(initializer) === undefined, true, "erased aggregate has no carrier");
    assert.equal(program.records.targetOperation.get(initializer) === undefined, true, "erased aggregate has no operation");
    for (const element of program.source.ast.elements(initializer)) {
      assert.equal(program.records.runtimeCarrier.get(element) === undefined, true, "erased element has no carrier demand");
    }
  });
}

test("C102 policy uses exact existing numeric and literal relations, not a synthetic promotion engine", async () => {
  const { selectRustInferredNumericArrayElement } = await import("../../../dist/policy/types/collections/array-elements.js");
  const select = (source, contributions) => selectRustInferredNumericArrayElement(source, contributions, []);
  const primitive = rustSourcePrimitiveTargetType;
  const signed = { carrier: primitive("int32"), literal: undefined };
  const unsigned = { carrier: primitive("uint32"), literal: undefined };
  const wide = { carrier: primitive("int64"), literal: undefined };
  const one = { carrier: primitive("float64"), literal: { form: "numeric", number: 1, integer: 1n,
    numeric: { kind: "authored", token: { coefficient: 1n, exponent: 0n, negative: false, decimalText: "1" } } } };
  const fraction = { carrier: primitive("float64"), literal: { form: "numeric", number: 0.5,
    numeric: { kind: "authored", token: { coefficient: 5n, exponent: -1n, negative: false, decimalText: "0.5" } } } };
  const zero = { carrier: primitive("float64"), literal: { form: "prefix-unary", number: -0, integer: 0n,
    numeric: { kind: "authored", token: { coefficient: 0n, exponent: 0n, negative: true, decimalText: "-0" } } } };
  for (const rows of [[signed, unsigned, fraction], [signed, fraction, unsigned], [fraction, signed, unsigned]]) {
    assert.equal(select(primitive("float64"), rows)?.name, "float64", "all actual fractional candidates considered together");
  }
  for (const rows of [[signed, one], [one, signed], [signed, one, one], [one, signed, one], [one, one, signed]]) {
    assert.equal(select(primitive("float64"), rows)?.name, "int32", "integer literal defaults cannot force a float");
  }
  assert.equal(select(primitive("float64"), [signed, unsigned, one]) === undefined, true, "a fitting integer literal cannot rescue incompatible integer peers through float64");
  assert.equal(select(primitive("float64"), [wide, fraction]) === undefined, true, "no lossy int64 to float64 inference");
  assert.equal(select(primitive("float64"), [wide, one])?.name, "int64", "wide peer and exact integer literal stay exact");
  assert.equal(select(primitive("float64"), [signed, zero])?.name, "float64", "negative zero keeps floating semantics");
  const genuine = rustSourceUnionTargetType("/src/index.ts", "NativePair", [], "generated", {
    kind: "physical", types: [signed.carrier, wide.carrier],
  });
  assert.equal(select(genuine, [signed, wide]) === undefined, true, "genuine checked native union stays with its owner");
  assert.equal(select(primitive("float64"), [signed, { carrier: primitive("float64"), literal: undefined }])?.name,
    "float64", "a genuine computed float64 remains a fixed contribution");
  assert.equal(select(primitive("float64"), [signed, { carrier: primitive("float64"), literal: {
    form: "numeric", number: 1, integer: 1n, numeric: { kind: "checked-float64", value: 1 },
  } }])?.name, "float64", "checked float64 metadata cannot become an adaptable authored integer");
  assert.equal(select(primitive("float64"), []) === undefined, true, "missing contributions are not invented");
  const narrow = { carrier: primitive("int8"), literal: undefined };
  const overflow = { ...one, literal: { ...one.literal, number: 200, integer: 200n,
    numeric: { kind: "authored", token: { coefficient: 200n, exponent: 0n, negative: false, decimalText: "200" } } } };
  assert.equal(select(primitive("float64"), [narrow, overflow])?.name, "float64",
    "an unconstrained boundary literal is not forced into the first native peer");
  assert.equal(selectRustInferredNumericArrayElement(primitive("float64"), [narrow, overflow], [primitive("int8")])?.name,
    "int8", "the actual destination selects canonical literal admission, not a speculative successful fit");
  assert.equal(selectRustInferredNumericArrayElement(primitive("float64"), [signed, one], [primitive("float64")])?.name,
    "float64", "an actual explicit floating destination remains authoritative");
  assert.equal(selectRustInferredNumericArrayElement(primitive("float64"), [signed, one],
    [primitive("int32"), primitive("float64")])?.name, "int32", "inconsistent demands cannot choose the first destination");
});

test("C102 unresolved source storage cannot publish a partial aggregate native domain", () => {
  const { program, source } = analyzeRust({ files: { "index.ts": header + `
export function inspect(signed: int32) { const values = [signed, 1]; return values; }
` } });
  const storage = createSourceStorageQuery(createTargetSourceProgram(source), program.sourceFiles, {
    maximumNodes: 1, maximumEdges: 262144, maximumSubjectRows: 1048576,
    maximumTransportRows: 4194304, maximumSteps: 33554432,
  });
  assert.equal(storage.failureReason() !== undefined, true, "actual checked storage is unresolved at its node budget");
  const records = createRustProgramRecordBuilder();
  const requiredRecords = [];
  const forbidden = new Proxy({}, { get() { throw new Error("aggregate inference must not inspect a partial native domain"); } });
  const participation = analyzeRustNativeParticipation({ ast: forbidden, storage, navigation: forbidden,
    producer: records.nativeParticipations, requiredRecords });
  assert.equal(participation.kind, "unresolved", "the original native-domain owner preserves unresolved input");
  assert.equal(participation.reason, storage.failureReason(), "the original exact failure is retained");
  assert.equal(requiredRecords.length, 0, "no aggregate or callable requirement escapes a partial source domain");
  assert.equal(Object.hasOwn(participation, "nodes"), false, "no partial native nodes become available");
});
