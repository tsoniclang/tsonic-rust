import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustBorrowStability } from "../../../dist/analysis/program/borrow-stability.js";
import { fakeAstReader } from "../../helpers/fake-compile-input.mjs";
import { argumentPassingFactKey, pointerOperationFactKey } from "@tsonic/tsts";
import { rustCompoundWriteFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { providerEvaluationOrderSource } from "../../../../tsonic/test/fixtures/provider-evaluation-order.mjs";
import { rustBindingStorageFactKey, rustContextualValueConversionFactKey, rustSourceBindingFactKey,
  rustOptionProjectionFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCapturedFieldStorageFactKey } from "../../../dist/analysis/facts/receiver-captures.js";
import { rustProviderInputBorrowMode } from "../../../dist/analysis/facts/provider-borrows.js";
import { rustCallArgumentIsOwned, rustCallArgumentMode } from "../../../dist/analysis/facts/parameter-passing.js";
import { borrowedScalarFieldWritesSource, ordinaryScalarFieldWritesSource, ownedFieldSnapshotSource } from "../../../../tsonic/test/fixtures/borrowed-scalar-field-writes.mjs";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";

function allNodes(ast, files) {
  const output = [];
  const pending = [...files];
  while (pending.length !== 0) {
    const node = pending.pop();
    output.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return output;
}

test("native binding comparisons borrow observations and distinguish exact replacement targets", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function observed(left: string[] | undefined, right: string[]): boolean { return left === right; }
    export function replaced(left: string[] | undefined, right: string[]): boolean { return left === (left = right); }
    export function unrelated(left: string[] | undefined, right: string[], other: string[]): boolean {
      return left === (right = other);
    }
    export function opaque(left: string[] | undefined, right: () => string[]): boolean { return left === right(); }
    export function observableOwnedResult(left: string | undefined, right: string): boolean { return left === right.trim(); }
  ` } });
  const { ast } = program.source;
  const nodes = allNodes(ast, program.sourceFiles);
  for (const [name, expected] of [["observed", true], ["replaced", false], ["unrelated", true], ["opaque", false],
    ["observableOwnedResult", false]]) {
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
    const comparison = allNodes(ast, [declaration]).find(node => ast.is.IsBinaryExpression(node) &&
      program.facts.getFact(node, rustTargetOperationFactKey)?.kind === "option-equality");
    assert.equal(comparison !== undefined, true, name);
    const left = BinaryExpression_Left(ast, comparison);
    const right = BinaryExpression_Right(ast, comparison);
    assert.equal(program.borrowStability.canBorrowAcross(left, right), expected, name);
    const binding = program.facts.getFact(left, rustSourceBindingFactKey);
    const facts = { ...program.facts, getFact(node, key) {
      return node === left && key === rustSourceBindingFactKey ? { ...binding, scope: "module" } : program.facts.getFact(node, key);
    } };
    const rejected = analyzeRustBorrowStability(analysisInput(program, facts));
    assert.equal(rejected.kind, "resolved", name);
    assert.equal(rejected.plan.canBorrowAcross(left, right), false, name + " foreign storage");
    if (name === "observableOwnedResult") {
      const operation = program.facts.getFact(right, rustTargetOperationFactKey);
      assert.equal(operation.kind, "provider-operation");
      assert.equal(operation.abi.effects.evaluation, "observable", "the actual source profile is never overridden in product");
      for (const [effects, accepted] of [
        [{ ...operation.abi.effects, evaluation: "pure" }, true],
        [{ ...operation.abi.effects, evaluation: "pure", safety: "requires-unsafe" }, false],
        [{ ...operation.abi.effects, evaluation: "pure", invocation: "fallible" }, false],
      ]) {
        const facts = { ...program.facts, getFact(node, key) {
          return node === right && key === rustTargetOperationFactKey
            ? { ...operation, abi: { ...operation.abi, effects } } : program.facts.getFact(node, key);
        } };
        const result = analyzeRustBorrowStability(analysisInput(program, facts));
        assert.equal(result.kind, "resolved");
        assert.equal(result.plan.canBorrowAcross(left, right), accepted, "exact native pure-input effect contract");
      }
      const carrier = operation.abi.result.carrier;
      const projection = { sourceCarrier: carrier, targetCarrier: carrier,
        conversion: { kind: "native-representation", source: carrier, target: carrier } };
      const projectedFacts = { ...program.facts, getFact(node, key) {
        if (node === right && key === rustTargetOperationFactKey) return {
          ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "pure" } },
        };
        return node === right && key === rustContextualValueConversionFactKey ? projection : program.facts.getFact(node, key);
      } };
      const projected = analyzeRustBorrowStability(analysisInput(program, projectedFacts));
      assert.equal(projected.kind, "resolved");
      assert.equal(projected.plan.canBorrowAcross(left, right), false,
        "pure invocation does not certify an independently projected result");
      const lift = program.facts.getFact(right, rustOptionProjectionFactKey);
      assert.equal(lift.kind, "some", "the real owned output retains native optional construction");
      const distinct = { kind: "source-primitive", name: "int64" };
      for (const replacement of [
        { kind: "none", sourceCarrier: lift.sourceCarrier, resultCarrier: lift.resultCarrier },
        { ...lift, sourceCarrier: distinct }, { ...lift, elementCarrier: distinct }, { ...lift, resultCarrier: carrier },
      ]) {
        const facts = { ...program.facts, getFact(node, key) {
          if (node === right && key === rustTargetOperationFactKey) return {
            ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "pure" } },
          };
          return node === right && key === rustOptionProjectionFactKey ? replacement : program.facts.getFact(node, key);
        } };
        const rejected = analyzeRustBorrowStability(analysisInput(program, facts));
        assert.equal(rejected.kind, "resolved");
        assert.equal(rejected.plan.canBorrowAcross(left, right), false, "only exact native Some construction is a pure result lift");
      }
    }
  }
});

function analysisInput(program, facts = program.facts) {
  return { ast: program.source.ast, sourceFiles: program.sourceFiles, facts, navigation: program.sourceNavigation,
    projectTypes: program.projectTypes, objectRepresentations: program.objectRepresentations,
    structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites };
}

function functionAssignment(program, name) {
  const ast = program.source.ast;
  const declaration = allNodes(ast, program.sourceFiles).find(node => ast.is.IsFunctionDeclaration(node) &&
    ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  assert.equal(declaration !== undefined, true, name);
  const assignment = allNodes(ast, [declaration]).find(node => ast.is.IsBinaryExpression(node) &&
    program.facts.getFact(node, rustTargetOperationFactKey)?.operator === "=");
  assert.equal(assignment !== undefined, true, name + " assignment");
  return assignment;
}

function indexedBindingFixture({ uses = 1_100, bindingWritten = false, scope = "lexical", passing, pointer } = {}) {
  const declaration = {};
  const receivers = [{ kindName: "KindIdentifier" }, { kindName: "KindIdentifier" }];
  const updates = receivers.map(receiver => ({ kindName: "KindPostfixUnaryExpression",
    operand: { kindName: "KindElementAccessExpression", receiver } }));
  const root = { children: updates };
  const useNodes = Array.from({ length: uses }, () => ({ kindName: "KindIdentifier" }));
  let summaries = 0;
  const reader = fakeAstReader();
  const input = {
    sourceFiles: [root],
    ast: { ...reader, is: { ...reader.is,
      IsIdentifier: node => receivers.includes(node) || useNodes.includes(node),
      IsPostfixUnaryExpression: node => updates.includes(node),
      IsElementAccessExpression: node => updates.some(update => update.operand === node),
    }, as: {
      AsPostfixUnaryExpression: node => ({ Operand: node.operand }),
      AsElementAccessExpression: node => ({ Expression: node.receiver }),
    }, parent: node => useNodes.includes(node) ? { kindName: "KindExpressionStatement" } : undefined,
    forEachChild: (node, visit) => (node.children ?? (node.operand === undefined
      ? node.receiver === undefined ? [] : [node.receiver] : [node.operand])).forEach(visit) },
    facts: { getRuntimeCarrierFact: () => undefined, getFact(node, key) {
      if (key === rustCompoundWriteFactKey && updates.includes(node)) return {
        abi: { targetReceiver: { kind: "input", input: { mode: "ref", conversion: { kind: "identity" } } } },
      };
      if (key === rustSourceBindingFactKey && receivers.includes(node)) return { scope, sourceDeclaration: declaration };
      if (useNodes.includes(node) && key === argumentPassingFactKey && passing !== undefined) return { mode: passing };
      if (useNodes.includes(node) && key === pointerOperationFactKey && pointer !== undefined) return { operation: pointer };
      return undefined;
    } },
    navigation: { declarationUseSummary(selected) {
      assert.equal(selected === declaration, true, "exact lexical declaration identity");
      summaries += 1;
      return { bindingWritten, exported: false, uses: useNodes.map(reference => ({ reference })) };
    } },
  };
  return { input, receivers, summaries: () => summaries };
}

test("indexed receiver stability has one sealed declaration proof beyond the retired per-use cutoff", () => {
  const fixture = indexedBindingFixture();
  const result = analyzeRustBorrowStability(fixture.input, 10_000);
  assert.equal(result.kind, "resolved", "more than2048harmless exposure visits fit the actual aggregate bound");
  assert.equal(fixture.summaries(), 1, "two demanded receivers share one exact declaration proof");
  fixture.input.navigation.declarationUseSummary = () => { throw new Error("sealed lookup cannot analyze"); };
  fixture.input.ast.parent = () => { throw new Error("sealed lookup cannot walk source syntax"); };
  for (const receiver of fixture.receivers) assert.equal(result.plan.canBorrowLocalBinding(receiver), true);
  assert.equal(result.plan.canBorrowLocalBinding({}), false, "foreign identity cannot obtain borrowing evidence");
});

test("indexed binding stability rejects exhaustion rather than silently materializing a receiver", () => {
  const fixture = indexedBindingFixture();
  const result = analyzeRustBorrowStability(fixture.input, 2_048);
  assert.equal(result.kind, "rejected");
  assert.equal("plan" in result, false, "an exhausted exposure proof cannot publish a partial plan");
  assert.equal(result.diagnostics[0].code, "RUST_BORROW_STABILITY_BUDGET_INVALID");
});

test("indexed binding stability caches negative decisions and preserves exact passing and pointer exposure rules", () => {
  for (const [name, options, expected] of [
    ["rebinding", { bindingWritten: true }, false],
    ["module", { scope: "module" }, false],
    ["mutable borrow", { passing: "borrow-mut" }, false],
    ["mutable byref", { passing: "byref" }, false],
    ["move", { passing: "move" }, false],
    ["address", { pointer: "address-of" }, false],
    ["shared borrow", { passing: "borrow-shared" }, true],
    ["readonly byref", { passing: "byref-readonly" }, true],
    ["value passing", { passing: "by-value" }, true],
  ]) {
    const fixture = indexedBindingFixture({ uses: 2, ...options });
    const result = analyzeRustBorrowStability(fixture.input, 100);
    assert.equal(result.kind, "resolved", name);
    for (const receiver of fixture.receivers) assert.equal(result.plan.canBorrowLocalBinding(receiver), expected, name);
    assert.equal(fixture.summaries(), options.scope === "module" ? 0 : 1, name + " completed decision is reused");
  }
});

test("source-checked indexed updates retain stable member writes but reject captured and direct rebinding", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
const moduleValues: number[] = [1];
export function stable(values: number[]): void { values[0]++; values[0] += 2; }
export function readonlyCapture(values: number[]): number { const read = () => values[0]; values[0]++; return read(); }
export function rebound(values: number[]): void { values[0]++; values = [2]; }
export function capturedWrite(values: number[]): void { const change = () => { values = [2]; }; values[0]++; change(); }
export function moduleUpdate(): void { moduleValues[0]++; }
` } });
  const ast = program.source.ast;
  const nodes = allNodes(ast, program.sourceFiles);
  for (const [name, expected] of [["stable", true], ["readonlyCapture", true], ["rebound", false],
    ["capturedWrite", false], ["moduleUpdate", false]]) {
    const declaration = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
    assert.equal(declaration !== undefined, true, name);
    const demands = allNodes(ast, [declaration]).filter(node => program.facts.getFact(node, rustCompoundWriteFactKey) !== undefined);
    assert.equal(demands.length > 0, true, name + " real finalized update demands");
    for (const demand of demands) {
      const target = ast.is.IsBinaryExpression(demand) ? BinaryExpression_Left(ast, demand) : ast.as.AsPostfixUnaryExpression(demand)?.Operand;
      const receiver = Node_Expression(ast, target);
      assert.equal(program.borrowStability.canBorrowLocalBinding(receiver), expected, name);
    }
  }
});

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`the exact projected-fields positive has sealed borrowed scalar writes in ${profile}`, () => {
    const fixture = receiverFieldCaptureEdges.find(example => example.name === "projected-fields");
    assert.equal(fixture !== undefined, true);
    const { program } = analyzeRust({ surfaces, files: { "index.ts": fixture.source } });
    const assignments = allNodes(program.source.ast, program.sourceFiles).filter(node =>
      program.source.ast.is.IsBinaryExpression(node) &&
      program.facts.getFact(node, rustTargetOperationFactKey)?.operator === "=");
    const writes = assignments.flatMap(node => {
      const selected = program.borrowStability.borrowedWriteFor(node);
      return selected === undefined ? [] : [[node, selected]];
    });
    assert.equal(writes.length, 2, "parameter and literal projected writes");
    assert.equal(Object.isFrozen(program.borrowStability), true);
    for (const [node, selected] of writes) {
      assert.equal(Object.isFrozen(selected), true);
      assert.equal(selected.target === BinaryExpression_Left(program.source.ast, node), true);
      assert.equal(selected.value === BinaryExpression_Right(program.source.ast, node), true);
      assert.equal(selected.receiver === Node_Expression(program.source.ast, selected.target), true);
      assert.equal(selected.location, "captured-field");
      assert.equal(program.objectRepresentations.receiverCaptures.isCaptured(selected.field.declaration), true);
      assert.equal(program.borrowStability.isPureCopyValue(selected.value), true);
      assert.equal(selected.fallible, profile === "js");
    }
    assert.equal(program.borrowStability.borrowedWriteFor({}) === undefined, true, "foreign source node");
  });

  test(`scalar storage stays pure while reentrant, getter and owned values retain snapshots in ${profile}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": borrowedScalarFieldWritesSource } });
    for (const name of ["parameter", "literal", "storage", "arithmetic"]) {
      const assignment = functionAssignment(program, name);
      assert.equal(program.borrowStability.borrowedWriteFor(assignment) !== undefined, true, name);
    }
    for (const name of ["reentrant", "accessor"]) {
      const assignment = functionAssignment(program, name);
      assert.equal(program.borrowStability.borrowedWriteFor(assignment) === undefined, true, name);
      assert.equal(program.borrowStability.isPureCopyValue(BinaryExpression_Right(program.source.ast, assignment)), false, name);
    }
    const owned = analyzeRust({ surfaces, files: { "index.ts": ownedFieldSnapshotSource } }).program;
    assert.equal(owned.borrowStability.borrowedWriteFor(functionAssignment(owned, "ownedWrite")) === undefined, true);
  });

  test(`ordinary class field borrows require independent physical states in ${profile}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": ordinaryScalarFieldWritesSource } });
    const distinct = program.borrowStability.borrowedWriteFor(functionAssignment(program, "distinct"));
    assert.equal(distinct !== undefined, true, "ordinary class scalar write");
    assert.equal(distinct.location, "stored-field");
    assert.equal(program.borrowStability.borrowedWriteFor(functionAssignment(program, "identical")) === undefined,
      true, "same carrier can alias the parent state");
  });

  test(`borrowed writes reject stale captures, unknown projections and non-stored views in ${profile}`, () => {
    const source = borrowedScalarFieldWritesSource.replace("interface Point { x: number; y: number; }",
      "type Point = { x: number; y: number };");
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const assignment = functionAssignment(program, "parameter");
    const selected = program.borrowStability.borrowedWriteFor(assignment);
    assert.equal(selected !== undefined, true);
    const targetFact = program.facts.getFact(selected.target, rustTargetOperationFactKey);
    assert.equal(targetFact.storage, "structural-object", "the structural mutation bank targets its actual owner");
    const storageFact = program.facts.getFact(selected.field.declaration, rustCapturedFieldStorageFactKey);
    assert.equal(storageFact !== undefined, true);
    const mutations = [
      [selected.receiver, rustTargetOperationFactKey, { ...selected.field, valueSemantics: { kind: "accessor", writable: true } }],
      [selected.receiver, rustTargetOperationFactKey, { ...selected.field, dispatch: { read: "read", write: "write", ownerCarrier: selected.field.receiverCarrier } }],
      [selected.receiver, rustTargetOperationFactKey, { ...selected.field, storageIndex: -1 }],
      [selected.target, rustTargetOperationFactKey, { ...targetFact, accessMode: "read-write" }],
      [selected.field.declaration, rustCapturedFieldStorageFactKey, undefined],
      [selected.field.declaration, rustCapturedFieldStorageFactKey, { ...storageFact, storage: { ...storageFact.storage, kind: "cell" } }],
      [selected.value, rustContextualValueConversionFactKey, { sourceCarrier: targetFact.resultCarrier, targetCarrier: targetFact.resultCarrier,
        conversion: { kind: "native-representation", source: targetFact.resultCarrier, target: targetFact.resultCarrier } }],
    ];
    for (const [index, [subject, key, replacement]] of mutations.entries()) {
      const facts = { ...program.facts, getFact(node, selectedKey) {
        return node === subject && selectedKey === key ? replacement : program.facts.getFact(node, selectedKey);
      } };
      const result = analyzeRustBorrowStability(analysisInput(program, facts));
      assert.equal(result.kind, "resolved", "mutation " + index);
      assert.equal(result.plan.borrowedWriteFor(assignment) === undefined, true, "mutation " + index);
    }
    const binding = program.facts.getFact(selected.value, rustSourceBindingFactKey);
    assert.equal(binding !== undefined, true);
    const locationFacts = { ...program.facts, getFact(node, key) {
      return node === binding.sourceDeclaration && key === rustBindingStorageFactKey
        ? { storage: "location", valueCarrier: targetFact.resultCarrier } : program.facts.getFact(node, key);
    } };
    assert.equal(analyzeRustBorrowStability(analysisInput(program, locationFacts)).plan.borrowedWriteFor(assignment) === undefined, true);
    const unknownCopy = { ...program.facts, getRuntimeCarrierFact(node) {
      return node === selected.value ? { carrier: { kind: "target-named", id: "external.CustomClone" } }
        : program.facts.getRuntimeCarrierFact(node);
    } };
    assert.equal(analyzeRustBorrowStability(analysisInput(program, unknownCopy)).plan.borrowedWriteFor(assignment) === undefined, true);
    for (const storage of ["bound", "property"]) {
      const input = analysisInput(program);
      const shapeField = input.structuralShapes.field(targetFact.receiverCarrier, targetFact.storageIndex);
      input.structuralShapes = { ...input.structuralShapes, field(carrier, index) {
        return carrier === targetFact.receiverCarrier && index === targetFact.storageIndex
          ? { ...shapeField, storage } : program.structuralShapes.field(carrier, index);
      } };
      assert.equal(analyzeRustBorrowStability(input).plan.borrowedWriteFor(assignment) === undefined, true, storage);
    }
    for (const replacement of [
      { readonly: true }, { method: true }, { nativeLayout: {} },
    ]) {
      const input = analysisInput(program);
      const shapeField = input.structuralShapes.field(targetFact.receiverCarrier, targetFact.storageIndex);
      input.structuralShapes = { ...input.structuralShapes, field(carrier, index) {
        return carrier === targetFact.receiverCarrier && index === targetFact.storageIndex
          ? { ...shapeField, ...replacement } : program.structuralShapes.field(carrier, index);
      } };
      assert.equal(analyzeRustBorrowStability(input).plan.borrowedWriteFor(assignment) === undefined, true, Object.keys(replacement)[0]);
    }
    const dispatched = analysisInput(program);
    dispatched.structuralShapes = { ...dispatched.structuralShapes, definitionForCarrier(carrier) {
      const shape = program.structuralShapes.definitionForCarrier(carrier);
      return carrier === targetFact.receiverCarrier ? { ...shape, dispatchName: "selected_dispatch" } : shape;
    } };
    assert.equal(analyzeRustBorrowStability(dispatched).plan.borrowedWriteFor(assignment) === undefined,
      true, "structural dispatch can conceal a bound state");
  });
}

test("only the exact finalized pure scalar provider ABI can extend a captured-field borrow", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": borrowedScalarFieldWritesSource + `
export function provider(holder: Value, value: number): void { holder.point.x = Math.abs(value); }
` } });
  const assignment = functionAssignment(program, "provider");
  const value = BinaryExpression_Right(program.source.ast, assignment);
  const operation = program.facts.getFact(value, rustTargetOperationFactKey);
  assert.equal(operation?.kind, "provider-operation");
  assert.equal(program.borrowStability.borrowedWriteFor(assignment) !== undefined, true);
  for (const [index, abi] of [
    { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "observable" } },
    { ...operation.abi, effects: { ...operation.abi.effects, safety: "requires-unsafe" } },
    { ...operation.abi, effects: { ...operation.abi.effects, invocation: "fallible" } },
    { ...operation.abi, sourceArguments: [] },
    { ...operation.abi, sourceArguments: operation.abi.sourceArguments.map(argument => ({ ...argument, form: "spread-sequence" })) },
  ].entries()) {
    const facts = { ...program.facts, getFact(node, key) {
      return node === value && key === rustTargetOperationFactKey ? { ...operation, abi } : program.facts.getFact(node, key);
    } };
    assert.equal(analyzeRustBorrowStability(analysisInput(program, facts)).plan.borrowedWriteFor(assignment) === undefined, true, String(index));
  }
});

test("provider property and indexed reads use their own AST input shape without call argument reconstruction", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": borrowedScalarFieldWritesSource + `
export function constant(holder: Value): void { holder.point.x = Math.PI; }
export function observed(holder: Value, text: string): void { holder.point.x = text.length; }
export function indexed(values: string[]): number { return values[0].length; }
` } });
  const constant = functionAssignment(program, "constant");
  assert.equal(program.borrowStability.borrowedWriteFor(constant) !== undefined, true, "exact pure constant ABI");
  const observed = functionAssignment(program, "observed");
  assert.equal(program.borrowStability.borrowedWriteFor(observed) === undefined, true,
    "an owned string observation is not an unprojected primitive Copy input");
});

test("borrow stability budgets are finite, bounded and reject cycles without AST diagnostics", () => {
  const root = { children: [{ children: [] }] };
  const input = {
    sourceFiles: [root], ast: { ...fakeAstReader(), is: { ...fakeAstReader().is,
      IsPrefixUnaryExpression: () => false, IsPostfixUnaryExpression: () => false },
      forEachChild: (node, visit) => node.children.forEach(visit) },
    facts: { getRuntimeCarrierFact: () => undefined, getFact: () => undefined },
  };
  assert.equal(analyzeRustBorrowStability(input, 1).kind, "rejected");
  assert.equal(analyzeRustBorrowStability(input, 2).kind, "resolved");
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4_194_305, Number.MAX_SAFE_INTEGER]) {
    const result = analyzeRustBorrowStability(input, limit);
    assert.equal(result.kind, "rejected", String(limit));
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].sourceNode === undefined, true);
    assert.equal(result.diagnostics[0].message.length < 160, true);
  }
  root.children.push(root);
  assert.equal(analyzeRustBorrowStability(input, 8).kind, "rejected", "cycle");
});

test("native field borrowing consumes exact disjoint scalar writes but rejects opaque calls and stale field facts", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": providerEvaluationOrderSource } });
  const ast = program.source.ast;
  const count = allNodes(ast, program.sourceFiles).length;
  assert.equal(analyzeRustBorrowStability(analysisInput(program), count).kind, "rejected",
    "native write correspondence consumes the same finite aggregate accounting budget");
  assert.equal(analyzeRustBorrowStability(analysisInput(program), count + 128).kind, "resolved");
  const methods = allNodes(ast, program.sourceFiles).filter(node => ast.is.IsMethodDeclaration(node));
  for (const name of ["next", "combined", "observed", "mutated"]) {
    const method = methods.find(node => ast.text(ast.name(node)) === name);
    const index = allNodes(ast, [method]).find(node => ast.is.IsElementAccessExpression(node));
    const receiver = Node_Expression(ast, index);
    const operand = ast.as.AsElementAccessExpression(index)?.ArgumentExpression;
    assert.equal(program.borrowStability.canBorrowAcross(receiver, operand), name !== "mutated", name);
    if (name !== "next") continue;
    assert.equal(program.borrowStability.canBorrowAcross(receiver, {}), false, "foreign node");
    assert.equal(program.borrowStability.canBorrowAcross(ast.as.AsPostfixUnaryExpression(operand)?.Operand, operand), false,
      "the exact same physical field is never treated as disjoint");
    const field = program.facts.getFact(receiver, rustTargetOperationFactKey);
    for (const replacement of [undefined, { ...field, storageIndex: -1 },
      { ...field, valueSemantics: { kind: "accessor", writable: true } },
      { ...field, dispatch: { read: "read", write: "write", ownerCarrier: field.receiverCarrier } }]) {
      const facts = { ...program.facts, getFact(node, key) {
        return node === receiver && key === rustTargetOperationFactKey ? replacement : program.facts.getFact(node, key);
      } };
      const selected = analyzeRustBorrowStability(analysisInput(program, facts));
      assert.equal(selected.kind, "resolved");
      assert.equal(selected.plan.canBorrowAcross(receiver, operand), false);
    }
  }
});

test("identity native shared references retain source borrowing without claiming mutable or owned input borrowing", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function inspect(value: string): number { return parseInt(value, 10); }
  ` } });
  const operation = allNodes(program.source.ast, program.sourceFiles)
    .map(node => program.facts.getFact(node, rustTargetOperationFactKey))
    .find(fact => fact?.kind === "provider-operation" && fact.abi.targetArguments[0]?.sourceCarrier?.kind === "reference");
  assert.equal(operation !== undefined, true, "actual selected native parsing input");
  const input = operation.abi.targetArguments[0];
  assert.equal(input.mode, "value");
  assert.equal(input.conversion.kind, "identity");
  assert.equal(input.sourceCarrier.mutable, false);
  assert.equal(rustProviderInputBorrowMode(input), "ref", "by-value shared reference does not own its referent");
  const distinct = { kind: "reference", mutable: false, referent: { kind: "source-primitive", name: "int64" } };
  const mutable = { ...input.sourceCarrier, mutable: true };
  const owned = { kind: "target-named", id: "rust.std.String" };
  for (const [label, replacement] of [
    ["parameter mismatch", { ...input, parameterCarrier: distinct }],
    ["source mismatch", { ...input, sourceCarrier: distinct }],
    ["conversion source mismatch", { ...input, conversion: { ...input.conversion, sourceCarrier: distinct } }],
    ["conversion target mismatch", { ...input, conversion: { ...input.conversion, targetCarrier: distinct } }],
    ["fallible conversion", { ...input, conversion: { ...input.conversion, fallible: true } }],
    ["mutable reference move", { ...input, sourceCarrier: mutable, parameterCarrier: mutable,
      conversion: { ...input.conversion, sourceCarrier: mutable, targetCarrier: mutable } }],
    ["owning value", { ...input, sourceCarrier: owned, parameterCarrier: owned,
      conversion: { ...input.conversion, sourceCarrier: owned, targetCarrier: owned } }],
    ["malformed native carrier", { ...input, sourceCarrier: { ...input.sourceCarrier, unknown: true } }],
  ]) assert.equal(rustProviderInputBorrowMode(replacement) === undefined, true, label);
  assert.equal(rustProviderInputBorrowMode({ ...input, sourceCarrier: distinct, parameterCarrier: distinct,
    conversion: { ...input.conversion, sourceCarrier: distinct, targetCarrier: distinct } }), "ref",
  "reference ownership is a native type rule, not a String or wrapper-name rule");
  assert.equal(rustProviderInputBorrowMode({ ...input, mode: "mut-ref" }), "mut-ref",
    "an explicit exclusive borrow retains its distinct mode");
});

test("source argument ownership follows all exact finalized native inputs rather than reference passing by value", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export function inspect(value: string): number { return parseInt(value, 10); }
  ` } });
  const { ast } = program.source;
  const call = allNodes(ast, program.sourceFiles).find(node => ast.is.IsCallExpression(node) &&
    ast.is.IsIdentifier(Node_Expression(ast, node)) && ast.text(Node_Expression(ast, node)) === "parseInt");
  assert.equal(call !== undefined, true);
  const argument = ast.arguments(call)[0];
  const radix = ast.arguments(call)[1];
  assert.equal(rustCallArgumentMode(argument, ast, program.facts), "ref");
  assert.equal(rustCallArgumentIsOwned(argument, ast, program.facts), false);
  assert.equal(rustCallArgumentMode(radix, ast, program.facts), "value");
  assert.equal(rustCallArgumentMode(Node_Expression(ast, call), ast, program.facts), undefined);
  const operation = program.facts.getFact(call, rustTargetOperationFactKey);
  const selected = operation.abi.targetArguments[0];
  for (const [label, targetArguments, expected] of [
    ["missing source relationship", [operation.abi.targetArguments[1]], undefined],
    ["repeated shared observation", [selected, selected, operation.abi.targetArguments[1]], "ref"],
    ["mixed shared and exclusive uses", [selected, { ...selected, mode: "mut-ref" }], undefined],
    ["nested native slice inputs", [{ source: { kind: "argument-slice", sourceIndexes: [0] },
      elements: [selected], elementCarrier: selected.sourceCarrier, mode: "ref", parameterCarrier: selected.parameterCarrier }], "ref"],
  ]) {
    const facts = { ...program.facts, get(node, key) {
      return node === call && key === rustTargetOperationFactKey
        ? { ...operation, abi: { ...operation.abi, targetArguments } } : program.facts.get(node, key);
    } };
    assert.equal(rustCallArgumentMode(argument, ast, facts), expected, label);
    assert.equal(rustCallArgumentIsOwned(argument, ast, facts), false, label);
  }
});

test("borrowed conversion effects require exact finalized input and pure native observation contracts", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": providerEvaluationOrderSource } });
  const ast = program.source.ast;
  const method = allNodes(ast, program.sourceFiles).find(node => ast.is.IsMethodDeclaration(node) &&
    ast.text(ast.name(node)) === "observed");
  assert.equal(method !== undefined, true);
  const nodes = allNodes(ast, [method]);
  const index = nodes.find(node => ast.is.IsElementAccessExpression(node));
  const receiver = Node_Expression(ast, index);
  const operand = ast.as.AsElementAccessExpression(index).ArgumentExpression;
  const observation = nodes.find(node => program.facts.getFact(node, rustTargetOperationFactKey)?.kind === "provider-operation" &&
    ast.is.IsPropertyAccessExpression(node));
  assert.equal(observation !== undefined, true);
  const operation = program.facts.getFact(observation, rustTargetOperationFactKey);
  const inputs = operation.abi.targetReceiver.kind === "input"
    ? [operation.abi.targetReceiver.input, ...operation.abi.targetArguments] : operation.abi.targetArguments;
  const input = inputs.find(selected => selected.conversion?.kind === "semantic");
  assert.equal(input !== undefined, true);
  assert.equal(rustProviderInputBorrowMode(input), "ref");
  assert.equal(program.borrowStability.canBorrowAcross(receiver, operand), true);
  for (const replacement of [
    { ...input, mode: "mut-ref" },
    { ...input, parameterCarrier: { kind: "source-primitive", name: "float64" } },
    { ...input, sourceCarrier: { kind: "source-primitive", name: "int32" } },
    { ...input, conversion: { ...input.conversion, fallible: true } },
    { ...input, conversion: { ...input.conversion, sourceCarrier: { kind: "source-primitive", name: "int32" } } },
    { ...input, conversion: { ...input.conversion, targetCarrier: { kind: "source-primitive", name: "int32" } } },
  ]) {
    assert.equal(rustProviderInputBorrowMode(replacement) === undefined, true, "inexact native borrow is not inferred");
  }
  for (const changes of [
    { effects: { ...operation.abi.effects, evaluation: "observable" } },
    { effects: { ...operation.abi.effects, safety: "requires-unsafe" } },
    { effects: { ...operation.abi.effects, invocation: "fallible" } },
    { result: { ...operation.abi.result, kind: "async" } },
    { sourceArguments: [{ form: "value", sourceIndex: 0 }] },
    { targetReceiver: operation.abi.targetReceiver.kind === "input"
      ? { kind: "input", input: { ...operation.abi.targetReceiver.input, mode: "mut-ref" } }
      : { kind: "none" }, targetArguments: operation.abi.targetArguments.map(selected => ({ ...selected, mode: "mut-ref" })) },
  ]) {
    const facts = { ...program.facts, getFact(node, key) {
      return node === observation && key === rustTargetOperationFactKey
        ? { ...operation, abi: { ...operation.abi, ...changes } } : program.facts.getFact(node, key);
    } };
    const result = analyzeRustBorrowStability(analysisInput(program, facts));
    assert.equal(result.kind, "resolved");
    assert.equal(result.plan.canBorrowAcross(receiver, operand), false, "unknown observation never extends the source borrow");
  }
});
