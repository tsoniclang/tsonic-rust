import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { admitRustNativeValueDeclaration } from "../../../dist/analysis/declarations/native-value-declarations.js";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { selectRustBinaryOperator, selectRustCompoundAssignment } from "../../../dist/policy/operations/operators/rules.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { assertCsharpCompilationSucceeded, compileCsharpSource } from "../../../../tsonic-csharp/test/helpers/direct-csharp-session.mjs";
import { executeCsharpConstruction } from "../../../../tsonic-csharp/test/helpers/native-construction.mjs";

function enumDeclarations(source) {
  const file = source.sourceFiles.find(sourceFile => source.ast.getFileName(sourceFile) === "/src/index.ts");
  return source.ast.statements(file)
    .filter(declaration => source.ast.kindName(declaration) === "KindEnumDeclaration");
}

test("exact authored enum constants, explicit large successors and ordinary increments retain their native values", () => {
  const { result } = compileRust({ files: { "index.ts": `
export enum Exact { First = 9007199254740993, Next = 9007199254740994 }
export enum Ordinary { First = 7, Next }
` } });
  assert.equal(result.diagnostics.length, 0, "authored exact integer constants remain admitted");
  const generated = artifactText(result, "src/index.rs");
  assert.match(generated, /pub const First: Self = Self \{\s*value: 9007199254740993,?\s*\}/u, "the authored value does not round through Number");
  assert.match(generated, /pub const Next: Self = Self \{\s*value: 9007199254740994,?\s*\}/u, "the explicit large successor retains its exact native integer");
  assert.match(generated, /pub const Next: Self = Self \{\s*value: 8,?\s*\}/u, "a checker-coherent ordinary implicit increment remains supported");
});

test("source enum definitions retain the identical early completed values and common width", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export enum Narrow { Min = -2147483648, Max = 2147483647 }
export enum Wide { First = 2147483648, Next }
export enum Exact { First = 9007199254740993, Next = 9007199254740994 }
export enum Duplicate { First = 2147483648, Again = 2147483648 }
export enum Empty {}
export function read(): Wide { return Wide.First; }
` } });
  const expected = new Map([
    ["Narrow", [32, ["-2147483648", "2147483647"]]],
    ["Wide", [64, ["2147483648", "2147483649"]]],
    ["Exact", [64, ["9007199254740993", "9007199254740994"]]],
    ["Duplicate", [64, ["2147483648", "2147483648"]]],
    ["Empty", [32, []]],
  ]);
  for (const declaration of enumDeclarations(source)) {
    const name = source.ast.text(source.ast.name(declaration));
    const [width, values] = expected.get(name);
    const carrier = program.records.runtimeCarrier.get(declaration)?.carrier;
    assert.equal(carrier !== undefined, true, `${name}: early nominal carrier is published`);
    const form = program.nativeDeclarations.get(declaration);
    assert.equal(program.typeDefinitions.sourceEnumDefinition(carrier) === form, true,
      `${name}: late native emission reads the identical early definition`);
    assert.equal(form.integerWidth, width, `${name}: cached shared width`);
    assert.equal(Object.hasOwn(form, "representation"), false, `${name}: there is no competing physical form`);
    assert.deepEqual(form.variants.map(variant => variant.discriminant), values, `${name}: exact decimal constants`);
    assert.equal(Object.isFrozen(form) && Object.isFrozen(form.variants) &&
      form.variants.every(Object.isFrozen), true, `${name}: publication is recursively frozen without cloning source nodes`);
  }
  let selected;
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "source-enum-member") selected = fact;
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(source.getSourceFile("/src/index.ts"));
  assert.equal(selected !== undefined, true, "an actual source enum member operation is admitted");
  assert.equal(selected.enumRepresentation.kind, "integer", "source enums keep their numeric domain");
  assert.equal(selected.enumRepresentation.integerWidth, 64, "operations copy the completed native width");
});

test("enum constants and width are read once before any project physical type initialization", () => {
  const widthReads = new Map();
  const valueReads = new Map();
  let initialized = false;
  const { result } = compileRust({ files: { "index.ts": `
export enum Amount { First = 2147483648, Next }
export interface Entry { value: Amount; }
export function identity(value: Amount): Amount { return value; }
` }, compileTarget(request) {
    const context = analyzeRustCheckedContext(request, initial => {
      const constants = initial.source.semantics.enumConstants;
      const declarations = enumDeclarations(initial.source);
      const initialize = initial.projectTypes.initialize;
      const projectTypes = Object.create(initial.projectTypes, { initialize: { value(input) {
        for (const declaration of declarations) {
          const carrier = initial.records.runtimeCarrier.get(declaration)?.carrier;
          assert.equal(carrier !== undefined, true, "nominal enum evidence precedes class and interface layout");
          assert.equal(initial.typeDefinitions.sourceEnumDefinition(carrier)?.integerWidth, 64,
            "the actual early type registry already knows the native width");
        }
        initialized = true;
        return initialize(input);
      } } });
      return { ...initial,
        source: { ...initial.source, semantics: { ...initial.source.semantics, enumConstants: {
          ...constants,
          integerWidth(declaration) {
            assert.equal(initialized, false, "width is completed before physical type initialization");
            widthReads.set(declaration, (widthReads.get(declaration) ?? 0) + 1);
            return constants.integerWidth(declaration);
          },
          get(member) {
            assert.equal(initialized, false, "values are completed before physical type initialization");
            valueReads.set(member, (valueReads.get(member) ?? 0) + 1);
            return constants.get(member);
          },
        } } },
        projectTypes,
      };
    });
    return context.diagnostics.length === 0 ? { kind: "resolved", value: { artifacts: [] }, diagnostics: [] }
      : { kind: "rejected", diagnostics: context.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0, "early metadata preserves valid source admission");
  assert.equal(initialized, true, "the full real physical initializer ran");
  assert.deepEqual([...widthReads.values()], [1], "one shared cached width read per emitted enum");
  assert.deepEqual([...valueReads.values()], [1, 1], "one shared exact read per member");
});

test("the existing type registry publishes one frozen enum definition and rejects replacement writes", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = rustSourceTypeCarrier("/src/index.ts", "Empty", "enum");
  const definition = Object.freeze({ kind: "enum", name: "Empty", integerWidth: 32, variants: Object.freeze([]) });
  for (const representation of ["enum", "constants"]) {
    assert.equal(registry.registerSourceEnum(carrier, Object.freeze({ ...definition, representation })), false,
      `${representation}: the superseded physical-choice signature is rejected`);
  }
  assert.equal(registry.registerSourceEnum(carrier, definition), true, "sole producer writes once");
  assert.equal(registry.sourceEnumDefinition(carrier) === definition, true, "open readers retain exact identity");
  assert.equal(registry.registerSourceEnum(carrier, definition), false, "even an identical second write is refused");
  assert.equal(registry.registerSourceEnum(carrier, Object.freeze({ ...definition, integerWidth: 64 })), false,
    "a competing width never replaces the admitted definition");
  const sealed = registry.seal();
  assert.equal(sealed.sourceEnumDefinition(carrier) === definition, true, "sealed readers retain the same object");
  assert.equal(emptyRustTypeDefinitions.sourceEnumDefinition(carrier) === undefined, true,
    "the canonical empty metadata view exposes no enum definition");
  assert.throws(() => registry.registerSourceEnum(carrier, definition), /Rust type definitions are sealed/u,
    "the producer cannot write after publication");
});

test("late enum admission cannot re-evaluate names, constants, width or physical form", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": "export enum State { First = 1, Again = 1 }" } });
  const declaration = enumDeclarations(source)[0];
  const form = program.nativeDeclarations.get(declaration);
  const admitted = admitRustNativeValueDeclaration(declaration, { ast: source.ast, records: program.records,
    typeDefinitions: program.typeDefinitions, names: { nameForDeclaration() { throw new Error("late name decision"); } } },
    program.nativeDeclarations);
  assert.equal(admitted.kind, "accepted", "late admission consumes only completed enum evidence");
  assert.equal(admitted.form === form, true, "no replacement descriptor or second physical choice is introduced");
});

test("a checker-incoherent implicit successor rejects through the shared enum admission", () => {
  const { source, result } = compileRust({ files: { "index.ts": `
export enum Exact { First = 9007199254740993, Next }
` } });
  assert.equal(result.diagnostics.length, 1, "the original implicit source has one owning refusal");
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, "RUST_ENUM_CONSTANT_NOT_SUPPORTED", "the enum owner transports the shared R2 refusal");
  assert.equal(source.ast.kindName(diagnostic.sourceNode), "KindEnumMember", "the refusal identifies the actual enum member");
  assert.match(diagnostic.message, /exact value/u, "the shared reason preserves the exact native value");
  assert.match(diagnostic.message, /checker value/u, "the shared reason identifies the incompatible checker value");
  assert.match(diagnostic.message, /explicit/u, "the diagnostic gives the approved explicit-value alternative");
  assert.equal(result.artifacts?.length ?? 0, 0, "no incoherent enum reaches native publication");
});

for (const [label, expression] of [
  ["above i64", "9223372036854775808"],
  ["below i64", "-9223372036854775809"],
  ["fractional", "1.5"],
  ["string", '"text"'],
  ["nonintegral division", "1 / 2"],
]) {
  test(`${label} enum constants reject at their early owning diagnostic`, () => {
    const { result } = compileRust({ files: { "index.ts": `export enum Invalid { Member = ${expression} }` } });
    assert.equal(result.diagnostics.length, 1, `${label}: one source rejection`);
    assert.equal(result.diagnostics[0].code, "RUST_ENUM_CONSTANT_NOT_SUPPORTED", `${label}: enum owner rejects before sealing`);
    assert.equal(result.artifacts?.length ?? 0, 0, `${label}: no native output is published`);
  });
}

test("enum native layout and typed identities use the selected integer widths including an inhabited empty wrapper",
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ files: { "index.ts": `
export enum Empty {}
export enum Narrow { First = 1, Other = 2 }
export enum Duplicate { First = 1, Again = 1 }
export enum Wide { First = 2147483648, Other = 2147483649 }
export enum WideDuplicate { First = 2147483648, Again = 2147483648 }
export function emptyIdentity(value: Empty): Empty { return value; }
export function narrowIdentity(value: Narrow): Narrow { return value; }
export function duplicateIdentity(value: Duplicate): Duplicate { return value; }
export function wideIdentity(value: Wide): Wide { return value; }
export function wideDuplicateIdentity(value: WideDuplicate): WideDuplicate { return value; }
` } });
    assert.equal(result.diagnostics.length, 0, "typed enum declarations and identities remain admitted");
    const generated = artifactText(result, "src/index.rs");
    assert.match(generated, /pub struct Narrow\s*\{\s*value: i32,/u, "ordinary narrow enums preserve an open 32-bit nominal form");
    assert.match(generated, /pub struct Wide\s*\{\s*value: i64,/u, "ordinary wide enums preserve an open 64-bit nominal form");
    assert.match(generated, /pub struct Empty\s*\{\s*value: i32,/u, "empty enum reuses the existing inhabited wrapper");
    assert.match(generated, /pub struct Duplicate\s*\{\s*value: i32,/u, "narrow duplicates share the common 32-bit layout");
    assert.match(generated, /pub struct WideDuplicate\s*\{\s*value: i64,/u, "wide duplicates share the common 64-bit layout");
    const nativeControl = `
#[cfg(test)]
mod enum_layout_control {
    use super::*;

    #[test]
    fn exact_native_layout_and_identity_roundtrip() {
        assert_eq!(core::mem::size_of::<Empty>(), core::mem::size_of::<i32>());
        assert_eq!(core::mem::size_of::<Narrow>(), core::mem::size_of::<i32>());
        assert_eq!(core::mem::size_of::<Duplicate>(), core::mem::size_of::<i32>());
        assert_eq!(core::mem::size_of::<Wide>(), core::mem::size_of::<i64>());
        assert_eq!(core::mem::size_of::<WideDuplicate>(), core::mem::size_of::<i64>());
        for value in [i32::MIN, 0, i32::MAX] {
            assert_eq!(emptyIdentity(Empty { value }).value, value);
        }
        assert_eq!(narrowIdentity(Narrow::First).value, 1);
        assert_eq!(duplicateIdentity(Duplicate::Again).value, 1);
        assert_eq!(wideIdentity(Wide::First).value, 2147483648_i64);
        assert_eq!(wideDuplicateIdentity(WideDuplicate::Again).value, 2147483648_i64);
    }
}
`;
    const artifacts = result.artifacts.map(artifact => artifact.path === "src/index.rs"
      ? { ...artifact, text: artifact.text + nativeControl } : artifact);
    const project = writeGeneratedProject("enum-native-layout", artifacts);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt"]);
    runCargo(project, ["fmt", "--check"]);
    runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const native = runCargo(project, ["test", "--locked", "--offline"]);
    assert.match(native.stdout, /enum_layout_control::exact_native_layout_and_identity_roundtrip \.\.\. ok/u,
      "the exact generated carriers execute the native construction/cast/identity roundtrip");
  });

test("source enum bitwise policy preserves exact nominal identity without accepting numeric or foreign enum operands", () => {
  const flags = rustSourceTypeCarrier("/src/flags.ts", "Flags", "enum");
  const other = rustSourceTypeCarrier("/src/other.ts", "Flags", "enum");
  for (const operator of ["|", "&", "^"]) {
    const selected = selectRustBinaryOperator(operator, flags, flags);
    assert.equal(selected?.kind, "operator-token", `${operator}: direct native operation`);
    assert.equal(selected.resultCarrier === flags, true, `${operator}: no integer or float projection`);
    assert.equal(selected.leftConversion === undefined && selected.rightConversion === undefined, true,
      `${operator}: no operand coercions`);
    const compound = selectRustCompoundAssignment(`${operator}=`, flags, flags);
    assert.equal(compound?.kind, "operator-token", `${operator}=: direct native compound assignment`);
    assert.equal(compound.resultCarrier === flags, true, `${operator}=: exact mutable enum storage`);
    for (const peer of [other, rustSourcePrimitiveTargetType("int32"), rustSourcePrimitiveTargetType("float64")]) {
      assert.equal(selectRustBinaryOperator(operator, flags, peer) === undefined, true, `${operator}: foreign right operand`);
      assert.equal(selectRustBinaryOperator(operator, peer, flags) === undefined, true, `${operator}: foreign left operand`);
      assert.equal(selectRustCompoundAssignment(`${operator}=`, flags, peer) === undefined, true,
        `${operator}=: foreign right operand`);
    }
  }
});

const bitwiseEnumFiles = {
  "flags.ts": `
export enum Flags { First = 1, Second = 2 }
export enum Wide { First = 4294967296, Second = 8589934592 }
export enum Duplicate { First = 1, Again = 1, Second = 2 }
export interface Named { [Flags.First]: number; }
`,
  "index.ts": `
import { Flags, Wide, Duplicate } from "./flags.js";
export function combine(flag: boolean): Flags { return flag ? (Flags.First | Flags.Second) : Flags.First; }
export function conjunction(left: Flags, right: Flags): Flags { return left & right; }
export function exclusive(left: Flags, right: Flags): Flags { return left ^ right; }
export function complement(value: Flags): Flags { return ~value; }
export function wide(): Wide { return Wide.First | Wide.Second; }
export function duplicate(): Duplicate { return Duplicate.Again | Duplicate.Second; }
export function compound(value: Flags): Flags {
  let result: Flags = value;
  result |= Flags.Second;
  result &= ~Flags.Second;
  result ^= Flags.First;
  return result;
}
export function defaults(value: Flags): boolean {
  switch (value) { case Flags.First: return false; case Flags.Second: return false; default: return true; }
}
export function run(flag: boolean): boolean {
  const stored = flag ? (Flags.First | Flags.Second) : Flags.First;
  return stored === combine(flag) && defaults(stored) === flag &&
    conjunction(stored, Flags.First) === Flags.First &&
    exclusive(stored, Flags.Second) === (flag ? Flags.First : (Flags.First | Flags.Second)) &&
    complement(complement(stored)) === stored &&
    duplicate() === (Duplicate.First | Duplicate.Second) && wide() === (Wide.First | Wide.Second) &&
    compound(stored) === (((stored | Flags.Second) & ~Flags.Second) ^ Flags.First);
}
`,
};

function checkedEnumObservations(program) {
  const { ast, semantics } = program.source;
  const file = program.sourceFiles.find(source => ast.getFileName(source).endsWith("/flags.ts"));
  assert.equal(file !== undefined, true, "the identical cross-file enum owner is present");
  const constants = semantics.enumConstants;
  const values = ast.statements(file).filter(node => ast.is.IsEnumDeclaration(node)).flatMap(declaration =>
    ast.members(declaration).map(member => {
      const selected = constants.get(member);
      assert.equal(selected?.kind === "resolved" && typeof selected.value === "bigint", true,
        "each actual source member has one exact finite value");
      return [ast.text(ast.name(declaration)), ast.text(ast.name(member)), selected.value.toString()];
    }));
  const names = semantics.forFile(file).propertyNames;
  const computed = names.entries.filter(entry => ast.is.IsComputedPropertyName(entry.node));
  assert.equal(computed.length, 1, "one actual enum-member key is checked");
  assert.equal(computed[0].selection.kind, "resolved", "the key has a native name");
  assert.equal(computed[0].selection.name, "1", "the exact member value supplies key spelling");
  return { values, key: computed[0].selection.name };
}

for (const surface of ["native", "js"]) {
  test(`transparent source enum flags preserve open values, width, ABI and native costs across files (${surface})`,
    { timeout: 300_000 }, () => {
      const compiled = compileRust({ surfaces: surface === "native" ? [] : [surface],
        target: { id: "rust", options: { outputType: "lib", crateName: "source_enum_bitwise" } }, files: bitwiseEnumFiles });
      assert.equal(compiled.result.diagnostics.length, 0,
        compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
      assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true,
        "the original flags program reaches sealed native planning");
      const flagsText = artifactText(compiled.result, "src/flags.rs");
      assert.equal(/pub enum (Flags|Wide|Duplicate)\b/u.test(flagsText), false, "no closed source enum form survives");
      assert.equal((flagsText.match(/#\[repr\(transparent\)\]/gu) ?? []).length, 3, "all numeric source enums use one form");
      assert.match(flagsText, /pub struct Wide\s*\{\s*value: i64,/u, "wide flags retain the shared selected 64-bit carrier");
      for (const operation of ["BitOr", "BitAnd", "BitXor", "Not", "BitOrAssign", "BitAndAssign", "BitXorAssign"]) {
        assert.equal((flagsText.match(new RegExp(`impl core::ops::${operation} for`, "gu")) ?? []).length, 3,
          `${operation}: every enum has the native integer operation without a use-dependent ABI`);
      }
      const nativeControl = `
#[cfg(test)]
mod source_enum_bitwise_control {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[repr(transparent)]
    #[derive(Clone, Copy)]
    struct NativeFlags(i32);

    #[inline(never)]
    fn native_combine(flag: bool) -> NativeFlags {
        NativeFlags(if flag { 1 | 2 } else { 1 })
    }

    extern "C" fn native_abi(value: Flags) -> Flags { value }

    #[test]
    fn open_enum_values_abi_and_cost_match_native() {
        assert_eq!(core::mem::size_of::<Flags>(), core::mem::size_of::<i32>());
        assert_eq!(core::mem::align_of::<Flags>(), core::mem::align_of::<i32>());
        assert_eq!(core::mem::size_of::<Wide>(), core::mem::size_of::<i64>());
        assert_eq!(core::mem::align_of::<Wide>(), core::mem::align_of::<i64>());
        assert_eq!(core::mem::size_of::<Duplicate>(), core::mem::size_of::<i32>());
        assert_eq!(Flags::First.value, 1);
        assert_eq!(Flags::Second.value, 2);
        assert_eq!(Duplicate::Again.value, Duplicate::First.value);
        for flag in [false, true] {
            let (actual, actual_cost) = measure(|| crate::index::combine(std::hint::black_box(flag)));
            let (native, native_cost) = measure(|| native_combine(std::hint::black_box(flag)));
            assert_eq!(actual.value, native.0);
            assert_eq!(actual_cost, native_cost);
            assert_eq!(actual_cost, Cost::default());
            assert_eq!(native_abi(actual).value, native.0);
            assert_eq!(crate::index::defaults(actual), flag);
            assert_eq!(crate::index::compound(actual).value, ((native.0 | 2) & !2) ^ 1);
            assert!(crate::index::run(flag));
        }
        for original in [i32::MIN, -1, 0, 1, 2, 3, i32::MAX] {
            let value = Flags { value: original };
            let (actual, actual_cost) = measure(|| {
                let combined = value | Flags::Second;
                let masked = crate::index::conjunction(combined, Flags::First);
                let inverted = crate::index::complement(masked);
                crate::index::exclusive(inverted, Flags::Second)
            });
            let (native, native_cost) = measure(|| (!((original | 2) & 1)) ^ 2);
            assert_eq!(actual.value, native);
            assert_eq!(actual_cost, native_cost);
            assert_eq!(actual_cost, Cost::default());
        }
        assert_eq!(crate::index::wide().value, 4294967296_i64 | 8589934592_i64);
        assert_eq!((!Wide::First).value, !4294967296_i64);
        assert_eq!((Wide::First ^ Wide::Second).value, 4294967296_i64 ^ 8589934592_i64);
        assert_eq!((Wide::First & Wide::Second).value, 0);
        assert_eq!(crate::index::duplicate().value, 3);
    }
}
`;
      const artifacts = compiled.result.artifacts.map(artifact => artifact.path === "src/flags.rs"
        ? { ...artifact, text: artifact.text + nativeControl } : artifact);
      const project = writeGeneratedProject(`source-enum-bitwise-${surface}`, artifacts);
      const nativeLog = join(project, "native-enum-proof.log");
      for (const arguments_ of [
        ["generate-lockfile", "--offline"], ["fmt", "--all"], ["fmt", "--all", "--check"],
        ["check", "--all-targets", "--locked", "--offline"],
        ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"],
        ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"],
      ]) {
        const started = new Date();
        const native = runCargo(project, arguments_);
        appendFileSync(nativeLog, `${JSON.stringify({ command: ["cargo", ...arguments_], startedAt: started.toISOString(),
          finishedAt: new Date().toISOString(), durationSeconds: (Date.now() - started.getTime()) / 1000,
          exitCode: native.status })}\n${native.stdout}\n${native.stderr}\n`);
      }
      const csharp = compileCsharpSource({ surface: surface === "native" ? undefined : surface, projectRoot: "/src",
        sourceText: bitwiseEnumFiles["index.ts"], files: { "flags.ts": bitwiseEnumFiles["flags.ts"] } });
      assertCsharpCompilationSucceeded(csharp);
      const observedRust = checkedEnumObservations(compiled.result.program);
      const observedCsharp = checkedEnumObservations(csharp.result.program);
      assert.deepEqual(observedRust, observedCsharp, "both targets retain exact source member values and key spelling");
      const nativeCsharp = executeCsharpConstruction(csharp, `source-enum-bitwise-${surface}`, false, false, [], `
using Tsonic.Generated;
if (!Index.run(true) || !Index.run(false) || (int)Index.combine(true) != 3 || (int)Index.combine(false) != 1)
    throw new System.Exception("open enum flags/default arm");
if (sizeof(Flags) != sizeof(int) || sizeof(Wide) != sizeof(long) || sizeof(Duplicate) != sizeof(int))
    throw new System.Exception("shared enum width");
if ((long)Index.wide() != (4294967296L | 8589934592L) || (int)Index.duplicate() != 3)
    throw new System.Exception("wide and duplicate enum values");
for (int iteration = 0; iteration < 1000; iteration++) {
    _ = Index.combine(iteration % 2 == 0);
    _ = NativeCombine(iteration % 2 == 0);
}
long generatedStart = System.GC.GetAllocatedBytesForCurrentThread();
int generatedValue = 0;
for (int iteration = 0; iteration < 1000; iteration++) generatedValue += (int)Index.combine(iteration % 2 == 0);
long generatedBytes = System.GC.GetAllocatedBytesForCurrentThread() - generatedStart;
long nativeStart = System.GC.GetAllocatedBytesForCurrentThread();
int nativeValue = 0;
for (int iteration = 0; iteration < 1000; iteration++) nativeValue += (int)NativeCombine(iteration % 2 == 0);
long nativeBytes = System.GC.GetAllocatedBytesForCurrentThread() - nativeStart;
if (generatedValue != nativeValue || generatedBytes != nativeBytes || generatedBytes != 0)
    throw new System.Exception("native enum allocation cost");
System.Console.WriteLine($"SOURCE_ENUM_NATIVE_COST values={generatedValue}/{nativeValue} bytes={generatedBytes}/{nativeBytes}");
static Flags NativeCombine(bool flag) => (Flags)(flag ? 1 | 2 : 1);
`);
      appendFileSync(nativeLog, `CSHARP_NATIVE_PROOF\n${nativeCsharp}\n`);
      assert.match(nativeCsharp, /SOURCE_ENUM_NATIVE_COST values=2000\/2000 bytes=0\/0/u,
        "the actual generated C# enum operation has the identical zero-allocation native cost");
    });
}
