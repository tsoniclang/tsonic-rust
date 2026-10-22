import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { createRustProjectMethodPropertyPlanRegistry } from "../../../dist/analysis/project-types/method-properties.js";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";

function fixture(text, diagnosticCodes = []) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), diagnosticCodes);
  const named = (owner, name) => context.sourceStorage.nodes.find(node =>
    (context.ast.is.IsMethodDeclaration(node) || context.ast.kindName(node) === "KindMethodSignature") &&
    context.ast.text(context.ast.name(node)) === name &&
    context.ast.text(context.ast.name(context.ast.parent(node))) === owner);
  return { context, named, plan: context.projectMethodProperties,
    input: { ast: context.ast, navigation: context.source.navigation, projectTypes: context.projectTypes,
      semanticsFor: context.semanticsFor, isRuntimeReference: context.runtimeValueUses.isRuntimeReference,
      budget: createSourceStorageBudget(defaultSourceStorageLimits) } };
}

const method = `class Counter { next(): number { return 1; } }`;

test("method usage has one initialized producer and immutable lookup-only publication", () => {
  const current = fixture(`${method}
export function run(): number { const counter = new Counter(); const selected = counter.next; return selected(); }`);
  const registry = createRustProjectMethodPropertyPlanRegistry();
  assert.equal(Object.hasOwn(registry, "record"), false, "the superseded writer is absent");
  assert.throws(() => registry.usageFor(current.named("Counter", "next")), /before source analysis initialized/u);
  let reads = 0;
  const initialized = registry.initialize({ ...current.input, semanticsFor(node) {
    reads++;
    return current.context.semanticsFor(node);
  } });
  assert.equal(initialized.kind, "resolved");
  const selected = registry.usageFor(current.named("Counter", "next"));
  const readsAtSeal = reads;
  assert.equal(selected?.readable === true && selected.writable === false, true);
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(initialized.value.usages), true);
  assert.equal(registry.seal() === initialized.value, true);
  assert.equal(registry.usageFor(current.named("Counter", "next")) === selected, true);
  assert.equal(reads, readsAtSeal, "completed reads do not repeat checked selection");
  assert.throws(() => registry.initialize(current.input), /initialized only once/u);
});

test("direct calls and checked type-only member references need no property or replacement usage", () => {
  const current = fixture(`${method}
type Selected = Counter["next"];
export function run(): number { const counter = new Counter(); return counter.next(); }`);
  assert.equal(current.plan.usages.length, 0);
  assert.equal(current.plan.usageFor(current.named("Counter", "next")) === undefined, true);
});

test("an extracted method is readable without a replacement slot", () => {
  const current = fixture(`${method}
export function run(): number { const counter = new Counter(); const selected = counter.next; return selected(); }`);
  const selected = current.plan.usageFor(current.named("Counter", "next"));
  assert.equal(selected?.readable === true && selected.writable === false, true);
});

test("checked constant element writes and read-write uses retain their exact access flags", () => {
  const current = fixture(`${method}
export function run(): number {
  const counter = new Counter();
  counter["next"] ||= () => 2;
  return counter.next();
}`, ["RUST_PROJECT_METHOD_CALLABLE_NOT_CLOSED"]);
  const selected = current.plan.usageFor(current.named("Counter", "next"));
  assert.equal(selected?.readable === true && selected.writable === true, true);
});

test("constructor writes survive inherited receiver aliases and unrelated method names stay separate", () => {
  const current = fixture(`
class Base { next(): number { return 1; } }
class Derived extends Base { constructor() { super(); const alias = this; alias.next = () => 2; } }
class Other { next(): number { return 9; } }
export function run(): number {
  const derived = new Derived();
  const view: Base = derived;
  const selected = view.next;
  return selected() + new Other().next();
}`);
  const inherited = current.plan.usageFor(current.named("Base", "next"));
  assert.equal(inherited?.readable === true && inherited.writable === true, true);
  assert.equal(current.plan.usageFor(current.named("Other", "next")) === undefined, true);
});

test("interface reads join concrete writes by checked implementation identity", () => {
  const current = fixture(`
interface Contract { next(): number; }
class Counter implements Contract { next(): number { return 1; } }
export function run(counter: Counter): number {
  const view: Contract = counter;
  const selected = view.next;
  counter.next = () => 2;
  return selected();
}`);
  const selected = current.plan.usageFor(current.named("Counter", "next"));
  assert.equal(selected?.readable === true && selected.writable === true, true);
});

test("erased runtime-reference evidence does not seed a property demand", () => {
  const current = fixture(`${method}
export function run(): number { const counter = new Counter(); const selected = counter.next; return selected(); }`);
  const registry = createRustProjectMethodPropertyPlanRegistry();
  const initialized = registry.initialize({ ...current.input, isRuntimeReference: () => false });
  assert.equal(initialized.kind, "resolved");
  assert.equal(initialized.value.usages.length, 0);
});

test("the canonical declaration and implementation join distinct readable and writable seeds", () => {
  const current = fixture(`
class Counter {
  next(): number;
  next(): number { return 1; }
}
export function run(counter: Counter): number {
  const selected = counter.next;
  counter.next = () => 2;
  return selected();
}`);
  const declarations = current.context.sourceStorage.nodes.filter(node => current.context.ast.is.IsMethodDeclaration(node));
  assert.equal(declarations.length, 2);
  const implementation = declarations.find(node => current.context.ast.body(node) !== undefined);
  const checkedUses = [...new Map(declarations.flatMap(declaration =>
    current.context.source.navigation.declarationUses(declaration)).map(use => [use.reference, use])).values()];
  assert.equal(checkedUses.some(use => use.role === "write"), true, "the source has a checked write seed");
  assert.equal(checkedUses.some(use => use.kind === "first-class" && use.role !== "write"), true,
    "the source has a distinct checked read seed");
  const registry = createRustProjectMethodPropertyPlanRegistry();
  const initialized = registry.initialize({ ...current.input, navigation: {
    ...current.context.source.navigation,
    declarationUses(declaration) {
      return checkedUses.filter(use =>
        declaration === implementation ? use.role === "write" : use.role !== "write");
    },
  } });
  assert.equal(initialized.kind, "resolved");
  for (const declaration of declarations) {
    const selected = registry.usageFor(declaration);
    assert.equal(selected?.readable === true && selected.writable === true, true, "both canonical views join both flags");
  }
});

test("method-property resource failure is diagnosed before callable inference", () => {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `${method}
export async function run(): Promise<number> { return 1; }` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request, original => {
      const registry = Object.create(original.projectMethodProperties);
      Object.defineProperty(registry, "initialize", { value(input) {
        return original.projectMethodProperties.initialize({ ...input,
          budget: createSourceStorageBudget({ ...defaultSourceStorageLimits, maximumSteps: 1 }) });
      } });
      return { ...original, projectMethodProperties: registry };
    });
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["RUST_PROJECT_METHOD_PROPERTY_USAGE_NOT_CLOSED"]);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  assert.equal(context.records.asyncFunction.get(declaration) === undefined, true, "no async decision was published");
});
