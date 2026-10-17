import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const absenceObservations = ["null", "undefined"].flatMap(absence =>
  ["===", "!==", "==", "!="].flatMap(operator => [
    `(value ${operator} ${absence}) === ${operator === "===" || operator === "==" ? "!present" : "present"}`,
    `(${absence} ${operator} value) === ${operator === "===" || operator === "==" ? "!present" : "present"}`,
  ]));
const absenceSource = `
enum Value { First = 1, Second = 2 }
function observe(value: Value | null | undefined, present: boolean): boolean {
  return ${absenceObservations.map(expression => `(${expression})`).join(" && ")};
}
export function run(flag: boolean): boolean {
  const selected = flag ? Value.First : undefined;
  const joined = flag ? Value.Second : null;
  const copied = selected;
  return observe(Value.First, true) && observe(null, false) && observe(undefined, false) &&
    observe(selected, flag) && observe(joined, flag) && observe(copied, flag) &&
    ((copied ?? Value.First) === Value.First);
}
`;
const absenceProjectionRefusals = [
  ["nullable numeric peer", "export function use(value: Value | undefined, operand: number): boolean { return value === operand; }"],
  ["reversed nullable numeric peer", "export function use(value: Value | null, operand: number): boolean { return operand != value; }"],
  ["shadowed undefined", "export function use(value: Value, undefined: number): boolean { return value === undefined; }"],
  ["nullable arithmetic", "export function use(value: Value | undefined): number { return (value ?? Value.First) + 1; }"],
  ["explicit numeric destination", "export function use(value: Value | undefined): number | undefined { const selected: number | undefined = value; return selected; }"],
  ["explicit numeric assertion", "export function use(value: Value): boolean { return (value as number) === undefined; }"],
];


const numericUses = [
  ["float64 equality", "export function use(value: Value, operand: number): boolean { return value === operand; }"],
  ["int32 equality", "export function use(value: Value, operand: int32): boolean { return value === operand; }"],
  ["ordering", "export function use(left: Value, right: Value): boolean { return left < right; }"],
  ["arithmetic", "export function use(value: Value): number { return value + 1; }"],
  ["unary minus", "export function use(value: Value): number { return -value; }"],
  ["unary plus", "export function use(value: Value): number { return +value; }"],
  ["increment", "export function use(value: Value): Value { value++; return value; }"],
  ["numeric local", "export function use(value: Value): number { const result: number = value; return result; }"],
  ["numeric return", "export function use(value: Value): number { return value; }"],
  ["numeric argument", "function consume(value: number): number { return value; } export function use(value: Value): number { return consume(value); }"],
  ["complement numeric local", "export function use(value: Value): number { const result: number = ~value; return result; }"],
  ["complement arithmetic", "export function use(value: Value): number { return ~value + 1; }"],
  ["bitwise numeric return", "export function use(left: Value, right: Value): number { return left | right; }"],
  ["inferred complement return", "export function use(value: Value): number { const result = ~value; return result; }"],
  ["inferred complement copy return", "export function use(value: Value): number { const result = ~value; const copy = result; return copy; }"],
  ["inferred bitwise return", "export function use(left: Value, right: Value): number { const result = left | right; return result; }"],
  ["inferred complement argument", "function consume(value: number): number { return value; } export function use(value: Value): number { const result = ~value; return consume(result); }"],
  ["inferred complement assignment", "export function use(value: Value): number { const result = ~value; let copy = 0; copy = result; return copy; }"],
  ["inferred complement comparison", "export function use(value: Value): boolean { const result = ~value; return result === 0; }"],
  ["inferred complement arithmetic", "export function use(value: Value): number { const result = ~value; return result + 1; }"],
  ["unwritten inferred binding", "export function use(value: Value): number { let result = ~value; return result; }"],
  ["shift", "export function use(value: Value): number { return value << 1; }"],
  ["conditional complement", "export function use(left: Value, right: Value, flag: boolean): number { const result = flag ? ~left : ~right; return result; }"],
  ["conditional bitwise", "export function use(left: Value, right: Value, flag: boolean): number { const result = flag ? left | right : left & right; return result; }"],
  ["mixed choice equality", "export function use(left: Value, flag: boolean): boolean { const result = flag ? ~left : 42; return result === left; }"],
  ["comma complement", "function touch(): void {} export function use(value: Value): number { const result = (touch(), ~value); return result; }"],
  ["logical-and result", "export function use(left: Value, right: Value): number { const result = (~left) && (~right); return result; }"],
  ["logical-or result", "export function use(left: Value, right: Value): number { const result = (~left) || (~right); return result; }"],
  ["logical-or numeric destination", "export function use(left: Value, right: Value): number { return (~left) || (~right); }"],
  ["logical-or nested wrappers", "export function use(left: Value, right: Value): number { const result = (((~left)!)) || (((~right)!)); return result; }"],
  ["nullish numeric left context", "export function use(left: number | undefined, right: Value): number { const result = left ?? ~right; return result; }"],
  ["nullish result", "export function use(right: Value, absent: undefined): number { const result = absent ?? ~right; return result; }"],
  ["numeric switch discriminant", "export function use(value: number): number { switch (value) { case Value.First: return 1; default: return 0; } }"],
  ["numeric switch case", "export function use(value: Value): number { switch (value) { case 1: return 1; default: return 0; } }"],
  ["array numeric index", "export function use(values: number[], key: Value): number { return values[key]; }"],
  ["number index signature", "export function use(values: { [index: number]: number }, key: Value): number { return values[key]; }"],
  ["explicit numeric assertion", "export function use(value: Value): number { return value as number; }"],
  ["angle numeric assertion", "export function use(value: Value): number { return <number>value; }"],
  ["inferred object field escape", "export function use(): number { const object = { value: ~Value.First }; return object.value + 1; }"],
  ["inferred collection escape", "export function use(): number { const values = [~Value.First]; return values[0] + 1; }"],
  ["generic call numeric escape", "function identity<T>(value: T): T { return value; } export function use(value: Value): number { const result = identity(~value); return result; }"],
  ["inferred callable return escape", "function produce(value: Value) { return ~value; } export function use(value: Value): number { return produce(value); }"],
  ["written inferred numeric local","export function use(value: Value): number { let result = ~value; result = 3; return result; }"],
  ["numeric class field","export class Holder { value: number = Value.First; }"],
  ["numeric parameter default","export function use(value: number = Value.First): number { return value; }"],
  ["unknown assertion chain","export function use(value: Value): number { return value as unknown as number; }"],
  ["any assertion chain","export function use(value: Value): number { return <number><any>value; }"],
  ["unknown local store","export function use(value: Value): void { const result: unknown = value; }"],
  ["any local store","export function use(value: Value): void { const result: any = value; }"],
  ["unknown destination","function accept(value: unknown): void {} export function use(value: Value): void { accept(value); }"],
  ["object assertion destination","export function use(value: Value): object { return value as unknown as object; }"],
  ["any destination","function accept(value: any): void {} export function use(value: Value): void { accept(value); }"],
  ["rest any destination","function accept(...values: any[]): void {} export function use(value: Value): void { accept(value); }"],
  ["unknown conditional destination","function accept(value: unknown): void {} export function use(left: Value, right: Value, flag: boolean): void { accept(flag ? left : right); }"],
  ["unknown logical destination","function accept(value: unknown): void {} export function use(left: Value, right: Value): void { accept(left || right); }"],
  ["unknown nullish destination","function accept(value: unknown): void {} export function use(left: Value | undefined, right: Value): void { accept(left ?? right); }"],
  ["unknown comma destination","function touch(): void {} function accept(value: unknown): void {} export function use(value: Value): void { accept((touch(), value)); }"],
  ["unknown wrapped destination","function accept(value: unknown): void {} export function use(value: Value): void { accept(((value)!)); }"],
  ["mutable union without enum destination","export function use(value: Value): number | undefined { let result: number | undefined = value; result = undefined; return result; }"],
];

const stringUses = [
  ["template", "export function use(value: Value): string { return `enum:${value}`; }", false],
  ["global String", "export function use(value: Value): string { return String(value); }", true],
  ["global String alias", "export function use(value: Value): string { const convert = String; return convert(value); }", true],
  ["enum toString", "export function use(value: Value): string { return value.toString(); }", true],
  ["left concatenation", "export function use(value: Value): string { return '' + value; }", false],
  ["right concatenation", "export function use(value: Value): string { return value + ''; }", false],
  ["compound concatenation", "export function use(value: Value): string { let result = ''; result += value; return result; }", false],
  ["string index", "export function use(values: { [key: string]: number }, key: Value): number { return values[key]; }", false],
  ["toFixed", "export function use(value: Value): string { return value.toFixed(); }", true],
  ["toPrecision", "export function use(value: Value): string { return value.toPrecision(); }", true],
  ["toExponential", "export function use(value: Value): string { return value.toExponential(); }", true],
  ["toLocaleString", "export function use(value: Value): string { return value.toLocaleString(); }", true],
  ["computed toFixed", "export function use(value: Value): string { return value['toFixed'](); }", true],
];

for (const [label, declaration] of [
  ["function", 'function String(value: Value): string { return "custom"; }'],
  ["callable variable", 'var String = (value: Value): string => "custom";'],
]) {
  test(`Rust native user-global String ${label} is not a builtin conversion`, () => {
    const compiled = compileRust({ files: { "index.ts": `enum Value { First = 1 } ${declaration} String(Value.First);` } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
    assert.equal(compiled.result.artifacts.length > 0, true, "the real non-JS user global remains native code");
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`Rust ${surfaces[0] ?? "native"} enum absence observations match the single native absence state`, { timeout: 300_000 }, () => {
    const compiled = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${absenceSource}\nif (!run(true) || !run(false)) throw new Error("enum absence observations");` } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
    assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true,
      "an absence observation retains the enum domain without numeric projection");
    validateGeneratedProject(`enum-absence-${surfaces[0] ?? "native"}`, [...compiled.result.artifacts,
      { path: "tests/native_enum_absence.rs", text: `#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeValue {
    First = 1,
    Second = 2,
}

#[test]
fn native_enum_absence_observations() {
    for flag in [true, false] {
        let selected = if flag {
            Some(NativeValue::First)
        } else {
            None
        };
        let joined = if flag {
            Some(NativeValue::Second)
        } else {
            None
        };
        let absent = None;
        for value in [selected, joined, selected] {
            assert_eq!(value.is_some(), flag);
            assert_eq!(value.is_none(), !flag);
            assert_eq!(absent == value, !flag);
            assert_eq!(absent != value, flag);
        }
        assert!(selected.unwrap_or(NativeValue::First) == NativeValue::First);
    }
}
` }], { run: true });
  });

  for (const [label, body] of absenceProjectionRefusals) {
    test(`Rust ${surfaces[0] ?? "native"} absence observation does not admit ${label}`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": `enum Value { First = 1, Second = 2 } ${body}` } });
      assert.equal(compiled.result.diagnostics.length, 1, `${label}: one actual projection`);
      assert.equal(compiled.result.diagnostics[0]?.code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED", `${label}: shared refusal`);
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, `${label}: rejected before seal`);
      assert.equal(compiled.result.artifacts.length, 0, `${label}: no native output`);
    });
  }
  for (const [label, body] of numericUses) {
    test(`Rust ${surfaces[0] ?? "native"} refuses enum ${label} at shared source admission`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export enum Value { First = 1, Second = 2 }
${body}
` } });
      assert.equal(compiled.result.diagnostics.length, 1, "one shared use owns the rejection");
      assert.equal(compiled.result.diagnostics[0].code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED", "the code is identical on both targets");
      assert.equal(compiled.result.diagnostics[0].message, "Enum value 'Value' is used as a number; enum-numeric operations are not supported yet. Use equality or bitwise operations within the same enum instead.",
        "the message is identical on both targets");
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "rejection precedes sealing and planning");
      assert.equal(compiled.result.artifacts.length, 0, "a refused enum use emits no artifact");
    });
  }

  if (surfaces[0] === "js") for (const [label, body] of [
    ["console log", "export function use(value: Value): void { console.log(value); }"],
    ["JSON stringify", "export function use(value: Value): string { return JSON.stringify(value); }"],
    ["Number valueOf", "export function use(value: Value): number { return value.valueOf(); }"],
    ["Number method value", "export function use(value: Value): () => number { return value.valueOf; }"],
  ]) {
    test(`Rust ${surfaces[0] ?? "native"} refuses closed enum ${label} before target planning`, () => {
      const sourceText = `export enum Value { First = 1, Second = 2 } ${body}`;
      const compiled = compileRust({ surfaces, files: { "index.ts": sourceText } });
      assert.equal(compiled.result.diagnostics.length, 1, `${label}: one actual enum use`);
      assert.equal(compiled.result.diagnostics[0]?.code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED", `${label}: shared admission owner`);
      assert.equal(compiled.result.diagnostics[0]?.message, "Enum value 'Value' is used as a number; enum-numeric operations are not supported yet. Use equality or bitwise operations within the same enum instead.", `${label}: no target-specific or missing-fact refusal`);
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, `${label}: before seal`);
      assert.equal(compiled.result.artifacts.length, 0, `${label}: no output`);
    });
  }

  for (const [label, body] of [
    ["same-enum mutable destination", "export function use(value: Value): Value { let result: Value = value; result = value; return result; }"],
    ["same-enum class field", "export class Holder { value: Value = Value.First; }"],
    ["same-enum parameter default", "export function use(value: Value = Value.First): Value { return value; }"],
    ["same-enum assertion", "export function use(value: Value): Value { return value as Value; }"],
    ["actual instantiated T", "function identity<T>(value: T): T { return value; } export function use(value: Value): Value { return identity<Value>(value); }"],
    ["enum-containing union destination", "function accept(value: Value | string): void {} export function use(value: Value): void { accept(value); }"],
    ["fixed tuple enum index", "export function use(values: [number, number]): number { return values[Value.First]; }"],
    ["static enum key metadata", "interface Named { [Value.First]: number; } export function use(value: Named): number { return value[Value.First]; }"],
  ]) {
    test(`Rust ${surfaces[0] ?? "native"} retains closed enum twin ${label}`, () => {
      const sourceText = `export enum Value { First = 1, Second = 2 } ${body}`;
      const compiled = compileRust({ surfaces, files: { "index.ts": sourceText } });
      assert.equal(compiled.result.diagnostics.length, 0, compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\\n").slice(0, 2048));
      assert.equal(compiled.result.program !== undefined && compiled.result.plan !== undefined, true, `${label}: actual native program`);
      assert.equal(compiled.result.artifacts.length > 0, true, `${label}: retained native emission`);
    });
  }

  for (const [label, body, requiresJsLibrary] of stringUses) {
    if (requiresJsLibrary && surfaces.length === 0) continue;
    test(`Rust ${surfaces[0] ?? "native"} refuses enum ${label} with the shared string-conversion reason`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": `export enum Value { First = 1, Second = 2 } ${body}` } });
      assert.equal(compiled.result.diagnostics.length, 1, `${label}: one actual string conversion`);
      assert.equal(compiled.result.diagnostics[0]?.code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED", `${label}: shared code`);
      assert.equal(compiled.result.diagnostics[0]?.message,
        "Enum value 'Value' is converted to a string; enum-to-string conversion is not supported yet.", `${label}: no native-name substitution`);
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, `${label}: rejection before seal`);
      assert.equal(compiled.result.artifacts.length, 0, `${label}: no miscompiled native output`);
    });
  }

  test(`Rust ${surfaces[0] ?? "native"} local String and user formatting functions retain their actual identity`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
export enum Value { First = 1 }
function String(value: Value): string { return "custom"; }
function format(value: Value): string { return "named"; }
export function use(value: Value): string { return String(value) + format(value); }
` } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
    assert.equal(compiled.result.artifacts.length > 0, true, "neither callee spelling nor a string return type creates a conversion");
  });

  test(`Rust ${surfaces[0] ?? "native"} composed enum values retain actual native identity`, { timeout: 300_000 }, () => {
    const compiled = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
export enum Value { First = 1, Second = 2 }
export function run(flag: boolean): boolean {
  const selected = flag ? Value.First : Value.Second;
  return selected === (flag ? Value.First : Value.Second);
}
if (!run(true) || !run(false)) throw new Error("enum composition");
` } });
    assert.equal(compiled.result.diagnostics.length, 0,
      compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
    assert.equal(compiled.result.artifacts.length > 0, true, "same-enum choice is real native output, not a fabricated logical/bitwise capability");
    validateGeneratedProject(`enum-composition-${surfaces[0] ?? "native"}`,
      [...compiled.result.artifacts, { path: "tests/native_enum_composition.rs", text: `#[derive(PartialEq, Eq)]
enum NativeValue {
    First = 1,
    Second = 2,
}

#[test]
fn native_enum_composition() {
    assert!(
        (if true {
            NativeValue::First
        } else {
            NativeValue::Second
        }) == NativeValue::First
    );
    assert!(
        (if false {
            NativeValue::First
        } else {
            NativeValue::Second
        }) == NativeValue::Second
    );
}
` }], { run: true });
  });

  test(`Rust ${surfaces[0] ?? "native"} refuses the checker-equal wide mixed comparison before target selection`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
export enum High { Value = 9007199254740993 }
export function equal(): boolean { return High.Value === 9007199254740992; }
` } });
    assert.equal(compiled.result.diagnostics.length, 1, "the standalone exact enum remains valid; only its numeric use is refused");
    assert.equal(compiled.result.diagnostics[0].code, "TSONIC_ENUM_NUMERIC_USE_NOT_SUPPORTED", "there is no internal missing-fact path");
    assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "the source rule is pre-seal");
    assert.equal(compiled.result.artifacts.length, 0, "no rounded native comparison is emitted");
  });

  for (const [label, sourceText] of [
    ["ordinary", "export enum Value { First = 1 } export enum Value { Second = 2 }"],
    ["cross-declaration collision", "export enum Value { First = 9007199254740992 } export enum Value { Second = 9007199254740993 }"],
    ["empty", "export enum Value {} export enum Value {}"],
  ]) {
    test(`Rust ${surfaces[0] ?? "native"} refuses ${label} merged enum declarations once`, () => {
      const compiled = compileRust({ surfaces, files: { "index.ts": sourceText } });
      assert.equal(compiled.result.diagnostics.length, 1, "one checked symbol owns one diagnostic before the native registry");
      assert.equal(compiled.result.diagnostics[0].code, "TSONIC_ENUM_MERGED_DECLARATIONS_NOT_SUPPORTED", "shared merged-enum code");
      assert.equal(compiled.result.diagnostics[0].message, "Enum 'Value' has 2 declarations; tsonic supports one declaration per enum.", "shared merged-enum text");
      assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "no conflicting native definition is published");
      assert.equal(compiled.result.artifacts.length, 0, "merged enum output never reaches the native compiler");
    });
  }

  test(`Rust ${surfaces[0] ?? "native"} refuses cross-file checked merged enum membership once`, () => {
    const compiled = compileRust({ surfaces, files: {
      "index.ts": "export function run(): number { return 42; }",
      "first.ts": "enum Value { First = 9007199254740992 }",
      "second.ts": "enum Value { Second = 9007199254740993 }",
    } });
    assert.equal(compiled.result.diagnostics.length, 1, "consumer-local merged symbols still have one actual declaration group");
    assert.equal(compiled.result.diagnostics[0]?.code, "TSONIC_ENUM_MERGED_DECLARATIONS_NOT_SUPPORTED", "merged admission precedes R2 and native layout");
    assert.equal(compiled.result.diagnostics[0]?.message, "Enum 'Value' has 2 declarations; tsonic supports one declaration per enum.",
      "both targets consume the same checked membership and reason");
    assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "the merged source is rejected before publication");
    assert.equal(compiled.result.artifacts.length, 0, "no partial enum definitions are emitted");
  });

  test(`Rust ${surfaces[0] ?? "native"} retains native same-enum equality`, () => {
    const compiled = compileRust({ surfaces, files: { "index.ts": `
export enum Value { First = 1, Second = First << 1 }
export function equal(left: Value, right: Value): boolean { return left === right; }
` } });
    assert.equal(compiled.result.diagnostics.length, 0, "the existing native equality path remains admitted");
    assert.equal(compiled.result.artifacts.length > 0, true, "same-enum equality still emits native Rust");
  });
}
