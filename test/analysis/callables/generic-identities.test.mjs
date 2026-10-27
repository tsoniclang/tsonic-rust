import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, int32Carrier } from "../../helpers/rust-session.mjs";
import { rustGenericCallableCarrier, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { selectRustGenericCallableIdentity } from "../../../dist/analysis/callables/generics/generic-identities.js";
import { createRustEffectsWorkBudget } from "../../../dist/analysis/errors/effects-work-budget.js";

function fixture(source, fileName = "index.ts") {
  const { program } = analyzeRust({ surfaces: [], entryPoint: fileName, files: { [fileName]: source } });
  const comparisons = [];
  const ast = program.source.ast;
  const visit = node => {
    const selected = program.callableValues.genericIdentities.forComparison(node);
    if (selected !== undefined) comparisons.push({ node, selected });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return { program, comparisons };
}

const declarations = `
  async function first(value: number): Promise<number> { return value; }
  async function second(value: number): Promise<number> { return value; }
  function selected(): typeof first { return first; }
  export function compare(): boolean {
    const alias = selected();
    return alias === first && alias !== second;
  }
`;

test("native identity closes only observed comparisons over exact declaration producers", () => {
  const current = fixture(declarations);
  assert.equal(current.program.callableValues.genericIdentities.issues.length, 0);
  assert.equal(current.comparisons.length, 2);
  const [same, other] = current.comparisons.map(row => row.selected);
  assert.equal(same.left === same.right, true);
  assert.equal(same.pairs.length, 1);
  assert.equal(same.pairs[0].left.implementation === same.pairs[0].right.implementation, true);
  assert.equal(same.pairs[0].kind, "declaration");
  assert.equal(same.exhaustive, true);
  const stored = current.program.callableValues.genericIdentities.forDefinition(same.left);
  assert.equal(stored !== undefined && stored.pairs.length === 1, true);
  assert.equal(current.program.callableValues.genericIdentities.forDefinition({ ...same.left }) === undefined, true);
  assert.equal(other.left === other.right, false);
  assert.equal(other.pairs.length, 0);
  assert.equal(other.exhaustive, false);
  for (const { node, selected } of current.comparisons) {
    assert.equal(current.program.callableValues.genericIdentities.forComparison(node) === selected, true);
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.pairs) &&
      selected.pairs.every(Object.isFrozen), true);
  }
  assert.equal(current.program.callableValues.genericIdentities.forComparison({}) === undefined, true,
    "foreign syntax has no identity proof");
});

test("native identity rejects invented producer identity and hidden physical arguments", () => {
  const current = fixture(declarations);
  const selected = current.comparisons[0].selected;
  const physical = current.program.callableValues.generic.physical;
  const original = rustGenericCallableValue(selected.leftCarrier);
  assert.equal(original.physical !== undefined, true);
  const invented = rustGenericCallableCarrier({ ...original, physical: { ...original.physical,
    members: original.physical.members.map(member => ({ ...member,
      origin: { ...member.origin, declarationIdentity: "foreign" } })),
  } });
  assert.equal(selectRustGenericCallableIdentity(invented, selected.rightCarrier, physical) === undefined, true);
  assert.throws(() => rustGenericCallableCarrier({ ...original, physical: { ...original.physical,
    members: original.physical.members.map(member => ({ ...member, arguments: [0] })),
  } }), /exact immutable origin and quantified signature/u);
  const incompatible = rustGenericCallableCarrier({ ...original,
    signature: { ...original.signature, parameters: [int32Carrier] },
  });
  assert.equal(selectRustGenericCallableIdentity(incompatible, selected.rightCarrier, physical) === undefined, true,
    "width and signature differences do not acquire an identity proof");
  const foreign = fixture(declarations, "foreign.ts").comparisons[0].selected;
  assert.equal(selectRustGenericCallableIdentity(foreign.leftCarrier, foreign.rightCarrier, physical) === undefined, true,
    "foreign exact source origins do not acquire an owned identity");
});

test("activation identity retains one producer with different exact native capture arguments", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
    export function compare(left: () => number, right: () => number): boolean {
      const first = make(left);
      const second = make(right);
      return first === second;
    }
  `);
  assert.equal(current.program.callableValues.genericIdentities.issues.length, 0);
  assert.equal(current.comparisons.length, 1);
  const selected = current.comparisons[0].selected;
  assert.equal(selected.pairs.length, 1);
  assert.equal(selected.pairs[0].kind, "activation");
  assert.equal(selected.pairs[0].left.implementation === selected.pairs[0].right.implementation, true);
  assert.equal(selected.left === selected.right, true,
    "one physical definition retains the different actual generic arguments");
  assert.notEqual(selected.leftCarrier.value.physical.arguments[0].type.identity,
    selected.rightCarrier.value.physical.arguments[0].type.identity);
});

test("an open callable parameter cannot manufacture closed identity evidence or artifacts", () => {
  const { result } = compileRust({ surfaces: [], files: { "index.ts": `
    type Identity = <Value>(value: Value) => Value;
    export function compare(left: Identity, right: Identity): boolean { return left === right; }
  ` } });
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.some(row => row.code === "RUST_CALLABLE_VALUE_NOT_CLOSED" &&
    row.message.includes("Native callable identity requires exact owned physical producers")), true);
});

test("stored identity retains cross-variant aliases of one source producer without unrelated pairs", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
    function choose(left: () => number, right: () => number, select: boolean): Identity {
      return select ? make(left) : make(right);
    }
    export function compare(left: () => number, right: () => number): boolean {
      const first = choose(left, right, true);
      const second = choose(left, right, false);
      return first === second;
    }
  `);
  const selected = current.comparisons[0].selected;
  const stored = current.program.callableValues.genericIdentities.forDefinition(selected.left);
  assert.equal(stored !== undefined, true);
  assert.equal(stored.pairs.length, 4, "both native capture arguments retain cross-variant source identity");
  assert.equal(stored.exhaustive, true);
  assert.equal(stored.pairs.every(pair => pair.left.implementation === pair.right.implementation), true);
  assert.equal(stored.pairs.filter(pair => pair.left !== pair.right).length, 2);
});

test("identity selection charges exact metadata and producer-pair work to the existing finite budget", () => {
  const current = fixture(declarations);
  const selected = current.comparisons[0].selected;
  const physical = current.program.callableValues.generic.physical;
  for (const maximum of [1, 0, NaN, Infinity, -1]) {
    const budget = createRustEffectsWorkBudget(maximum);
    assert.equal(selectRustGenericCallableIdentity(selected.leftCarrier, selected.rightCarrier, physical, budget) === undefined, true,
      String(maximum));
  }
  assert.equal(selectRustGenericCallableIdentity(selected.leftCarrier, selected.rightCarrier, physical) !== undefined, true);
});
