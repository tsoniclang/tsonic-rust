import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics } from "../helpers/rust-session.mjs";

function sourceDiagnostics(sourceText, surfaces = ["js"]) {
  return rustSourceDiagnostics(createRustSession({
    surfaces,
    files: { "index.ts": sourceText },
  }));
}

test("Rust JS Number locale declaration checks the same source argument contract as C#", () => {
  const diagnostics = sourceDiagnostics(`
    export function observe(value: number, locales: string[], options: object): string {
      const defaultText: string = value.toLocaleString();
      const localizedText: string = value.toLocaleString("en-US");
      const fallbackText: string = value.toLocaleString(locales, options);
      const absentText: string = value.toLocaleString(undefined, undefined);
      return defaultText + localizedText + fallbackText + absentText;
    }
  `);
  assert.equal(diagnostics, "", "Number method declarations are available to source checking, not a runtime-support claim");
});

for (const [label, argumentsText, code] of [
  ["numeric locale", "42", "TS2345"],
  ["numeric locale element", "[42]", "TS2322"],
  ["primitive options", '"en", true', "TS2345"],
  ["extra arguments", '"en", {}, 1', "TS2554"],
]) {
  test(`Rust JS Number locale declaration rejects ${label}`, () => {
    const diagnostics = sourceDiagnostics(`
      export function observe(value: number): string {
        return value.toLocaleString(${argumentsText});
      }
    `);
    assert.equal(diagnostics.includes(code), true, `${label}: exact checked argument refusal`);
    assert.equal(diagnostics.includes("TS2339"), false, `${label}: the method itself exists`);
  });
}

test("Rust native-only Number has no JavaScript locale method", () => {
  const diagnostics = sourceDiagnostics(`
    export function observe(value: number): string { return value.toLocaleString(); }
  `, []);
  assert.equal(diagnostics.includes("TS2339"), true, "a JS declaration is never added to the native-only profile");
});

test("Rust JS genuine Number locale call is refused precisely before sealing without a target operation", () => {
  const compiled = compileRust({
    surfaces: ["js"],
    files: { "index.ts": `
      export function observe(value: number): string { return value.toLocaleString(); }
    ` },
  });
  assert.equal(compiled.result.diagnostics.length, 1, "one precise unsupported operation, not a checker or planner crash");
  assert.equal(compiled.result.diagnostics[0]?.code, "RUST_SELECTED_OPERATION_UNSUPPORTED", "honest selected-operation refusal");
  assert.equal(compiled.result.diagnostics[0]?.message,
    "The selected JavaScript call 'Number.toLocaleString' has no closed Rust operation row for the selected receiver and argument carriers.",
    "metadata availability does not invent a Number locale runtime capability");
  assert.equal(compiled.result.program === undefined && compiled.result.plan === undefined, true, "unsupported operation is rejected before sealing");
  assert.equal(compiled.result.artifacts.length, 0, "no fallback native output is published");
});
