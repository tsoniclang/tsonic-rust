import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/calls/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import {
  isRustVecCarrier,
  rustFixedArrayCarrierValue,
  rustJsArrayLikeElementTargetType,
  rustSourcePrimitiveTargetType,
  rustTargetConstInteger,
} from "../../../dist/target-model/types/index.js";

const header = 'import type { FixedArray, float32, int8, uint8, int16, uint16, int32, int64, uint32 } from "@tsonic/core/types.js";\n';
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
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
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
  const nativeFloat32 = [narrow, 0.5];
  const fractionalFloat64 = [narrow, 0.1];
  const tuple: [int32, int32] = [signed, signed];
  const heterogeneousTuple: [int32, string] = [signed, "tuple"];
  const fixed: FixedArray<int32, 2> = [signed, 1] as const;
  const empty: int32[] = [];
}
` } });
    const initializers = bindings(program);
    for (const name of ["widePair", "wideLiteral"]) assertArray(program, initializers, name, "int64");
    for (const name of ["explicit", "spread", "suffix", "negativeZero", "computedFloat", "literalBoundary", "fractionalFloat64"]) {
      assertArray(program, initializers, name, "float64");
    }
    for (const name of ["signedLiteral", "parenthesized", "empty"]) assertArray(program, initializers, name, "int32");
    assertArray(program, initializers, "nativeFloat32", "float32");
    const tuple = initializers.get("tuple");
    assert.equal(program.records.targetOperation.get(tuple)?.kind, "fixed-array-literal",
      "homogeneous source tuple keeps its canonical native fixed-array admission");
    const tupleCarrier = rustFixedArrayCarrierValue(program.records.runtimeCarrier.get(tuple)?.carrier);
    assert.equal(tupleCarrier !== undefined && rustTargetConstInteger(tupleCarrier.length) === 2n &&
      rustTargetTypeRefEquals(tupleCarrier.element, rustSourcePrimitiveTargetType("int32")), true,
      "source tuple retains exactly two native integers without floating inference");
    assert.equal(program.records.targetOperation.get(initializers.get("heterogeneousTuple"))?.kind, "tuple-literal",
      "heterogeneous tuple keeps its distinct native tuple admission");
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

  test(`C130 ${lane}: incompatible integer peers retain two physical arms and literal permutations retain three`, () => {
    for (const expression of ["[signed, unsigned]", "[unsigned, signed]", "[signed, unsigned, 1]", "[signed, 1, unsigned]", "[1, signed, unsigned]", "[signed, unsigned, ((1))]"]) {
      const { program, source } = analyzeRust({ surfaces, files: { "index.ts": header +
        `export function inspect(signed: int32, unsigned: uint32) { const values = ${expression}; return values; }` } });
      const initializer = bindings(program).get("values");
      const fact = program.records.targetOperation.get(initializer);
      assert.equal(fact?.kind, "array-literal", `${expression}: exact native aggregate admitted`);
      const names = expression.includes("1") ? ["int32", "uint32", "float64"] : ["int32", "uint32"];
      const leaves = rustUnionLeaves(fact.elementCarrier, program.typeDefinitions);
      assert.equal(leaves?.length, names.length, `${expression}: no peer collapsed and no arbitrary arm chosen`);
      for (const name of names) assert.equal(leaves.some(leaf =>
        rustTargetTypeRefEquals(leaf.carrier, rustSourcePrimitiveTargetType(name))), true, `${expression}: ${name} retained`);
      const semantics = createTargetSourceProgram(source).semantics.forNode(initializer);
      const sourceArray = semantics.types.expressionType(initializer);
      const elementType = semantics.types.typeArguments(sourceArray)[0];
      assert.equal(semantics.types.isUnion(elementType), false,
        `${expression}: physical evidence survives checked numeric coalescence without inventing a semantic union`);
    }
  });

  test(`C130 ${lane}: canonical integer tokens preserve all peer arms in every literal position`, () => {
    for (const literal of ["2147483648", "4294967296", "9007199254740992", "9007199254740994", "-4294967297",
      (1n << 200n).toString(), `0x${(1n << 200n).toString(16)}`]) {
      for (const expression of [`[signed, unsigned, ${literal}]`, `[signed, ${literal}, unsigned]`,
        `[${literal}, signed, unsigned]`, `[unsigned, signed, ${literal}]`, `[unsigned, ${literal}, signed]`,
        `[${literal}, unsigned, signed]`, `[signed, ${literal}, unsigned, ${literal}]`]) {
        const { program } = analyzeRust({ surfaces, files: { "index.ts": header +
          `export function inspect(signed: int32, unsigned: uint32) { const values = ${expression}; return values; }` } });
        const fact = program.records.targetOperation.get(bindings(program).get("values"));
        assert.equal(fact?.kind === "array-literal", true, `${expression}: complete native aggregate admitted`);
        const leaves = rustUnionLeaves(fact.elementCarrier, program.typeDefinitions);
        assert.equal(leaves?.length, 3, `${expression}: integer defaults cannot replace either fixed peer`);
        for (const name of ["int32", "uint32", "float64"]) assert.equal(leaves.some(leaf =>
          rustTargetTypeRefEquals(leaf.carrier, rustSourcePrimitiveTargetType(name))), true,
        `${expression}: exact ${name} physical payload retained`);
        assert.equal(fact.contributions.length, expression.split(",").length, `${expression}: no value or repetition disappears`);
      }
    }
  });

  test(`C130 ${lane}: canonical inexact integer arms fail before sealing without restricting explicit native floats`, () => {
    for (const literal of ["9007199254740993", "-9007199254740993", "1e100"]) {
      for (const expression of [`[signed, unsigned, ${literal}]`, `[signed, ${literal}, unsigned]`,
        `[${literal}, signed, unsigned]`, `[unsigned, signed, ${literal}]`, `[unsigned, ${literal}, signed]`,
        `[${literal}, unsigned, signed]`, `[signed, ${literal}]`, `[${literal}, signed]`,
        `[signed, unsigned, ${literal}, 0.5]`, `[signed, unsigned, ${literal}, computed]`]) {
        const files = { "index.ts": header +
          `export function inspect(signed: int32, unsigned: uint32, computed: number) { const values = ${expression}; return values; }` };
        const { result, source } = compileRust({ surfaces, files });
        const issues = result.diagnostics.filter(issue => issue.category === "error");
        assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
          `${expression}: invalid inference publishes no program, plan or output`);
        assert.equal(issues.length, 1, `${expression}: one canonical inference refusal`);
        assert.equal(issues[0].code, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH", "the existing numeric aggregate owner decides");
        assert.equal(issues[0].message,
          "An inferred numeric union requires an exact canonical carrier for every authored integer literal.");
        assert.deepEqual(issues[0].evidence, [], "no invented precision cap or target metadata");
        const range = source.ast.authoredRange(issues[0].sourceNode);
        assert.equal(range.kind === "authored" && range.start === files["index.ts"].indexOf(expression) &&
          range.end === range.start + expression.length, true, `${expression}: the exact original aggregate span`);
      }
    }
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(signed: int32, unsigned: uint32, wide: int64, computed: number): void {
  const explicit: number[] = [signed, unsigned, 9007199254740993];
  const wideLiteral = [wide, 9007199254740993];
  const signedZero = [signed, unsigned, -0];
  const realFraction = [signed, unsigned, 0.1];
  const actualFloating = [signed, unsigned, computed];
}
` } });
    const initializers = bindings(program);
    for (const name of ["explicit", "signedZero", "realFraction", "actualFloating"]) assertArray(program, initializers, name, "float64");
    assertArray(program, initializers, "wideLiteral", "int64");
  });

  test(`C130 ${lane}: every inferred nonnumeric and absence fallback refuses an inexact canonical integer`, () => {
    for (const literal of ["9007199254740993", "-9007199254740993", "1e100"]) {
      for (const other of ['"text"', "undefined", "true"]) {
        for (const expression of [`[${other}, ${literal}]`, `[${literal}, ${other}]`,
          `[signed, ${other}, ${literal}]`, `[${literal}, ${other}, signed]`,
          `[${other}, signed, ${literal}]`, `[signed, ${other}, ${literal}, 0.5]`]) {
          const files = { "index.ts": header +
            `export function inspect(signed: int32) { const values = ${expression}; return values; }` };
          const { result, source } = compileRust({ surfaces, files });
          const issues = result.diagnostics.filter(issue => issue.category === "error");
          assert.equal(issues.length, 1, `${expression}: one owning exactness refusal before another union path`);
          assert.equal(issues[0].code, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH", `${expression}: the same aggregate owner`);
          assert.equal(issues[0].message,
            "An inferred numeric union requires an exact canonical carrier for every authored integer literal.");
          assert.deepEqual(issues[0].evidence, [], "no invented integer cap, scalar conversion or fallback witness");
          const range = source.ast.authoredRange(issues[0].sourceNode);
          assert.equal(range.kind === "authored" && range.start === files["index.ts"].indexOf(expression) &&
            range.end === range.start + expression.length, true, `${expression}: the exact original array span`);
          assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
            `${expression}: no partial program, plan or native output`);
        }
      }
    }
  });

  test(`C130 ${lane}: exact heterogeneous arms and actual native floating destinations retain their existing admission`, () => {
    const literalForms = ["9007199254740992", "9007199254740994", (1n << 200n).toString(),
      `0x${(1n << 200n).toString(16)}`, "0.1", "-0"];
    const declarations = literalForms.flatMap((literal, index) => [
      `const exact${index} = ["text", ${literal}];`,
      `const reverse${index} = [${literal}, "text"];`,
      `const absent${index} = [undefined, ${literal}];`,
      `const absentReverse${index} = [${literal}, undefined];`,
    ]).join("\n");
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
function accept(values: (string | number)[]): void { }
export function inspect(wide: int64, computed: number): void {
  ${declarations}
  const explicit: (string | number)[] = ["text", 9007199254740993];
  const argument = ["text", 9007199254740993]; accept(argument);
  const fixedFloat = ["text", computed];
  const exactWide = [wide, 9007199254740993];
  const explicitScalar: number[] = [9007199254740993];
}
` } });
    const initializers = bindings(program);
    for (const name of [...literalForms.flatMap((_, index) =>
      [`exact${index}`, `reverse${index}`, `absent${index}`, `absentReverse${index}`]),
    "explicit", "argument", "fixedFloat"]) {
      const fact = program.records.targetOperation.get(initializers.get(name));
      assert.equal(fact?.kind === "array-literal" && fact.contributions.length === 2, true,
        `${name}: the existing complete native heterogeneous construction is still admitted`);
    }
    assertArray(program, initializers, "exactWide", "int64");
    assertArray(program, initializers, "explicitScalar", "float64");
  });

  test(`C130 ${lane}: genuine checked float32 and int64 unions retain their baseline native admission`, () => {
    for (const expression of ["[narrow, wide]", "[wide, narrow]"]) {
      const { program, source } = analyzeRust({ surfaces, files: { "index.ts": header +
        `export function inspect(narrow: float32, wide: int64) { const values = ${expression}; return values; }` } });
      const initializer = bindings(program).get("values");
      const semantics = createTargetSourceProgram(source).semantics.forNode(initializer);
      const sourceArray = semantics.types.expressionType(initializer);
      const sourceElement = semantics.types.typeArguments(sourceArray)[0];
      assert.equal(semantics.types.isUnion(sourceElement), true, `${expression}: actual checked members are already distinct`);
      const fact = program.records.targetOperation.get(initializer);
      assert.equal(fact?.kind === "array-literal", true, `${expression}: preserve the pinned accepted aggregate`);
      const leaves = rustUnionLeaves(fact.elementCarrier, program.typeDefinitions);
      assert.equal(leaves?.length, 2, `${expression}: keep both original native widths`);
      for (const name of ["float32", "int64"]) assert.equal(leaves.some(leaf =>
        rustTargetTypeRefEquals(leaf.carrier, rustSourcePrimitiveTargetType(name))), true, `${expression}: exact ${name} payload`);
    }
  });

  test(`C130 ${lane}: fixed float32 inference is lossless across native integer domains`, () => {
    for (const name of ["int32", "uint32"]) {
      for (const expression of ["[narrow, integer]", "[integer, narrow]"]) {
        const { result, source } = compileRust({ surfaces, files: { "index.ts": header +
          `export function inspect(narrow: float32, integer: ${name}) { const values = ${expression}; return values; }` } });
        const issues = result.diagnostics.filter(issue => issue.category === "error");
        assert.equal(result.artifacts.length, 0, `${name} ${expression}: no rounded native output`);
        assert.equal(issues.length, 1, `${name} ${expression}: one admission refusal`);
        assert.equal(issues[0].code, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH", "the numeric array owner refuses invalid inference");
        assert.equal(issues[0].message,
          "Array literal requires a lossless native element carrier for every fixed floating and numeric contribution.");
        const range = source.ast.authoredRange(issues[0].sourceNode);
        const text = source.ast.getSourceText(source.ast.getSourceFile(issues[0].sourceNode));
        assert.equal(range.kind === "authored" && text.slice(range.start, range.end) === expression, true,
          `${name} ${expression}: exact original aggregate span`);
      }
    }
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export function inspect(narrow: float32, tiny: int8, byte: uint8, short: int16, word: uint16, signed: int32, unsigned: uint32): void {
  const tinyPair = [narrow, tiny]; const bytePair = [byte, narrow];
  const shortPair = [narrow, short]; const wordPair = [word, narrow];
  const explicit: number[] = [narrow, signed, unsigned];
  const exact = [narrow, 0.5]; const fractional = [narrow, 0.1];
  const midpoint = [narrow, 1.000000059604644775390625];
  const neighbor = [narrow, 1.0000000000000000000000000000000000000001];
}
` } });
    const initializers = bindings(program);
    for (const name of ["tinyPair", "bytePair", "shortPair", "wordPair", "exact"]) assertArray(program, initializers, name, "float32");
    for (const name of ["explicit", "fractional", "midpoint", "neighbor"]) assertArray(program, initializers, name, "float64");
  });

  test(`C130 ${lane}: authored async, concise and nested returns retain their own array destination`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
export async function asynchronous(): Promise<float32[]> { const asynchronousValues = [1, 2]; return asynchronousValues; }
export async function asynchronousDirect(): Promise<float32[]> { return [1, 2]; }
export const concise = (): float32[] => [1, 2];
export function nested(): number[] {
  const callback = (): float32[] => { const innerValues = [1, 2]; return innerValues; };
  callback();
  const outerValues = [1, 2]; return outerValues;
}
` } });
    const initializers = bindings(program);
    for (const name of ["asynchronousValues", "innerValues"]) assertArray(program, initializers, name, "float32");
    assertArray(program, initializers, "outerValues", "float64");
    const concise = initializers.get("concise");
    const body = program.source.ast.body(concise);
    const operation = program.records.targetOperation.get(body);
    assert.equal(operation?.kind === "array-literal" && operation.elementCarrier.name === "float32", true,
      "a concise arrow uses its nearest authored callable result, not the enclosing function");
    let direct;
    const { ast } = program.source;
    const find = node => {
      if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "asynchronousDirect") {
        ast.forEachChild(ast.body(node), statement => {
          const expression = ast.as.AsReturnStatement(statement)?.Expression;
          if (expression !== undefined) direct = program.records.targetOperation.get(expression);
        });
      }
      ast.forEachChild(node, child => { if (child !== undefined) find(child); });
    };
    for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) find(file);
    assert.equal(direct?.kind === "array-literal" && direct.elementCarrier.name === "float32", true,
      "a directly returned array consumes the same native async output contract as an aliased return");
  });

  test(`C130 ${lane}: selected arguments and aliases retain actual unseeded native array destinations`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
type NativeValues = float32[];
function selected(values: NativeValues): NativeValues { return values; }
export function inspect(): NativeValues {
  const argumentValues = [1, 2];
  return selected(argumentValues);
}
export function alias(): NativeValues { const aliasValues = [1, 2]; return aliasValues; }
` } });
    const initializers = bindings(program);
    assertArray(program, initializers, "argumentValues", "float32");
    assertArray(program, initializers, "aliasValues", "float32");
  });

  test(`C130 ${lane}: inferred generic contexts never manufacture a floating array destination`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": header + `
function inferred<T>(values: T[]): void { }
function selected<T>(values: T[]): void { }
function callback<T>(read: () => T[]): void { read(); }
interface Receiver<T> { accept(values: T[]): void; }
export function inspect(signed: int32, unsigned: uint32, receiver: Receiver<float32>): void {
  const inferredValues = [signed, unsigned]; inferred(inferredValues);
  const explicitValues = [signed, unsigned]; selected<number>(explicitValues);
  const explicitNarrow = [16777217]; selected<float32>(explicitNarrow);
  const receiverValues = [16777217]; receiver.accept(receiverValues);
  callback(() => { const inferredCallbackValues = [signed, unsigned]; return inferredCallbackValues; });
  callback<float32>(() => { const explicitCallbackValues = [16777217]; return explicitCallbackValues; });
  const typedCallback: () => float32[] = () => { const typedCallbackValues = [16777217]; return typedCallbackValues; };
  typedCallback();
}
` } });
    const initializers = bindings(program);
    for (const name of ["inferredValues", "inferredCallbackValues"]) {
      const fact = program.records.targetOperation.get(initializers.get(name));
      assert.equal(fact?.kind === "array-literal", true, `${name}: the complete native aggregate remains admitted`);
      const leaves = rustUnionLeaves(fact.elementCarrier, program.typeDefinitions);
      assert.equal(leaves?.length, 2, `${name}: an inferred checked number cannot erase the two native integer arms`);
      for (const primitive of ["int32", "uint32"]) assert.equal(leaves.some(leaf =>
        rustTargetTypeRefEquals(leaf.carrier, rustSourcePrimitiveTargetType(primitive))), true,
      `${name}: retain the actual ${primitive} payload`);
    }
    assertArray(program, initializers, "explicitValues", "float64");
    for (const name of ["explicitNarrow", "receiverValues", "explicitCallbackValues", "typedCallbackValues"]) {
      assertArray(program, initializers, name, "float32");
    }
  });

  test(`C130 ${lane}: nonnumeric subtype reduction preserves final native admission`, () => {
    for (const declarations of [
      "class Base { value: number = 1; } class Derived extends Base { extra: number = 2; }",
      "interface Base { value: number; } interface Derived extends Base { extra: number; }",
    ]) {
      const classes = declarations.startsWith("class");
      const body = classes ? "[new Derived(), new Base()]" : "[derived, base]";
      const parameters = classes ? "" : "derived: Derived, base: Base";
      const { result } = compileRust({ surfaces, files: { "index.ts": header + declarations +
        `export function inspect(${parameters}) { const values = ${body}; return values; }` } });
      const issues = result.diagnostics.filter(issue => issue.category === "error");
      assert.equal(issues.length, 0, `${classes ? "class" : "interface"}: preserve the pinned native admission, never substitute another refusal`);
      assert.equal(result.program !== undefined && result.plan !== undefined, true, "the admitted subtype program is planned");
      assert.equal(result.artifacts.length, 3, "the complete accepted native project remains emitted");
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

test("C102 unresolved source storage cannot publish a partial aggregate native domain", () => {
  const { program, source } = analyzeRust({ files: { "index.ts": header + `
export function inspect(signed: int32) { const values = [signed, 1]; return values; }
` } });
  const storage = createSourceStorageQuery(createTargetSourceProgram(source), program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile), {
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
