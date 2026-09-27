import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustNamePlan } from "../../../dist/analysis/names/plan.js";
import { isValidRustAuthoredIdentifier, isValidRustIdentifier, rustTargetIdentifier } from "../../../dist/target-model/names/identifiers.js";
import { allocateRustGeneratedName } from "../../../dist/target-model/names/generated.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../../dist/backend/planner/names/synthetic.js";

function planNames(sourceText) {
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/project",
    files: { "/project/index.ts": sourceText },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  assert.ok(file);
  const plan = createRustNamePlan({
    ast: source.ast,
    sourceFiles: [file],
    runtimeValueUses: { hasFirstClassUse: () => true },
  });
  const declarations = [];
  const visit = node => {
    if (plan.nameForDeclaration(node) !== undefined) declarations.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  return { source, file, plan, declarations };
}

test("Rust preserves authored names rather than recasing or adding unused prefixes", () => {
  const { source, plan, declarations } = planNames(`
    export class http_response<valueType> {
      URLValue: valueType;
      constructor(inputValue: valueType) { this.URLValue = inputValue; }
      makeValue(unusedValue: boolean): valueType { return this.URLValue; }
    }
    export enum http_status { inProgress = 1, HTTP_OK = 2 }
    export const moduleValue = 3;
    export function makeValue(inputValue: number, unusedValue: string): number {
      const fooBar = inputValue;
      const foo_bar = 1;
      return fooBar + foo_bar;
    }
  `);
  assert.deepEqual(plan.diagnostics, []);
  for (const declaration of declarations) {
    assert.equal(plan.nameForDeclaration(declaration), source.ast.text(source.ast.name(declaration)));
  }
  assert.equal(plan.nameForSourceType("/project/index.ts", "http_response"), "http_response");
  assert.equal(plan.nameForSourceType("/project/index.ts", "http_status"), "http_status");
});

test("Rust keyword escaping preserves semantic identity without accepting raw source property spellings", () => {
  for (const [authored, target] of [["type", "r#type"], ["match", "r#match"], ["makeValue", "makeValue"], ["HTTP_OK", "HTTP_OK"]]) {
    assert.equal(rustTargetIdentifier(authored), target);
    assert.equal(isValidRustIdentifier(target), true);
    assert.equal(isValidRustAuthoredIdentifier(authored), true);
  }
  for (const authored of ["self", "Self", "super", "crate", "$value", "_", "r#type"]) {
    assert.equal(isValidRustAuthoredIdentifier(authored), false);
  }
  assert.equal(isValidRustIdentifier("r#type_2"), true);
  const rawSpelling = planNames('export interface RecordValue { "r#type": string; }');
  assert.deepEqual(rawSpelling.plan.diagnostics.map(diagnostic => diagnostic.code), ["RUST_AUTHORED_IDENTIFIER_UNREPRESENTABLE"]);
  const { plan } = planNames("export function read(self: string): string { return self; }");
  assert.deepEqual(plan.diagnostics.map(diagnostic => diagnostic.code), ["RUST_AUTHORED_IDENTIFIER_UNREPRESENTABLE"]);
});

test("Rust preserves valid non-ASCII source identifiers without deleting their characters", () => {
  const { source, plan, declarations } = planNames(`
    export interface 数据 { résumé: number; }
    export function 读取(entrée: 数据): number {
      const ΔValue = entrée.résumé;
      return ΔValue;
    }
  `);
  assert.deepEqual(plan.diagnostics, []);
  for (const declaration of declarations) {
    const name = source.ast.text(source.ast.name(declaration));
    assert.equal(plan.nameForDeclaration(declaration), name);
    assert.equal(isValidRustIdentifier(name), true);
  }
});

for (const kind of ["function", "variable"]) {
  test(`Rust ${kind} callable storage avoids exact authored names`, () => {
    const { source, plan, declarations } = planNames(`
      export const MAKE_VALUE_CALLABLE = 1;
      export const MAKE_VALUE_CALLABLE_2 = 2;
      ${kind === "function"
        ? "export function makeValue(inputValue: number): number { return inputValue; }"
        : "export const makeValue = (inputValue: number): number => inputValue;"}
    `);
    assert.deepEqual(plan.diagnostics, []);
    const declaration = declarations.find(node => source.ast.text(source.ast.name(node)) === "makeValue");
    assert.ok(declaration);
    assert.equal(plan.nameForDeclaration(declaration), "makeValue");
    assert.equal(plan.functionNameForDeclaration(declaration), "makeValue");
    assert.equal(plan.callableValueNameForDeclaration(declaration), "MAKE_VALUE_CALLABLE_3");
  });
}

test("Rust generated temporaries avoid authored names and keyword escapes", () => {
  const { source, file } = planNames(`
    export function makeValue(type: string): string {
      const result_value = type;
      const result_value_2 = result_value;
      const resultValue = result_value_2;
      return resultValue;
    }
  `);
  const state = createRustSyntheticNameState(source.ast, file, []);
  assert.equal(allocateRustSyntheticName(state, "resultValue"), "result_value_3");
  assert.equal(allocateRustSyntheticName(state, "resultValue"), "result_value_4");
  assert.ok(state.reserved.has("resultValue"));
  assert.ok(state.reserved.has("r#type"));
});

test("Rust private storage does not rename colliding authored public fields", () => {
  const { source, plan, declarations } = planNames(`
    export class Counter {
      #currentValue = 1;
      currentValue = 2;
      #type = 3;
      type = 4;
      type_2 = 5;
      readValue(): number { return this.#currentValue + this.currentValue + this.#type + this.type + this.type_2; }
    }
  `);
  assert.deepEqual(plan.diagnostics, []);
  const fields = declarations.filter(node => source.ast.is.IsPropertyDeclaration(node));
  assert.deepEqual(fields.map(node => [source.ast.text(source.ast.name(node)), plan.nameForDeclaration(node)]), [
    ["#currentValue", "currentValue_2"], ["currentValue", "currentValue"],
    ["#type", "type_3"], ["type", "r#type"], ["type_2", "type_2"],
  ]);
  assert.equal(allocateRustGeneratedName(new Set(["typeState", "typeState_2"]), "r#typeState"), "typeState_3");
});
