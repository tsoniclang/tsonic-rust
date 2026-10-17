import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";

for (const failure of ["source", "resource"]) {
  test(`Rust native struct admission keeps one exact ${failure} key refusal without publishing a carrier`, () => {
    const declaration = {}, initializer = {}, shape = {}, property = {}, name = {};
    const selected = Object.freeze({ kind: "rejected", failure, reason: `Selected native struct ${failure} key refusal.` });
    const diagnostics = [];
    const ast = {
      is: { IsVariableDeclaration: node => node === declaration, IsComputedPropertyName: node => node === name },
      as: {
        AsVariableDeclaration: node => node === declaration ? { Initializer: initializer } : undefined,
        AsCallExpression: node => node === initializer ? { Arguments: { Nodes: [shape] } } : undefined,
        AsObjectLiteralExpression: node => node === shape ? { Properties: { Nodes: [property] } } : undefined,
      },
      name: node => node === property ? name : undefined,
    };
    const walk = {
      context: { ast, diagnostics, records: { compileTimeSources: { erase: () => assert.fail("rejected struct metadata is not published") } },
        source: { sourceFacts: { getFact: (node, key) => {
          assert.equal(node === declaration && key === structFactKey, true, "native admission reads the identical selected struct declaration");
          return { valueType: true, fields: [] };
        } } },
        semanticsFor: node => {
          assert.equal(node === property, true, "the actual struct field selects its completed source semantics");
          return { propertyNames: { get: key => {
            assert.equal(key === name, true, "the identical computed key is queried");
            return selected;
          } } };
        },
      },
      sourceTypes: { registerRepresentationAlias: () => assert.fail("a rejected key cannot acquire a native carrier") },
      rejectedExpressions: new Set(), resolving: new Set(),
    };
    assert.equal(recordRustValueStructDeclaration(walk, declaration), true, "the actual native struct owner handles the rejected declaration");
    assert.equal(diagnostics.length, 1, "one selected key failure does not become carrier or parameter errors");
    assert.equal(diagnostics[0]?.sourceNode === name, true, "the source node is the identical computed key");
    assert.equal(diagnostics[0]?.message, selected.reason, "the shared reason is forwarded unchanged");
    assert.equal(diagnostics[0]?.code, failure === "resource" ? "RUST_ENUM_CONSTANT_RESOURCE_LIMIT" : "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN",
      "the selected issue category is preserved");
  });
}

for (const nested of [false, true]) for (const failure of ["source", "resource"]) {
  test(`Rust binding admission preserves the exact ${failure} key refusal${nested ? " through recursion" : ""}`, () => {
    const objectPattern = {}, propertyBinding = {}, propertyName = {}, valueName = {};
    const arrayPattern = {}, outerBinding = {};
    const selected = Object.freeze({ kind: "rejected", failure, reason: `Selected ${failure} property-name refusal.` });
    const ast = {
      kindName: node => node === objectPattern ? "KindObjectBindingPattern"
        : node === arrayPattern ? "KindArrayBindingPattern"
          : node === propertyBinding || node === outerBinding ? "KindBindingElement"
            : node === propertyName ? "KindComputedPropertyName" : "KindIdentifier",
      elements: node => node === objectPattern ? [propertyBinding] : node === arrayPattern ? [outerBinding] : [],
      name: node => node === propertyBinding ? valueName : node === outerBinding ? objectPattern : undefined,
      is: {
        IsBindingElement: node => node === propertyBinding || node === outerBinding,
        IsComputedPropertyName: node => node === propertyName,
        IsNumericLiteral: () => false,
        IsVariableDeclaration: () => false,
        IsParameterDeclaration: () => false,
        IsPropertyDeclaration: () => false,
      },
      as: { AsBindingElement: node => node === propertyBinding ? { PropertyName: propertyName } : {} },
    };
    const records = createRustProgramRecordBuilder();
    const valueCarrier = rustSourcePrimitiveTargetType("int32");
    const result = recordRustBindingPatternFacts(nested ? arrayPattern : objectPattern,
      nested ? rustTupleTargetType([valueCarrier]) : valueCarrier, {
        ast, records, requiredRecords: [], setCarrier: () => {},
        semanticsFor: node => {
          assert.equal(node === propertyName, true, "the identical checked key selects its sealed evidence");
          return { propertyNames: { get: key => {
            assert.equal(key === propertyName, true, "no replacement key or syntax guess is queried");
            return selected;
          } } };
        },
        resolveCarrier: () => assert.fail("a rejected key cannot require physical property selection"),
        resolveExpressionCarrier: () => assert.fail("a rejected key cannot evaluate a default or erase its effects"),
      });
    assert.equal(result.kind, "rejected", "an expected key refusal is not unresolved internal evidence");
    assert.equal(result.node === propertyName, true, "the identical offending key survives recursion");
    assert.equal(result.reason, selected.reason, "the exact shared reason is preserved");
    assert.equal(result.code, failure === "resource" ? "RUST_ENUM_CONSTANT_RESOURCE_LIMIT" : "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN",
      "the existing issue category is preserved");
    assert.equal(Object.isFrozen(result), true, "expected-failure evidence is immutable");
    assert.equal(records.bindingProjection.get(propertyBinding) === undefined, true, "no invalid field projection is published");
  });
}

const staticKeys = [
  { name: "string literal", prelude: "", key: '"value"', ordinary: "value" },
  { name: "numeric literal", prelude: "", key: "0x10", ordinary: "16" },
  { name: "negative numeric literal", prelude: "", key: "-1", ordinary: '"-1"' },
  { name: "zero numeric literal", prelude: "", key: "-0", ordinary: "0", declarationKey: "0" },
  { name: "fractional numeric literal", prelude: "", key: "1.5", ordinary: "1.5" },
  { name: "exponent numeric literal", prelude: "", key: "1e21", ordinary: "1e21", expected: "1e+21" },
  { name: "const string", prelude: 'const key = "value";', key: "key", ordinary: "value" },
  { name: "const numeric", prelude: "const key = 16;", key: "key", ordinary: "16" },
  { name: "numeric enum", prelude: "enum Key { Value = 16 }", key: "Key.Value", ordinary: "16" },
  { name: "parenthesized const", prelude: 'const key = "value";', key: "((key))", declarationKey: "key", ordinary: "value" },
  { name: "nonidentifier string", prelude: 'const key = "x-y";', key: "key", ordinary: '"x-y"' },
  { name: "empty string", prelude: 'const key = "";', key: "key", ordinary: '""' },
  { name: "exact large integer literal", prelude: "", key: "9007199254740993", ordinary: "9007199254740993", refused: true },
  { name: "exact large const integer", prelude: "const key = 9007199254740993;", key: "key", ordinary: "9007199254740993", refused: true },
  { name: "destructured const string", prelude: 'const { key } = { key: "value" } as const;', key: "key", ordinary: "value" },
  { name: "destructured const integer", prelude: "const [key] = [9007199254740993] as const;", key: "key", ordinary: "9007199254740993", refused: true },
  { name: "destructured spread const integer", prelude: "const prefix = [1, 9007199254740993] as const; const [, key] = [...prefix, 3] as const;", key: "key", ordinary: "9007199254740993", refused: true },
  { name: "coherent wide integer", prelude: "", key: "9007199254740994", ordinary: "9007199254740994" },
  { name: "coherent rounded binary integer spelling", prelude: "", key: "1152921504606847000", ordinary: "1152921504606847000" },
  { name: "radix exponent spelling", prelude: "", key: "0x3635c9adc5dea00000", ordinary: "1e21", expected: "1e+21" },
  { name: "reserved native identifier", prelude: 'const key = "class";', key: "key", ordinary: '"class"' },
];

for (const surfaces of [[], ["js"]]) {
  for (const [label, declarations, body] of [
    ["object body", "", 'function unused(key: string): number { const value = { [key]: 7 }; return 1; }'],
    ["native struct body", 'import { field, struct } from "@tsonic/core/lang.js"; function key(): "value" { return "value"; }',
      'function unused(): number { const Shape = struct({ [key()]: field<number>() }); return 1; }'],
  ]) {
    for (const required of [false, true]) test(`Rust ${surfaces[0] ?? "native"} ${required ? "requires" : "erases"} a computed key in a nested ${label}`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": `${declarations}
export function run(): number {
  ${body}
  return ${required ? label === "object body" ? 'unused("value")' : "unused()" : "42"};
}` } });
      if (!required) {
        assert.equal(compiled.result.diagnostics.length, 0, "the actual participation owner erases the unused body's native obligations");
        assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true, "the retained native program reaches emission");
        const output = compiled.result.artifacts.map(artifact => artifact.text).join("\n");
        assert.equal(output.includes("42") && !/\bunused\b/u.test(output), true, "no native code is invented for the erased body");
        return;
      }
      assert.equal(compiled.result.diagnostics.length, 1, "one demanded key owns the only source refusal");
      assert.equal(compiled.result.diagnostics[0]?.code, "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN", "the actual native key is refused before generic missing carriers");
      assert.equal(compiled.result.diagnostics[0]?.message, label === "object body"
        ? "The computed key is not a const singleton binding or an exact enum constant."
        : "A computed property key call must retain its effects and cannot be replaced with a static native field name.",
      "the shared selected cause is preserved rather than reconstructed");
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined && compiled.result.artifacts.length === 0, true,
        "a required rejected key publishes no program, plan or native artifact");
    });
  }

  test(`Rust ${surfaces[0] ?? "native"} rejects an effectful native struct key without dropping its evaluation`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
import { field, struct } from "@tsonic/core/lang.js";
function key(): "value" { return "value"; }
export const Shape = struct({ [key()]: field<number>() });
export type Shape = typeof Shape;
export function accept(value: Shape): void {}
` } });
    const issues = compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN");
    assert.equal(compiled.result.diagnostics.length, 1, "native field admission stops before dependent carrier or parameter errors");
    assert.equal(issues.length, 1, "the actual native field refuses the shared effectful-key evidence once");
    assert.equal(issues[0]?.message,
      "A computed property key call must retain its effects and cannot be replaced with a static native field name.",
      "the native struct consumes the exact source-owned key refusal");
    assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "the builder cannot erase a required key effect");
    assert.equal(compiled.result.artifacts.length, 0, "no native field is invented from the call's singleton return type");
  });

  test(`Rust ${surfaces[0] ?? "native"} erases checked symbolic type-family metadata without a native field obligation`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
declare const storage: unique symbol;
interface Stored<Value> { readonly [storage]: Value; }
type Storage<Value> = Value extends Stored<infer Inner> ? Inner : Value;
export function read(value: Storage<number>): number { return value; }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "a valid erased contract is not a global representation failure");
    assert.equal(compiled.result.artifacts.length > 0, true, "the real primitive-valued program emits");
  });

  test(`Rust ${surfaces[0] ?? "native"} still refuses an actual symbolic native field`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
declare const storage: unique symbol;
export interface Holder { readonly [storage]: number; }
export function accept(value: Holder): void {}
` } });
    assert.equal(compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN").length, 1,
      "the actual native field, not the valid source-only contract, owns one precise refusal");
    assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "symbolic storage is rejected before sealing");
    assert.equal(compiled.result.artifacts.length, 0, "no synthetic symbolic native field is invented");
  });

  test(`Rust ${surfaces[0] ?? "native"} keeps non-authored checked element arguments`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
export function read(): number {
  const pair = { 1: 7 };
  let index: 1 = 1;
  return pair[index];
}
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "a checked literal-typed runtime index has no R1 disagreement");
    assert.equal(compiled.result.artifacts.length > 0, true, "no authored numeric token is required from the user");
  });

  for (const [kind, declaration] of [
    ["class", "export class Holder { [+1] = 1; }"],
    ["interface", "export interface Holder { [-0]: number; }"],
  ]) {
    test(`Rust ${surfaces[0] ?? "native"} refuses an emitted signed bound ${kind} key`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": `${declaration}
export function accept(value: Holder): void {}
` } });
      const issues = compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN");
      assert.equal(issues.length === 1 && issues[0].message.includes("checker key") && issues[0].message.includes("exact string key"), true,
        "one actual native field consumes the same precise checked identity refusal");
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "bound key mismatch is pre-seal");
      assert.equal(compiled.result.artifacts.length, 0, "no mismatched native field name is emitted");
    });
  }

  test(`Rust ${surfaces[0] ?? "native"} object zero and its destructuring use the completed checked identity`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
export function read(): number { const object = { [-0]: 7 }; const { [-0]: value } = object; return value; }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "object and binding select the same checked zero name");
    assert.equal(compiled.result.artifacts.length > 0, true, "canonical zero is not an unsupported native field");
  });

  test(`Rust ${surfaces[0] ?? "native"} struct fields share checked computed names with finalized FieldFact evidence`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
import { field, struct } from "@tsonic/core/lang.js";
const key = "value";
export const Shape = struct({ ["ok"]: field<number>(), [key]: field<number>() });
export type Shape = typeof Shape;
export function read(value: Shape): number { return value.ok + value[key]; }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "both finalized computed fields reach target analysis without a source rejection");
    assert.equal(compiled.result.artifacts.length > 0, true, "both checked field names reach native generation");
  });

  test(`Rust ${surfaces[0] ?? "native"} computed names do not admit a non-field struct initializer`, () => {
    assert.throws(() => compileRust({ surfaces, files: { "index.ts": `
import { struct } from "@tsonic/core/lang.js";
export const Shape = struct({ ["bad"]: 1 });
` } }), /TSEXT9901109: struct\(\.\.\.\) field shape members require finalized field<T>\(\) facts/u,
    "a static name does not manufacture the existing required FieldFact type evidence");
  });

  test(`Rust ${surfaces[0] ?? "native"} regular string enums are refused for ordinary and computed fields`, () => {
    for (const computed of [false, true]) {
      const compiled = compileRust({ surfaces, files: { "index.ts": `
enum Key { Value = "value" }
interface Holder { ${computed ? "[Key.Value]" : "value"}: number; }
export function make(): number {
  const value: Holder = { ${computed ? "[Key.Value]" : "value"}: 7 };
  return value[Key.Value];
}
` } });
      assert.equal(compiled.result.diagnostics.filter(issue => issue.code === "RUST_ENUM_CONSTANT_NOT_SUPPORTED").length, 1,
        `${computed ? "computed" : "ordinary"} field preserves the precise native enum-domain refusal`);
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true,
        "a regular string enum is refused before sealing, not misclassified as an unknown key");
      assert.equal(compiled.result.artifacts.length, 0, "no unadmitted native enum is emitted");
    }
  });
  for (const current of staticKeys) {
    test(`Rust ${surfaces[0] ?? "native"} ${current.refused ? "refuses a conflicting checker identity for" : "admits"} ${current.name} as an ordinary exact field`, () => {
      if (current.refused) {
        for (const computed of [false, true]) {
          const compiled = compileRust({ surfaces, files: { "index.ts": `
${current.prelude}
interface Holder { ${computed ? `[${current.declarationKey ?? current.key}]` : current.ordinary}: number; }
export function make(): number {
  const value: Holder = { ${computed ? `[${current.key}]` : current.ordinary}: 7 };
  return value[${current.key}];
}
` } });
          const issues = compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN");
          assert.equal(issues.length > 0 && issues.every(issue => issue.message.includes("checker key") && issue.message.includes("exact string key")), true,
            "every conflicting named identity has the precise shared admission reason");
          assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "R1 rejects before sealing and planning");
          assert.equal(compiled.result.artifacts.length, 0, "R1 emits no incorrect native field");
        }
        return;
      }
      const compiled = compileRust({ surfaces, files: { "index.ts": `
${current.prelude}
interface Holder { [${current.declarationKey ?? current.key}]: number; }
export function make(): number {
  const value: Holder = { [${current.key}]: 7 };
  return value[${current.key}];
}
` } });
      assert.equal(compiled.result.diagnostics.length, 0,
        `computed-field program compiles to native Rust; program=${compiled.result.program !== undefined}; plan=${compiled.result.plan !== undefined}; artifacts=${compiled.result.artifacts.length}; ` +
        compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
      assert.equal(compiled.result.artifacts.length > 0, true, "computed-field program emits native artifacts");
      const definition = compiled.result.program.projectTypes.definitions.find(candidate => candidate.sourceName === "Holder");
      assert.equal(definition !== undefined, true, "checked field owner is preserved");
      const layout = compiled.result.program.projectTypes.objectLayoutForDefinition(definition);
      const expectedName = current.expected ?? (current.ordinary.startsWith('"') ? JSON.parse(current.ordinary) : current.ordinary);
      assert.equal(layout?.fields[0]?.sourceName, expectedName, "sealed native layout preserves the exact unrounded key");
      const ordinary = compileRust({ surfaces, files: { "index.ts": `
${current.prelude}
interface Holder { ${current.ordinary}: number; }
export function make(): number {
  const value: Holder = { ${current.ordinary}: 7 };
  return value[${current.key}];
}
` } });
      assert.equal(ordinary.result.diagnostics.length, 0, "equivalent ordinary-field program still compiles");
    });
  }

  test(`Rust ${surfaces[0] ?? "native"} static class fields and methods use one native name plan`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
const valueKey = "value";
const readKey = "read";
class Holder {
  [valueKey]: number = 7;
  [readKey](): number { return this[valueKey]; }
}
export function make(): number { return new Holder()[readKey](); }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "computed field and method compile as native Rust members: " +
      compiled.result.diagnostics.slice(0, 8).map(issue => `${issue.code}: ${issue.message.slice(0, 512)}`).join("; "));
  });

  test(`Rust ${surfaces[0] ?? "native"} imported computed fields use the declaration file's sealed evidence`, () => {
    const compiled = compileRust({ surfaces, files: {
      "index.ts": 'import type { Holder } from "./holder.js"; export function make(): number { const value: Holder = { value: 7 }; return value.value; }',
      "holder.ts": 'const key = "value"; export interface Holder { [key]: number; }',
    } });
    assert.equal(compiled.result.diagnostics.length, 0, "imported field declaration retains exact checked key identity");
    assert.equal(compiled.result.artifacts.length > 0, true, "imported computed field emits native artifacts");
  });

  test(`Rust ${surfaces[0] ?? "native"} computed method overloads keep their checked implementation`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
const key = "read";
class Holder {
  [key](value: number): number;
  [key](value: number): number { return value; }
}
export function make(): number { return new Holder()[key](7); }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "computed overloads resolve to the exact checked implementation: " +
      compiled.result.diagnostics.slice(0, 8).map(issue => `${issue.code}: ${issue.message.slice(0, 512)}`).join("; "));
  });

  test(`Rust ${surfaces[0] ?? "native"} constructor-spelled computed methods remain ordinary methods`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
const key = "constructor";
class Holder { [key](): number { return 7; } }
export function make(): number { return new Holder()[key](); }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "constructor-spelled source method is not a constructor declaration: " +
      compiled.result.diagnostics.slice(0, 8).map(issue => `${issue.code}: ${issue.message.slice(0, 512)}`).join("; "));
  });

  test(`Rust ${surfaces[0] ?? "native"} inferred objects refuse disagreeing large numeric names`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
export function make(): number {
  const value = { [9007199254740993]: 7 };
  return value[9007199254740993];
}
` } });
    assert.equal(compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN").length, 2,
      "the inferred declaration and member access both require the same coherent name");
    assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "the disagreement is rejected before sealing");
    assert.equal(compiled.result.artifacts.length, 0, "no rounded or unselectable native field is emitted");
  });

  for (const key of ["-9007199254740993", "1152921504606846976", "18446744073709551616", "1.0000000000000001", "1e-400"]) {
    test(`Rust ${surfaces[0] ?? "native"} refuses numeric named key ${key} without a representability cap`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": `export function make(): number { const value = { [${key}]: 1 }; return 0; }` } });
      const issues = compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN");
      assert.equal(issues.length === 1 && issues[0].message.includes("checker key") && issues[0].message.includes("exact string key"), true,
        "one precise exact/checker name disagreement");
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "the numeric mismatch is a pre-seal source rejection");
      assert.equal(compiled.result.artifacts.length, 0, "no dynamic or rounded-key fallback is emitted");
    });
  }

  for (const current of [
    { name: "dynamic argument", source: 'export function make(key: string): number { const value = { [key]: 1 }; return 0; }' },
    { name: "mutable literal binding", source: 'export function make(): number { let key: "value" = "value"; const value = { [key]: 1 }; return 0; }' },
    { name: "effectful singleton call", source: 'function key(): "value" { return "value"; } export function make(): number { const value = { [key()]: 1 }; return 0; }' },
    { name: "effectful property getter", source: 'const key = { get name(): "value" { return "value"; } }; export function make(): number { const value = { [key.name]: 1 }; return 0; }' },
    { name: "effectful enum receiver", source: 'enum Key { Value = 1 } const holder = { get selected(): typeof Key { return Key; } }; export function make(): number { const value = { [holder.selected.Value]: 1 }; return 0; }' },
  ]) {
    test(`Rust ${surfaces[0] ?? "native"} rejects ${current.name} before sealing`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": current.source } });
      const issues = compiled.result.diagnostics.filter(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN");
      assert.equal(issues.length, 1, "one exact computed-field admission diagnostic");
      assert.equal(issues[0]?.category, "error", "nonconstant computed key is a source error");
      assert.equal(compiled.result.program === undefined, true, "invalid key is rejected before publication");
      assert.equal(compiled.result.plan === undefined, true, "invalid key never reaches the planner");
      assert.equal(compiled.result.artifacts.length, 0, "invalid key emits no native artifacts");
    });
  }
}
import { recordRustBindingPatternFacts } from "../../../dist/analysis/control-flow/binding-patterns.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { rustSourcePrimitiveTargetType, rustTupleTargetType } from "../../../dist/target-model/types/index.js";
import { recordRustValueStructDeclaration } from "../../../dist/analysis/declarations/value-structs.js";
import { structFactKey } from "@tsonic/tsts";
