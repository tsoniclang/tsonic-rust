import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { selectRustAsyncBodyLowering } from "../../../dist/analysis/callables/async/async-results.js";

function fixture(text) {
  const { context, walk } = analyzeRustOperations(text);
  const { ast, records } = context;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  context.sourceFiles.forEach(visit);
  const named = (predicate, name, owner) => {
    const selected = nodes.filter(node => predicate(node) && ast.text(ast.name(node)) === name &&
      (owner === undefined || ast.text(ast.name(ast.parent(node))) === owner));
    assert.equal(selected.length, 1, `${owner === undefined ? "" : `${owner}.`}${name}`);
    return selected[0];
  };
  const fact = (name, owner) => records.asyncFunction.get(owner === undefined
    ? named(node => ast.is.IsFunctionDeclaration(node), name)
    : named(node => ast.is.IsMethodDeclaration(node), name, owner));
  const nativeName = declaration => context.promiseBodies.nativeNameForDeclaration(declaration);
  return { context, walk, ast, records, nodes, named, fact, nativeName };
}

const header = `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
`;

test("an await-free JS body borrowing its input is settled with a one-argument Promise and no stored inputs", () => {
  const current = fixture(`${header}
export async function read<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return load(value); }
`);
  const fact = current.fact("read");
  assert.equal(fact?.kind, "js-promise");
  assert.equal(fact.lowering.kind, "settled");
  assert.equal(fact.lowering.settledAwaits.length, 0);
  assert.equal(fact.futureCarrier.genericArguments.length === 1 && fact.futureCarrier.genericArguments[0].kind === "type", true,
    "the settled Promise names its output only");
  assert.equal(Object.hasOwn(fact.lowering, "capturedParameters") || Object.hasOwn(fact.lowering, "ownedReceiver"), false,
    "a settled body stores no inputs");
  assert.equal(current.nativeName(current.named(node => current.ast.is.IsFunctionDeclaration(node), "read")),
    "read_native", "the settled declaration has its one canonical native body name");
});

test("a non-future await and its immutable nonvirtual method caller both have settled native bodies", () => {
  const current = fixture(`${header}
class Counter {
  calls: int32 = 0;
  next(): int32 { this.calls += 1; return this.calls; }
  async verify(): Promise<boolean> { return await this.next() === 1 && this.calls === 1; }
}
export async function main(): Promise<void> {
  const counter = new Counter();
  if (!await counter.verify()) throw new Error("await evaluated its input incorrectly");
}
`);
  const verify = current.fact("verify", "Counter");
  assert.equal(verify?.kind === "js-promise" && verify.lowering.kind === "settled", true, "Counter.verify is settled");
  assert.equal(verify.lowering.settledAwaits.length, 0, "a non-future await calls no helper");
  const main = current.fact("main");
  assert.equal(main?.kind === "js-promise" && main.lowering.kind === "settled", true,
    "the checked nonvirtual immutable method body cannot suspend");
});

test("an await of a directly called settled function is settled through the callee's canonical native body", () => {
  const current = fixture(`${header}
function identity<Region extends Life, Value>(value: Ref<Value, Region>): Ref<Value, Region> { return value; }
function read<Region extends Life>(value: Ref<int32, Region>): int32 { return load(value); }
function sum<Region extends Life>(left: Ref<int32, Region>, right: Ref<int32, Region>): int32 { return load(left) + load(right); }
async function suspended<Region extends Life>(value: Ref<int32, Region>): Promise<int32> { return load(value); }
async function forward<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
  return await suspended(identity(value)) + sum(value, value) + read(value);
}
export async function main(value: Ref<int32, Life>): Promise<int32> { return await forward(value); }
`);
  const isFunction = node => current.ast.is.IsFunctionDeclaration(node);
  const suspendedDeclaration = current.named(isFunction, "suspended");
  const forwardDeclaration = current.named(isFunction, "forward");
  const suspended = current.records.asyncFunction.get(suspendedDeclaration);
  const forward = current.records.asyncFunction.get(forwardDeclaration);
  assert.equal(suspended?.kind === "js-promise" && suspended.lowering.kind === "settled", true, "suspended is settled");
  assert.equal(forward?.kind === "js-promise" && forward.lowering.kind === "settled", true, "forward is settled");
  assert.equal(forward.lowering.settledAwaits.length, 1);
  const [selected] = forward.lowering.settledAwaits;
  assert.equal(selected.callee === suspendedDeclaration, true, "the settled await names its exact callee");
  assert.equal(current.ast.is.IsAwaitExpression(selected.expression), true, "the settled await names its await expression");
  const main = current.fact("main");
  assert.equal(main?.kind === "js-promise" && main.lowering.kind === "settled", true, "a settled callee chain stays settled");
  assert.equal(current.nativeName(suspendedDeclaration), "suspended_native");
  assert.equal(current.nativeName(forwardDeclaration), "forward_native");
});

test("an existing source name moves the native body name to the next free name without renaming the source", () => {
  const current = fixture(`${header}
async function value(): Promise<int32> { return 1; }
export function value_native(): int32 { return 2; }
export async function main(): Promise<int32> { return await value() + value_native(); }
`);
  const isFunction = node => current.ast.is.IsFunctionDeclaration(node);
  assert.equal(current.context.names.functionNameForDeclaration(current.named(isFunction, "value_native")), "value_native");
  assert.equal(current.nativeName(current.named(isFunction, "value")), "value_native_2");
});

test("a closed two-function await cycle has settled native bodies with no retained inputs", () => {
  const current = fixture(`${header}
export async function ping(count: int32): Promise<int32> { return count <= 0 ? 0 : await pong(count - 1); }
export async function pong(count: int32): Promise<int32> { return count <= 0 ? 0 : await ping(count - 1); }
`);
  for (const name of ["ping", "pong"]) {
    const fact = current.fact(name);
    assert.equal(fact?.kind === "js-promise" && fact.lowering.kind === "settled", true, `${name} is settled`);
    assert.equal(Object.hasOwn(fact.lowering, "capturedParameters"), false, `${name} retains no task inputs`);
    assert.equal(Object.hasOwn(fact.lowering, "ownedReceiver"), false, `${name} has no receiver`);
  }
  assert.equal(current.context.diagnostics.length, 0);
});

test("self and nested mutual cycles use the same exact native-edge completion rule", () => {
  const declarations = [
    "async function ping(count: int32): Promise<int32> { return count <= 0 ? 0 : await pong(count - 1); }",
    "async function pong(count: int32): Promise<int32> { return count <= 0 ? 0 : await ping(count - 1); }",
  ];
  for (const ordered of [declarations, [...declarations].reverse()]) {
    const current = fixture(`${header}
export async function outer(count: int32): Promise<int32> {
  ${ordered.join("\n")}
  return await ping(count);
}
export async function descend(count: int32): Promise<int32> { return count <= 0 ? 0 : await descend(count - 1); }
`);
    for (const name of ["outer", "ping", "pong", "descend"]) {
      assert.equal(current.fact(name)?.lowering.kind, "settled", `${name}: ordered closed native recursion`);
    }
    assert.equal(current.context.diagnostics.length, 0, "closed native recursion has no source rejection");
  }
});

test("an actual Promise-input suspension keeps every member of a recursive component suspending", () => {
  const current = fixture(`${header}
export async function ping(count: int32, pending: Promise<void>): Promise<int32> {
  await pending;
  return count <= 0 ? 0 : await pong(count - 1, pending);
}
export async function pong(count: int32, pending: Promise<void>): Promise<int32> {
  return count <= 0 ? 0 : await ping(count - 1, pending);
}
`);
  for (const name of ["ping", "pong"]) {
    assert.equal(current.fact(name)?.lowering.kind, "factory", `${name}: real pending input remains suspending`);
  }
});

test("an awaited method call is not a direct call when a subclass overrides it with a suspending body (R4-m1)", () => {
  let context;
  compileRust({ surfaces: ["js"], files: { "index.ts": `${header}
class Base { async value(): Promise<int32> { return 1; } }
class Derived extends Base { override async value(): Promise<int32> { await Promise.resolve(0); return 2; } }
export async function viaMethod(source: Base): Promise<int32> { return await source.value(); }
` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  const { ast, records } = context;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  context.sourceFiles.forEach(visit);
  const lowering = (predicate, name, owner) => {
    const selected = nodes.filter(node => predicate(node) && ast.text(ast.name(node)) === name &&
      (owner === undefined || ast.text(ast.name(ast.parent(node))) === owner));
    assert.equal(selected.length, 1, name);
    const fact = records.asyncFunction.get(selected[0]);
    return fact?.kind === "js-promise" ? fact.lowering.kind : undefined;
  };
  assert.equal(lowering(node => ast.is.IsMethodDeclaration(node), "value", "Base"), "settled");
  assert.equal(lowering(node => ast.is.IsMethodDeclaration(node), "value", "Derived"), "factory");
  assert.equal(lowering(node => ast.is.IsFunctionDeclaration(node), "viaMethod"), "factory",
    "the statically named Base.value is settled, but the call may reach the suspending override");
  assert.equal(context.diagnostics.some(diagnostic => diagnostic.code === "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN"), false);
});

test("an awaited call through a function value is not a direct call", () => {
  const current = fixture(`${header}
const callback = async (): Promise<int32> => 3;
export async function viaValue(): Promise<int32> { return await callback(); }
export async function main(): Promise<int32> { return await viaValue(); }
`);
  const viaValue = current.fact("viaValue");
  assert.equal(viaValue?.kind === "js-promise" && viaValue.lowering.kind === "factory", true, "viaValue may suspend");
  const main = current.fact("main");
  assert.equal(main?.kind === "js-promise" && main.lowering.kind === "factory", true, "main awaits a factory");
});

test("settled direct chains are independent of declaration order", () => {
  const leaf = "async function leaf(): Promise<number> { return 1; }";
  const middle = "async function middle(): Promise<number> { return await leaf(); }";
  const root = "export async function root(): Promise<number> { return await middle(); }";
  for (const statements of [[leaf, middle, root], [root, middle, leaf]]) {
    const current = fixture(statements.join("\n"));
    for (const name of ["leaf", "middle", "root"]) assert.equal(current.fact(name)?.lowering.kind, "settled", name);
    assert.equal(current.fact("root").lowering.settledAwaits.length, 1);
    assert.equal(current.fact("middle").lowering.settledAwaits.length, 1);
  }
});

test("pending carrier evidence is not memoized as a final suspending answer", () => {
  const current = fixture("export async function root(): Promise<number> { return await 1; }");
  const root = current.named(node => current.ast.is.IsFunctionDeclaration(node), "root");
  let missing = true;
  const context = { ...current.context,
    records: { ...current.records, asyncFunction: { get: () => undefined } },
    semanticsFor(node) {
      const semantics = current.context.semanticsFor(node);
      return { ...semantics, types: { ...semantics.types,
        expressionType: expression => missing ? undefined : semantics.types.expressionType(expression),
      } };
    },
  };
  const walk = { ...current.walk, context };
  assert.equal(selectRustAsyncBodyLowering(walk, root).kind, "pending");
  missing = false;
  const selected = selectRustAsyncBodyLowering(walk, root);
  assert.equal(selected.kind, "settled");
  assert.equal(selected.settledAwaits.length, 0);
});

test("a mutable async function value never receives a named native body", () => {
  const current = fixture(`
    let value = async (): Promise<number> => 1;
    value = async (): Promise<number> => { await Promise.resolve(0); return 2; };
    export async function root(): Promise<number> { return await value(); }
  `);
  const value = current.named(node => current.ast.is.IsVariableDeclaration(node), "value");
  assert.equal(current.context.source.navigation.declarationUseSummary(value).bindingWritten, true);
  assert.equal(current.fact("root")?.lowering.kind, "factory");
  assert.equal(current.nativeName(value) === undefined, true);
});

test("direct helper selection requires the exact declaration's immutable binding evidence", () => {
  const current = fixture(`
    async function value(): Promise<number> { return 1; }
    export async function root(): Promise<number> { return await value(); }
  `);
  const root = current.named(node => current.ast.is.IsFunctionDeclaration(node), "root");
  const value = current.named(node => current.ast.is.IsFunctionDeclaration(node), "value");
  const navigation = current.context.source.navigation;
  const walk = { ...current.walk, context: { ...current.context,
    records: { ...current.records, asyncFunction: { get: () => undefined } },
    source: { ...current.context.source, navigation: { ...navigation,
      declarationUseSummary(declaration) {
        const summary = navigation.declarationUseSummary(declaration);
        return declaration === value ? { ...summary, bindingWritten: true } : summary;
      },
    } },
  } };
  assert.equal(selectRustAsyncBodyLowering(walk, root).kind, "suspending");
  assert.throws(() => fixture(`
    async function value(): Promise<number> { return 1; }
    value = async (): Promise<number> => 2;
  `), /TS2630/u);
});
