import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { planRustFrameCallableEntry } from "../../../../dist/backend/planner/expressions/frame-callables.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

for (const retained of [false, true]) {
  for (const borrowed of [false, true]) {
    test(`frame capture uses the exact last-use proof, retained=${retained}, borrowed=${borrowed}`, () => {
      const { program } = analyzeRust({ files: { "index.ts": `
class Owner {
  callback = (depth: number): string => depth === 0 ? "seed" : this.callback(depth - 1);
  rebind(seed: string): void {
    const value = seed + "owned";
    this.callback = (depth: number): string => {
      if (depth !== 0) return this.callback(depth - 1);
      return value;
    };
    ${retained ? "if (value === \"keep\") this.callback(0);" : ""}
  }
}
export function escaped(value: string): (depth: number) => string {
  const owner = new Owner();
  owner.rebind(value);
  return owner.callback;
}
` } });
      const { ast } = program.source;
      const implementation = program.callableValues.frames.definitions.flatMap(definition =>
        definition.entries.flatMap(entry => entry.implementations)).find(candidate => candidate.captures.length === 1);
      assert.equal(implementation !== undefined, true, "the rebound callback uses its native frame entry");
      const node = implementation.declaration;
      const capture = implementation.captures[0];
      assert.equal(capture !== undefined && implementation.captures.length === 1, true, "one exact string capture");
      assert.equal(program.valueLifetimes.canMoveCapture(node, capture.declaration), !retained);
      const carrier = implementation.carrier;
      const definition = program.callableValues.frames.definitionFor(carrier);
      const context = {
        input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
        syntheticNames: createRustSyntheticNameState(ast, node, []),
        moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
        frameOwners: new Map([[definition, { kind: "construction", counter: { kind: "path", path: "counter" } }]]),
        ...(borrowed ? { capturedBindings: [{ declaration: capture.declaration,
          expression: { kind: "reference", expr: { kind: "path", path: "outer_value" } },
          storage: "value", valueCarrier: capture.carrier, borrowed: "shared" }] } : {}),
      };
      const planned = planRustFrameCallableEntry(node, carrier, context);
      assert.equal(context.diagnostics.length, 0, context.diagnostics.map(value => value.message).join("\n"));
      assert.equal(planned?.kind, "block");
      const expressions = [];
      const collect = value => {
        if (value === null || typeof value !== "object") return;
        if (value.kind === "struct-literal") expressions.push(value);
        for (const child of Object.values(value)) {
          if (Array.isArray(child)) child.forEach(collect);
          else collect(child);
        }
      };
      collect(planned);
      const payload = expressions.find(value => value.fields.some(field => field.name === "capture_0"));
      const value = payload?.fields.find(field => field.name === "capture_0")?.value;
      assert.equal(value !== undefined, true, "the entry retains its exact external capture");
      assert.equal(value.kind === "method-call" && value.method === "clone", retained || borrowed,
        "move only owned last-use captures; retained and borrowed captures still clone");
    });
  }
}
