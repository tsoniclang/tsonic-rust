import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram, Node_Initializer } from "@tsonic/target-api/source";
import {
  createRustCallableOwnershipComponentQueries, defaultRustCallableOwnershipLimits,
} from "../../../dist/analysis/callables/ownership-components.js";
import { analyzeRustReceiverFieldCaptures } from "../../../dist/analysis/project-types/receiver-captures.js";

const lexicalSource = `
export function escaped(seed: number): (count: number) => number {
  let selected = (count: number): number => count === 0 ? seed : selected(count - 1);
  const before = selected;
  selected = (count: number): number => count === 0 ? 2 : selected(count - 1);
  return before;
}
`;

const fieldSource = `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void {
    this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1);
  }
}
`;

function fixture(text, options = {}) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/project",
    files: { "/project/index.ts": text },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics.slice(0, 4)).slice(0, 1024));
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/project/index.ts");
  assert.equal(file !== undefined, true, "exact checked source file");
  const nodes = [];
  const pending = [file];
  while (pending.length !== 0) {
    const node = pending.pop();
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  const storage = createSourceStorageQuery(source, [file]);
  const receiverCaptures = analyzeRustReceiverFieldCaptures({ ast: source.ast,
    navigation: source.navigation, semantics: source.semantics, sourceFiles: [file],
    projectTypes: { definitions: [], definitionContainingDeclaration: () => undefined },
    isStoredField: declaration => source.ast.is.IsPropertyDeclaration(declaration), deferredFields: new Set() });
  const input = { storage, receiverCaptures, ...options };
  const named = (name, kind) => nodes.filter(node => source.ast.kindName(node) === kind &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  return { source, nodes, storage, receiverCaptures, input, named,
    arrows: nodes.filter(node => source.ast.is.IsArrowFunction(node)),
    initializer: declaration => Node_Initializer(source.ast, declaration),
    analyze: changes => createRustCallableOwnershipComponentQueries({ ...input, ...changes }) };
}

function onlyComponent(queries) {
  assert.equal(queries.failureReason() === undefined, true, "bounded analysis completed");
  assert.equal(queries.issues.length, 0, "all ownership evidence closed");
  assert.equal(queries.components.length, 1, "one exact cyclic ownership component");
  return queries.components[0];
}

test("mutable lexical callbacks close over every original and replacement origin", () => {
  const current = fixture(lexicalSource);
  const queries = current.analyze();
  const component = onlyComponent(queries);
  const slot = current.named("selected", "KindVariableDeclaration")[0];
  const owner = current.named("escaped", "KindFunctionDeclaration")[0];
  assert.equal(component.kind, "lexical");
  assert.equal(component.ownerDeclaration === owner, true);
  assert.equal(component.activationScope === current.source.ast.body(owner), true);
  assert.equal(component.slotDeclarations.length, 1);
  assert.equal(component.slotDeclarations[0] === slot, true);
  assert.equal(component.callableDeclarations.length, 2);
  for (const arrow of current.arrows) assert.equal(queries.componentForCallable(arrow) === component, true);
  assert.equal(queries.componentForSlot(slot) === component, true);
  assert.equal(component.creationIdentity, "per-evaluation");
  assert.equal(component.externalCaptures.length, 1);
  assert.equal(component.externalCaptures[0].declaration === current.named("seed", "KindParameter")[0], true);
});

test("a replacement that does not recurse still belongs to the exact retained slot family", () => {
  const current = fixture(lexicalSource.replace(
    "selected = (count: number): number => count === 0 ? 2 : selected(count - 1);",
    "selected = (): number => 2;"));
  const queries = current.analyze();
  const component = onlyComponent(queries);
  assert.equal(component.callableDeclarations.length, 2);
  assert.equal(current.arrows.every(arrow => queries.componentForCallable(arrow) === component), true);
});

test("separate activations and identical signatures never merge by spelling or type", () => {
  const current = fixture(`
    export function left() {
      let selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
      selected = (): number => 2;
      return selected;
    }
    export function right() {
      let selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
      selected = (): number => 2;
      return selected;
    }
  `);
  const queries = current.analyze();
  assert.equal(queries.failureReason() === undefined, true);
  assert.equal(queries.issues.length, 0);
  assert.equal(queries.components.length, 2);
  const slots = current.named("selected", "KindVariableDeclaration");
  assert.equal(queries.componentForSlot(slots[0]) !== queries.componentForSlot(slots[1]), true);
  assert.equal(queries.components[0].ownerDeclaration !== queries.components[1].ownerDeclaration, true);
});

test("independent cycles in one activation remain separate ownership components", () => {
  const current = fixture(`
    export function escaped() {
      let left = (count: number): number => count === 0 ? 1 : left(count - 1);
      let right = (count: number): number => count === 0 ? 2 : right(count - 1);
      left = (): number => 3;
      right = (): number => 4;
      return [left, right];
    }
  `);
  const queries = current.analyze();
  assert.equal(queries.issues.length, 0);
  assert.equal(queries.components.length, 2);
  assert.equal(queries.components[0].ownerDeclaration === queries.components[1].ownerDeclaration, true);
  assert.equal(queries.componentForSlot(current.named("left", "KindVariableDeclaration")[0]) ===
    queries.componentForSlot(current.named("right", "KindVariableDeclaration")[0]), false);
});

test("a replacement capture joins two cyclic slots only through exact ownership edges", () => {
  const current = fixture(`
    export function escaped() {
      let left = (count: number): number => count === 0 ? 1 : left(count - 1);
      let right = (count: number): number => count === 0 ? 2 : right(count - 1);
      left = (count: number): number => right(count);
      return [left, right];
    }
  `);
  const component = onlyComponent(current.analyze());
  assert.equal(component.slotDeclarations.length, 2);
  assert.equal(component.callableDeclarations.length, 3);
});

test("an immutable self callback keeps its separately proven fixed recursion path", () => {
  const current = fixture(`
    export function escaped() {
      const selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
      return selected;
    }
  `);
  const queries = current.analyze();
  assert.equal(queries.failureReason() === undefined, true);
  assert.equal(queries.issues.length, 0);
  assert.equal(queries.components.length, 0);
  assert.equal(queries.componentForCallable(current.arrows[0]) === undefined, true);
});

test("a callback created by a nested activation cannot join the outer activation frame", () => {
  const current = fixture(`
    export function escaped() {
      let selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
      function replacement() {
        return (count: number): number => count === 0 ? 2 : selected(count - 1);
      }
      selected = replacement();
      return selected;
    }
  `);
  const queries = current.analyze();
  assert.equal(queries.failureReason() === undefined, true);
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => issue.reason.includes("different lexical activation")), true);
});

test("different lexical block scopes cannot be silently collapsed to one activation", () => {
  const current = fixture(`
    export function escaped() {
      let left: (count: number) => number;
      {
        const right = (count: number): number => count === 0 ? 1 : left(count - 1);
        left = (count: number): number => right(count);
      }
      return left;
    }
  `);
  const queries = current.analyze();
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => issue.reason.includes("one exact lexical activation")), true);
});

test("mutable class fields record selected member and same-instance receiver correspondence", () => {
  const current = fixture(fieldSource);
  const queries = current.analyze();
  const component = onlyComponent(queries);
  const owner = current.named("Value", "KindClassDeclaration")[0];
  const field = current.named("recurse", "KindPropertyDeclaration")[0];
  assert.equal(component.kind, "class");
  assert.equal(component.ownerDeclaration === owner, true);
  assert.equal(component.activationScope === owner, true);
  assert.equal(component.slotDeclarations.length, 1);
  assert.equal(component.slotDeclarations[0] === field, true);
  assert.equal(component.callableDeclarations.length, 2);
  assert.equal(component.receiverRelations.length, 2);
  for (const relation of component.receiverRelations) {
    assert.equal(relation.selectedDeclaration === field, true);
    assert.equal(relation.storageDeclaration === field, true);
    assert.equal(relation.receiverOwner === owner, true);
    assert.equal(current.source.ast.kindName(relation.receiver), "KindThisKeyword");
    assert.equal(current.source.semantics.forNode(relation.access).operations.propertyAccess(
      relation.access).selectedDeclaration === field, true);
  }
  assert.equal(component.externalCaptures.length, 0);
});

test("identically named fields in unrelated classes retain different canonical owners", () => {
  const current = fixture(fieldSource + fieldSource.replace("class Value", "class OtherValue"));
  const queries = current.analyze();
  assert.equal(queries.failureReason() === undefined, true);
  assert.equal(queries.issues.length, 0);
  assert.equal(queries.components.length, 2);
  const fields = current.named("recurse", "KindPropertyDeclaration");
  const first = queries.componentForSlot(fields[0]);
  const second = queries.componentForSlot(fields[1]);
  assert.equal(first !== undefined && second !== undefined, true);
  assert.equal(first !== second, true);
  assert.equal(first.ownerDeclaration !== second.ownerDeclaration, true);
});

test("mutual readonly fields close one component without treating immutability as fixed self", () => {
  const current = fixture(`
    class Parity {
      readonly even = (count: number): boolean => count === 0 ? true : this.odd(count - 1);
      readonly odd = (count: number): boolean => count === 0 ? false : this.even(count - 1);
    }
  `);
  const queries = current.analyze();
  const component = onlyComponent(queries);
  assert.equal(component.kind, "class");
  assert.equal(component.slotDeclarations.length, 2);
  assert.equal(component.callableDeclarations.length, 2);
  assert.equal(component.receiverRelations.length, 2);
  for (const field of current.named("even", "KindPropertyDeclaration").concat(
    current.named("odd", "KindPropertyDeclaration"))) assert.equal(queries.componentForSlot(field) === component, true);
});

test("repeated rebinding remains a per-evaluation identity requirement, never a syntax discriminant proof", () => {
  const current = fixture(fieldSource + `
    export function observe(): boolean {
      const value = new Value();
      value.rebind(); const first = value.recurse;
      value.rebind(); const second = value.recurse;
      return first !== second;
    }
  `);
  const component = onlyComponent(current.analyze());
  assert.equal(component.callableDeclarations.length, 2, "syntax origins do not count runtime creations");
  assert.equal(component.creationIdentity, "per-evaluation", "parent must prove fresh native entry identity");
});

test("static class storage is not falsely certified as an instance activation frame", () => {
  const current = fixture(fieldSource.replace("  recurse =", "  static recurse =").replace(
    "  rebind(): void", "  static rebind(): void"));
  const queries = current.analyze();
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => issue.reason.includes("static class owner")), true);
});

test("ordinary non-cyclic field captures remain explicit physical-planning inputs", () => {
  const current = fixture(fieldSource.replace("  recurse =", "  seed = 3;\n  recurse =").replace(
    "count === 0 ? 1 :", "count === 0 ? this.seed :"));
  const component = onlyComponent(current.analyze());
  const field = current.named("seed", "KindPropertyDeclaration")[0];
  assert.equal(component.externalCaptures.length, 1);
  assert.equal(component.externalCaptures[0].kind, "field");
  assert.equal(component.externalCaptures[0].declaration === field, true);
  assert.equal(component.slotDeclarations.includes(field), false);
});

for (const [name, extra] of [
  ["foreign callback source", `replace(other: Value): void { this.recurse = other.recurse; }`],
  ["foreign assignment receiver", `replace(other: Value): void {
    other.recurse = (count: number): number => count === 0 ? 3 : this.recurse(count - 1);
  }`],
]) test(`${name} is not proven by declaration-level source transport`, () => {
  const current = fixture(fieldSource.replace("  rebind(): void {", `  ${extra}\n  rebind(): void {`));
  const queries = current.analyze();
  assert.equal(queries.failureReason() === undefined, true);
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => /same-instance|foreign-instance|alias transport/.test(issue.reason)), true);
});

test("a fixed-self field remains excluded from this new physical ownership selection", () => {
  const current = fixture(`class Value {
    readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  }`);
  const arrow = current.arrows[0];
  const capture = current.receiverCaptures.capturesFor(arrow)[0];
  assert.equal(capture !== undefined, true, "exact checked field capture");
  const queries = current.analyze({ receiverCaptures: { ...current.receiverCaptures,
    fixedSelfFor: node => node === arrow ? capture : undefined } });
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.length, 0);
  assert.equal(queries.componentForCallable(arrow) === undefined, true);
});

for (const change of [
  capture => ({ ...capture, receiver: {} }),
  capture => ({ ...capture, reference: {} }),
  capture => ({ ...capture, declaration: {} }),
  capture => ({ ...capture, references: [] }),
]) test("stale field-capture evidence never supplies an exact receiver relationship", () => {
  const current = fixture(fieldSource);
  const arrow = current.arrows[0];
  const queries = current.analyze({ receiverCaptures: { ...current.receiverCaptures,
    capturesFor: node => current.receiverCaptures.capturesFor(node).map(capture =>
      node === arrow ? change(capture) : capture) } });
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.length > 0, true);
});

test("unresolved contributing origins block the complete cyclic family", () => {
  const current = fixture(lexicalSource);
  const slot = current.named("selected", "KindVariableDeclaration")[0];
  const queries = current.analyze({ storage: { ...current.storage, originsFor: subject =>
    subject.node === slot ? { kind: "unresolved", reason: "exact slot origin unavailable" }
      : current.storage.originsFor(subject) } });
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => issue.node === slot && issue.reason === "exact slot origin unavailable"), true);
});

test("external callable captures are retained without asserting they share the cyclic frame", () => {
  const current = fixture(lexicalSource.replace("seed: number", "seed: (count: number) => number").replace(
    "count === 0 ? seed :", "count === 0 ? seed(count) :"));
  const queries = current.analyze();
  assert.equal(queries.failureReason() === undefined, true);
  assert.equal(queries.components.length, 1);
  const component = queries.components[0];
  const parameter = current.named("seed", "KindParameter")[0];
  assert.equal(component.externalCaptures.some(capture => capture.declaration === parameter), true);
  assert.equal(component.slotDeclarations.includes(parameter), false, "external function ownership is not proved by value transport");
  assert.equal(queries.componentForSlot(parameter) === undefined, true);
  assert.equal(queries.issues.some(issue => issue.node === parameter), true, "external origin uncertainty remains explicit");
});

test("an origin outside the exact checked graph is never followed or inferred by shape", () => {
  const current = fixture(lexicalSource);
  const slot = current.named("selected", "KindVariableDeclaration")[0];
  const queries = current.analyze({ storage: { ...current.storage, originsFor: subject => subject.node === slot
    ? { kind: "resolved", origins: [{ subject: { kind: "value", node: {}, projection: [] }, type: {} }] }
    : current.storage.originsFor(subject) } });
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => issue.reason.includes("different checked source graph")), true);
});

test("source-storage failure prevents every ownership selection", () => {
  const current = fixture(lexicalSource);
  let reads = 0;
  const queries = current.analyze({ storage: { ...current.storage,
    failureReason: () => "source storage exhausted", get nodes() { reads++; return current.storage.nodes; } } });
  assert.equal(queries.failureReason(), "source storage exhausted");
  assert.equal(queries.components.length, 0);
  assert.equal(reads, 0, "failed transport supplies no partial ownership graph");
  assert.equal(queries.componentForCallable(current.arrows[0]) === undefined, true);
});

test("an incomplete receiver-capture query cannot publish partial ownership components", () => {
  const current = fixture(fieldSource);
  const queries = current.analyze({ receiverCaptures: { ...current.receiverCaptures,
    issues: [{ node: current.arrows[0], reason: "receiver capture evidence unavailable" }] } });
  assert.equal(queries.failureReason() !== undefined, true);
  assert.equal(queries.components.length, 0);
  assert.equal(queries.issues.some(issue => issue.reason === "receiver capture evidence unavailable"), true);
});

test("late shared budget exhaustion discards otherwise complete component rows", () => {
  const current = fixture(lexicalSource);
  let reads = 0;
  const queries = current.analyze({ storage: { ...current.storage,
    failureReason: () => ++reads >= 3 ? "late source storage exhaustion" : undefined } });
  assert.equal(queries.failureReason(), "late source storage exhaustion");
  assert.equal(queries.components.length, 0);
  assert.equal(queries.componentForCallable(current.arrows[0]) === undefined, true);
  assert.equal(queries.componentForSlot(current.named("selected", "KindVariableDeclaration")[0]) === undefined, true);
});

test("a tight aggregate work budget never publishes truncated capture selections", () => {
  const current = fixture(lexicalSource);
  const queries = current.analyze({ limits: { ...defaultRustCallableOwnershipLimits,
    maximumSteps: current.storage.nodes.length + 10 } });
  assert.equal(queries.failureReason() !== undefined, true);
  assert.equal(queries.components.length, 0);
  assert.equal(queries.componentForCallable(current.arrows[0]) === undefined, true);
});

for (const key of Object.keys(defaultRustCallableOwnershipLimits)) test(`${key} exhaustion returns no partial component`, () => {
  const current = fixture(lexicalSource);
  const queries = current.analyze({ limits: { ...defaultRustCallableOwnershipLimits, [key]: 1 } });
  assert.equal(queries.failureReason() !== undefined, true);
  assert.equal(queries.components.length, 0);
  assert.equal(queries.componentForCallable(current.arrows[0]) === undefined, true);
  assert.equal(queries.componentForSlot(current.named("selected", "KindVariableDeclaration")[0]) === undefined, true);
});

test("malformed limits are rejected without executing metadata accessors", () => {
  const current = fixture(lexicalSource);
  const limits = defaultRustCallableOwnershipLimits;
  let reads = 0;
  const accessor = { ...limits };
  Object.defineProperty(accessor, "maximumSteps", { get() { reads++; return limits.maximumSteps; }, enumerable: true });
  for (const selection of [null, {}, { ...limits, extra: 1 }, accessor,
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, limits.maximumSteps + 1].map(value =>
      ({ ...limits, maximumSteps: value }))]) {
    const queries = current.analyze({ limits: selection });
    assert.equal(queries.failureReason() !== undefined, true, "finite data-only limit selection");
    assert.equal(queries.components.length, 0);
  }
  assert.equal(reads, 0, "metadata selection does not evaluate a getter");
});

test("query rows and exact canonical mappings are immutable snapshots", () => {
  const current = fixture(fieldSource);
  let changed = false;
  const queries = current.analyze({ receiverCaptures: { ...current.receiverCaptures,
    storageDeclaration: declaration => changed ? {} : declaration } });
  const component = onlyComponent(queries);
  const field = current.named("recurse", "KindPropertyDeclaration")[0];
  changed = true;
  assert.equal(queries.componentForSlot(field) === component, true, "no later canonical-owner query");
  for (const value of [queries, queries.components, queries.issues, component, component.callableDeclarations,
    component.slotDeclarations, component.captures, component.externalCaptures, component.receiverRelations,
    ...component.captures, ...component.captures.map(capture => capture.references), ...component.receiverRelations])
    assert.equal(Object.isFrozen(value), true, "immutable ownership evidence");
  assert.equal(queries.componentForCallable({}) === undefined, true);
  assert.equal(queries.componentForSlot({}) === undefined, true);
});
