import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustClosureCaptureFactKey } from "../../../dist/analysis/facts/keys.js";

for (const surfaces of [[], ["js"]]) {
  test(`default receiver expressions retain their exact native owner on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      class Base<T> {
        constructor(public value: T) {}
        defaulted(value: T = this.value): T { return value; }
      }
      class Box<T> extends Base<T> { constructor(value: T) { super(value); } }
      export function run(): string { return new Box<string>("text").defaulted(); }
    ` } });
    const { ast } = program.source;
    const defaults = [];
    const visit = node => {
      if (ast.kindName(node) === "KindParameter") {
        const initializer = Node_Initializer(ast, node);
        if (initializer !== undefined) defaults.push(initializer);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) if (ast.getFileName(file).endsWith("/index.ts")) visit(file);
    assert.equal(defaults.length, 1, "one authored default initializer");
    const receiver = Node_Expression(ast, defaults[0]);
    assert.equal(receiver !== undefined, true, "exact default receiver expression");
    const carrier = program.facts.getRuntimeCarrierFact(receiver)?.carrier;
    assert.equal(rustSourceTypeCarrierValue(carrier)?.typeName, "Base", "declaring receiver, not derived request owner");
    const definition = program.projectTypes.definitionForCarrier(carrier);
    assert.equal(definition !== undefined, true, "receiver resolves its exact native declaration");
    assert.equal(ast.text(ast.name(definition.declaration)), "Base");
  });

  test(`default initializer lexical captures remain owned on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      export function factory(initial: number): (value?: number) => number {
        const captured = initial + 1;
        return (value: number = captured): number => value;
      }
      export function run(): number { return factory(3)(); }
    ` } });
    const { ast } = program.source;
    const callables = [];
    const visit = node => {
      if (ast.is.IsArrowFunction(node)) callables.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) if (ast.getFileName(file).endsWith("/index.ts")) visit(file);
    assert.equal(callables.length, 1);
    const capture = program.facts.getFact(callables[0], rustClosureCaptureFactKey);
    assert.equal(capture !== undefined, true, "sealed exact capture environment");
    assert.equal(capture.captures.length, 1, "the default-only reference is retained");
    assert.equal(ast.text(ast.name(capture.captures[0].declaration)), "captured");
  });
}
