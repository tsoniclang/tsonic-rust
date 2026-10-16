import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { admitRustNativeValueDeclaration } from "../../../dist/analysis/declarations/native-value-declarations.js";

function enumDeclarations(source) {
  return source.ast.statements(source.getSourceFile("/src/index.ts"))
    .filter(declaration => source.ast.kindName(declaration) === "KindEnumDeclaration");
}

test("source enum definitions retain the identical early completed values and common width", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export enum Narrow { Min = -2147483648, Max = 2147483647 }
export enum Wide { First = 2147483648, Next }
export enum Exact { First = 9007199254740993, Next }
export enum Duplicate { First = 2147483648, Again = 2147483648 }
export enum Empty {}
export function read(): Wide { return Wide.First; }
` } });
  const expected = new Map([
    ["Narrow", [32, "enum", ["-2147483648", "2147483647"]]],
    ["Wide", [64, "enum", ["2147483648", "2147483649"]]],
    ["Exact", [64, "enum", ["9007199254740993", "9007199254740994"]]],
    ["Duplicate", [64, "constants", ["2147483648", "2147483648"]]],
    ["Empty", [32, "constants", []]],
  ]);
  for (const declaration of enumDeclarations(source)) {
    const name = source.ast.text(source.ast.name(declaration));
    const [width, representation, values] = expected.get(name);
    const carrier = program.records.runtimeCarrier.get(declaration)?.carrier;
    assert.equal(carrier !== undefined, true, `${name}: early nominal carrier is published`);
    const form = program.nativeDeclarations.get(declaration);
    assert.equal(program.typeDefinitions.sourceEnumDefinition(carrier) === form, true,
      `${name}: late native emission reads the identical early definition`);
    assert.equal(form.integerWidth, width, `${name}: cached shared width`);
    assert.equal(form.representation, representation, `${name}: native physical form`);
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
        projectTypes: { ...initial.projectTypes, initialize(input) {
          for (const declaration of declarations) {
            const carrier = initial.records.runtimeCarrier.get(declaration)?.carrier;
            assert.equal(carrier !== undefined, true, "nominal enum evidence precedes class and interface layout");
            assert.equal(initial.typeDefinitions.sourceEnumDefinition(carrier)?.integerWidth, 64,
              "the actual early type registry already knows the native width");
          }
          initialized = true;
          return initialize(input);
        } },
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
  const definition = Object.freeze({ kind: "enum", name: "Empty", integerWidth: 32,
    representation: "constants", variants: Object.freeze([]) });
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
    typeDefinitions: program.typeDefinitions, names: { nameForDeclaration() { throw new Error("late name decision"); } } });
  assert.equal(admitted.kind, "accepted", "late admission consumes only completed enum evidence");
  assert.equal(admitted.form === form, true, "no replacement descriptor or second physical choice is introduced");
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
    assert.match(generated, /#\[repr\(i32\)\][\s\S]*?pub enum Narrow/u, "ordinary narrow enums declare their width");
    assert.match(generated, /#\[repr\(i64\)\][\s\S]*?pub enum Wide/u, "ordinary wide enums declare their width");
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
        assert_eq!(narrowIdentity(Narrow::First) as i32, 1);
        assert_eq!(duplicateIdentity(Duplicate::Again).value, 1);
        assert_eq!(wideIdentity(Wide::First) as i64, 2147483648_i64);
        assert_eq!(wideDuplicateIdentity(WideDuplicate::Again).value, 2147483648_i64);
    }
}
`;
    const artifacts = result.artifacts.map(artifact => artifact.path === "src/index.rs"
      ? { ...artifact, text: artifact.text + nativeControl } : artifact);
    const project = writeGeneratedProject("enum-native-layout", artifacts);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt", "--all"]);
    runCargo(project, ["fmt", "--all", "--check"]);
    runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    const native = runCargo(project, ["test", "--locked", "--offline"]);
    assert.match(native.stdout, /enum_layout_control::exact_native_layout_and_identity_roundtrip \.\.\. ok/u,
      "the exact generated carriers execute the native construction/cast/identity roundtrip");
  });
