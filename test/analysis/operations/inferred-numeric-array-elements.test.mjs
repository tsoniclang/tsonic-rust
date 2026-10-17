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
  assert.equal(fact?.kind === "array-literal", true, `${name}: one admitted array operation`);
  assert.equal(rustTargetTypeRefEquals(fact.elementCarrier, rustSourcePrimitiveTargetType(primitive)), true,
    `${name}: exact native ${primitive} element`);
  assert.equal(Object.isFrozen(fact.contributions), true, `${name}: immutable ordered contributions`);
  const resultElement = fact.resultCarrier.kind === "vec" ? fact.resultCarrier.element
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
  const nativeFloat32 = [narrow, 0.1];
  const tuple: [int32, int32?] = [signed];
  const fixed: FixedArray<int32, 2n> = [signed, 1];
  const empty: int32[] = [];
}
` } });
    const initializers = bindings(program);
    for (const name of ["widePair", "wideLiteral"]) assertArray(program, initializers, name, "int64");
    for (const name of ["explicit", "spread", "suffix", "negativeZero", "computedFloat"]) {
      assertArray(program, initializers, name, "float64");
    }
    for (const name of ["signedLiteral", "parenthesized", "empty"]) assertArray(program, initializers, name, "int32");
    assertArray(program, initializers, "nativeFloat32", "float32");
    assert.equal(program.records.targetOperation.get(initializers.get("tuple"))?.kind, "tuple-literal", "tuple keeps its own admission");
    assert.equal(program.records.targetOperation.get(initializers.get("fixed"))?.kind, "fixed-array-literal", "fixed array keeps its extent owner");
    const zero = program.source.ast.elements(initializers.get("negativeZero"))[1];
    const literal = program.records.literalValue.get(zero);
    assert.equal(literal?.numeric?.kind === "authored" && literal.numeric.token.negative &&
      literal.numeric.token.coefficient === 0n && Object.is(literal.number, -0), true, "negative zero retains canonical authored sign evidence");
  });

  test(`C102 ${lane}: genuine native width and heterogeneous unions do not become floating arrays`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(signed: int32, unsigned: uint32, wide: int64, flag: boolean, value: string): void {
  const signedUnsigned = [signed, unsigned];
  const narrowWide = [signed, wide];
  const heterogeneous = [value, flag];
  const absent: (int32 | null | undefined)[] = [signed, undefined, null];
}
` } });
    const initializers = bindings(program);
    for (const [name, names] of [["signedUnsigned", ["int32", "uint32"]], ["narrowWide", ["int32", "int64"]]]) {
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

  for (const [name, body, code] of [
    ["fractional integer destination", "export function invalid(): int32[] { return [0.5]; }", "RUST_INTEGER_LITERAL_NOT_EXACT"],
    ["out-of-range integer destination", "export function invalid(): int32[] { return [2147483648]; }", "RUST_INTEGER_LITERAL_NOT_EXACT"],
    ["fixed extent mismatch", "export function invalid(): FixedArray<int32, 2n> { return [1]; }", "RUST_FIXED_ARRAY_LITERAL_LENGTH_MISMATCH"],
    ["mutable widening", "export function invalid(values: string[]): (string | number)[] { return values; }", undefined],
    ["non-Clone mutable references", 'import type { Mut } from "@tsonic/rust/types.js"; export function invalid(values: Mut<int32>[]): Mut<int32>[] { return [...values]; }', undefined],
  ]) {
    test(`C102 ${lane}: ${name} remains refused without output`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": header + body } });
      assert.equal(result.artifacts.length, 0, `${name}: no target artifacts`);
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.category === "error" &&
        (code === undefined || diagnostic.code === code)), true, `${name}: precise existing owner refusal`);
    });
  }

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
  const { selectRustInferredNumericArrayElement: select } = await import("../../../dist/policy/types/collections/array-elements.js");
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
  assert.equal(select(primitive("float64"), []) === undefined, true, "missing contributions are not invented");
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
