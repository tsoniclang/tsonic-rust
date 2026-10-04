import assert from "node:assert/strict";
import test from "node:test";
import { formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram, selectSourceNativeGuardResult } from "@tsonic/target-api/source";
import { checkedSource, namedDeclaration, projectSourceFile } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { minimalSourceGlobals } from "../../../../tsonic/test/fixtures/minimal-source-globals.mjs";
import { analyzeRustConstructionReadiness } from "../../../dist/analysis/project-types/construction-readiness.js";

async function readiness(name, statements) {
  const checked = await checkedSource(name, { "globals.d.ts": minimalSourceGlobals, "src/index.ts": `
export function fail(): void { throw 1; }
export class Value {
  value!: number;
  constructor(flag: boolean) { ${statements} }
  read(): number { return this.value; }
}
` });
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 2048));
  const source = createTargetSourceProgram(checked);
  const file = projectSourceFile(source, "src/index.ts");
  const declaration = namedDeclaration(source.ast, file, "Value");
  const failure = namedDeclaration(source.ast, file, "fail");
  const field = source.ast.members(declaration).find(node => source.ast.is.IsPropertyDeclaration(node));
  const constructor = source.ast.members(declaration).find(node => source.ast.is.IsConstructorDeclaration(node));
  const definition = { kind: "class", declaration };
  const fields = [{ declaration: field, absenceDefault: false, externallyInitialized: false }];
  return analyzeRustConstructionReadiness({ ast: source.ast, definition, fields,
    layers: [{ definition, constructor, fields, statements: source.ast.statements(source.ast.body(constructor)) }],
    selectedField(node) {
      const selected = source.semantics.forNode(node).operations.propertyAccess(node);
      return selected?.selectedDeclaration === field ? { declaration: field, accessMode: selected.accessMode } : undefined;
    },
    guardResult: node => selectSourceNativeGuardResult({ ast: source.ast, navigation: source.navigation,
      semanticsFor: node => source.semantics.forNode(node) }, node,
      () => undefined, () => undefined, () => undefined),
    unreachable: () => false,
    mayThrow: node => {
      const call = source.semantics.forNode(node).operations.call(node);
      return call !== undefined && source.semantics.forNode(node).declarations.signatureDeclaration(call.selectedSignature) === failure;
    },
  });
}

for (const [name, statements] of [
  ["finally-return", "try { return; } finally { this.value = 7; }"],
  ["do-initialization", "do { this.value = 4; } while (false);"],
  ["labeled-cleanup", "outside: while (true) { try { break outside; } finally { this.value = 7; } }"],
  ["catch-after-write", "try { this.value = 3; fail(); } catch { this.read(); }"],
]) test(`construction readiness proves exact completion: ${name}`, async () => {
  const result = await readiness(`construction-${name}`, statements);
  assert.equal(result.issues.length, 0, result.issues.map(row => row.reason).join("\n"));
  assert.equal(result.completesNormally, true);
});

for (const [name, statements] of [
  ["skipped-incrementor", "for (; true; this.value = 5) { break; }"],
  ["zero-iteration", "while (false) { this.value = 5; }"],
  ["catch-before-write", "try { fail(); this.value = 3; } catch { this.read(); }"],
  ["early-incomplete-return", "if (flag) return; this.value = 3;"],
]) test(`construction readiness rejects missing dominating storage: ${name}`, async () => {
  const result = await readiness(`construction-${name}`, statements);
  assert.equal(result.issues.length !== 0, true, "required storage or receiver readiness must be proven");
});

test("a labeled continue inside a switch is not mistaken for a constructor exit", async () => {
  const result = await readiness("construction-switch-continue", `
outside: for (;;) { switch (flag) { case true: continue outside; default: continue outside; } }
`);
  assert.equal(result.completesNormally, false);
  assert.equal(result.issues.length, 0);
});
