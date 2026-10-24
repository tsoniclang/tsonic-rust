import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustReadOwnership } from "../../../dist/analysis/ownership/reads.js";
import { analyzeRustOwnershipFlow } from "../../../dist/analysis/ownership/flow.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";
import { rustBigIntTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustNativeStorageRoot, rustNativeStorageProjections } from "../../../dist/analysis/storage/native-paths.js";

for (const projection of [false, true]) test(`owned native getter results remain distinct from stored element places (projection=${projection})`, async () => {
  for (const [sourceType, payload] of [["string", rustStringTargetType()], ["bigint", rustBigIntTargetType()]]) {
    const source = createTargetSourceProgram(await checkedSource("ownership-native-getter-result", {
      "src/index.ts": `function inspect(values: (${sourceType} | undefined)[]): void { void (values[0]!); }`,
    }));
    const storage = createSourceStorageQuery(source, source.sourceFiles);
    const { ast } = source;
    const element = storage.nodes.find(node => ast.is.IsElementAccessExpression(node));
    assert.equal(element !== undefined, true, "the fixture keeps its original checked element source occurrence");
    const carrier = rustOptionTargetType(payload);
    for (const [label, form, owned] of [
      ["owned native getter", { form: "method", name: "get" }, true],
      ["native stored index", { form: "index" }, false],
    ]) {
      const builder = createRustProgramRecordBuilder();
      builder.runtimeCarriers.selected(element, carrier);
      if (projection) builder.flowReadProjections.project(element, carrier, payload, { kind: "option-value" });
      const abi = finalizeRustProviderOperationAbi({ operationKind: "indexer", form,
        sourceReceiver: { kind: "runtime", carrier: { kind: "array", element: carrier } },
        sourceArgumentCarriers: [rustSourcePrimitiveTargetType("int32")],
        resultCarrier: carrier, isAsync: false, isFallible: false });
      assert.equal(abi !== undefined, true, `${label}: the exact native receiver/result contract is present`);
      builder.targetOperations.source(element, { kind: "provider-operation", operationId: "fixture.native-getter", abi });
      for (const node of storage.nodes) if (ast.is.IsVoidExpression(node)) builder.targetOperations.source(node, {
        kind: "void-expression", operationId: "ownership-read.discard", resultCarrier: rustUnitTargetType(),
      });
      const nodes = new Set(storage.nodes);
      const selected = analyzeRustReadOwnership({ storage, nativeNodes: storage.nodes, records: builder.seal([]),
        flow: { movingReads: new Set(owned ? [element] : []), captureTransfers: new Map() },
        borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
        borrowEffectsInput: { ast, isNativeNode: node => nodes.has(node) }, definitions: emptyRustTypeDefinitions,
        genericRequirements: { supportsClone: () => true }, genericCallables: { definitionFor: () => undefined },
        capturesFor: () => undefined, invocationTransfersCapture: () => false, ownsExternalArgument: () => false,
      });
      assert.equal(selected.kind, "resolved", `${label}: the complete checked read inventory closes`);
      const read = selected.ownership.reads.get(element);
      assert.equal(read?.readsStorage, !owned, `${label}: source element syntax does not override the existing native owned-result proof`);
      assert.equal(read?.value.kind, owned ? "move" : "borrow", `${label}: a fresh owned payload is not reborrowed or cloned`);
      assert.equal(read?.source.kind, owned ? "move" : "borrow", `${label}: a native stored place keeps its exact shared lease`);
    }
  }
});

for (const [name, body, moves] of [
  ["terminal", "throw value;", [true]],
  ["transparent", "throw (((value)));", [true]],
  ["finally observed", "try { throw value; } finally { const retained = value; }", [false, true]],
  ["catch observed", "try { throw value; } catch { const retained = value; }", [false, true]],
]) {
  test(`a ${name} throw follows the checked source consumption and last-use contract`, async () => {
    const source = createTargetSourceProgram(await checkedSource("ownership-throw-consumption", {
      "src/index.ts": `function run(value: string): void { ${body} }`,
    }));
    const storage = createSourceStorageQuery(source, source.sourceFiles);
    const { ast } = source;
    const parameter = storage.nodes.find(node => ast.is.IsParameterDeclaration(node));
    const references = storage.nodes.filter(node => ast.is.IsIdentifier(node) &&
      ast.parent(node) !== parameter && source.navigation.sourceReferenceFor(node)?.declaration === parameter);
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes,
      capturesFor: () => undefined, isOnceCallable: () => false, canMoveStoredField: () => false,
      isOwnedOperationResult: () => false });
    assert.equal(selected.kind, "resolved", "the actual checked source graph closes before read publication");
    assert.equal(references.length, moves.length, "every original thrown or retained source read remains covered");
    for (const [index, reference] of references.entries()) assert.equal(selected.flow.movingReads.has(reference), moves[index],
      `${name}: read ${index} preserves catch/finally and later-use liveness`);
  });
}

for (const captureStorage of ["value", "cell", "borrow-cell", "location"]) {
  test(`a final source use respects actual ${captureStorage} capture storage`, async () => {
    const source = createTargetSourceProgram(await checkedSource("ownership-captured-native-storage", {
      "src/index.ts": `function read(value: ${captureStorage === "cell" ? "number" : "string"}) {
        const retained = () => value;
        void retained;
        return value;
      }`,
    }));
    const storage = createSourceStorageQuery(source, source.sourceFiles);
    const { ast } = source;
    const declaration = storage.nodes.find(node => ast.is.IsParameterDeclaration(node));
    const closure = storage.nodes.find(node => ast.is.IsArrowFunction(node));
    const reference = storage.nodes.find(node => ast.is.IsIdentifier(node) && ast.parent(node) === closure);
    const terminal = storage.nodes.find(node => ast.is.IsIdentifier(node) && ast.is.IsReturnStatement(ast.parent(node)));
    assert.equal(declaration !== undefined && closure !== undefined && reference !== undefined && terminal !== undefined, true,
      "the original checked closure and final outer read are both present");
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes,
      capturesFor: owner => owner !== closure ? undefined : { receivers: [], receiverFields: [], captures: [{
        declaration, reference, carrier: captureStorage === "cell" ? rustSourcePrimitiveTargetType("float64") : rustStringTargetType(),
        storage: captureStorage,
      }] },
      isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false });
    assert.equal(selected.kind, "resolved", "checked source liveness is complete");
    assert.equal(selected.flow.movingReads.has(terminal), captureStorage === "value",
      "only a real by-value binding can transfer; a final source use cannot move a cell payload");
    assert.equal(selected.flow.movingReads.has(reference), false, "a repeated retained invocation does not consume its capture");
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`a nested native receiver alias adds no phantom storage projection on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      class Owner { readonly owner: Owner = this; count: number = 1; }
      export function read(value: Owner): number { return value.owner.owner.count; }
    ` } });
    const { ast } = program.source;
    const fields = [];
    const visit = node => {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind === "source-field" && operation.valueSemantics.kind === "stored") fields.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(fields.length, 1, "the source has exactly one genuine stored-field read");
    const field = fields[0];
    const input = { ast, records: program.records, navigation: program.source.navigation };
    const root = rustNativeStorageRoot(field, input);
    assert.equal(root !== undefined, true, "the original checked input owns the native storage");
    const path = rustNativeStorageProjections(field, root, input);
    assert.equal(path?.length, 1, "both same-physical owner aliases add no fictitious field projection");
    assert.equal(path?.[0] === program.records.targetOperation.get(field).declaration, true,
      "the one real stored field retains its original checked declaration identity");
  });

  test(`a native receiver alias follows its actual stored or owned receiver on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      class Owner { readonly owner: Owner = this; }
      export function equal(left: Owner, right: Owner): boolean { return left.owner === right.owner; }
      export function direct(value: Owner): boolean { return value.owner !== value; }
      export function temporary(): boolean { return new Owner().owner === new Owner(); }
    ` } });
    const { ast } = program.source;
    const aliases = [];
    const visit = node => {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind === "source-field" && operation.valueSemantics.kind === "receiver-alias") aliases.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(aliases.length, 4, "all original stored and fresh native receiver aliases remain admitted");
    for (const node of aliases) {
      const receiver = ast.as.AsPropertyAccessExpression(node).Expression;
      const stored = !ast.is.IsNewExpression(receiver);
      const read = program.ownership.reads.get(node);
      assert.equal(read?.readsStorage, stored, "the readonly alias adds no fictitious native field storage");
      assert.equal(read?.value.kind, stored ? "borrow" : "move", "native ownership follows the exact receiver instead of cloning or moving a stored owner");
      assert.equal(read?.source.kind, stored ? "borrow" : "move", "the original source carrier retains the same native receiver contract");
    }
  });

  test(`a captured mutation takes its native snapshot before the later operand on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      class Token {}
      type Choice = string | Token;
      export function changing(initial: Choice, replacement: Choice): boolean {
        let current = initial;
        const replace = (): Choice => { current = replacement; return initial; };
        return current === replace();
      }
      export function stable(left: Choice, right: Choice): boolean { return left === right; }
    ` } });
    const { ast } = program.source;
    const comparisons = [];
    const visit = node => {
      if (program.records.targetOperation.get(node)?.kind === "union-equality") comparisons.push(ast.as.AsBinaryExpression(node));
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(comparisons.length, 2, "both mutation and genuinely readonly comparisons remain admitted");
    for (const comparison of comparisons) {
      const left = program.ownership.reads.get(comparison.Left);
      const changing = ast.text(comparison.Left) === "current";
      assert.equal(left?.readsStorage, true, "the operand is the original checked native storage read");
      assert.equal(left?.value.kind, changing ? "clone" : "borrow", "native cell movability and the actual later effect select one read");
      assert.equal(left?.borrowedAcross.has(comparison.Right), !changing, "only an actual safe native lease spans the later operand");
      if (changing) assert.equal(left?.source.kind, "clone", "the original payload is snapshotted, not moved out of its captured cell");
    }
  });
}

async function fixture() {
  const source = createTargetSourceProgram(await checkedSource("ownership-read-inventory", {
    "src/index.ts": `function read(value: string) { return ${"(".repeat(80)}value${")".repeat(80)}; }`,
  }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const nativeNodes = new Set(storage.nodes);
  const builder = createRustProgramRecordBuilder();
  const selected = storage.nodes.filter(node => source.ast.is.IsParenthesizedExpression(node) ||
    source.ast.is.IsIdentifier(node) && source.ast.text(node) === "value");
  for (const node of selected) builder.runtimeCarriers.selected(node, { kind: "target-named", id: "rust.std.String" });
  const input = {
    storage,
    nativeNodes: storage.nodes,
    records: builder.seal([]),
    flow: { movingReads: new Set(), captureTransfers: new Map() },
    borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
    borrowEffectsInput: { ast: source.ast, isNativeNode: node => nativeNodes.has(node) },
    definitions: emptyRustTypeDefinitions,
    genericRequirements: { supportsClone: () => true },
    genericCallables: { definitionFor: () => undefined },
    capturesFor: () => undefined,
    invocationTransfersCapture: () => false,
    ownsExternalArgument: () => false,
  };
  return { input, selected };
}

test("transparent storage reads are classified once from the complete checked inventory", async () => {
  const { input, selected } = await fixture();
  const selectedAnalysis = analyzeRustReadOwnership(input);
  assert.equal(selectedAnalysis.kind, "resolved");
  const wrappers = selected.filter(node => input.storage.source.ast.is.IsParenthesizedExpression(node));
  assert.equal(wrappers.length, 80);
  for (const node of selected) {
    const read = selectedAnalysis.ownership.reads.get(node);
    assert.equal(read?.readsStorage, true);
    assert.equal(read?.value.kind, "clone");
  }
});

test("an incomplete or unordered transparent inventory never silently selects a move", async () => {
  const { input, selected } = await fixture();
  const operand = selected.at(-1);
  for (const nodes of [input.storage.nodes.filter(node => node !== operand), [...input.storage.nodes].reverse()]) {
    const result = analyzeRustReadOwnership({ ...input, nativeNodes: nodes, storage: { ...input.storage, nodes } });
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID");
    assert.equal("ownership" in result, false);
  }
});

test("storage-read materialization respects finite node, work and row budgets before publication", async () => {
  const { input } = await fixture();
  for (const limits of [{ maximumNodes: 1 }, { maximumSteps: 1 }, { maximumTransportRows: 1 }]) {
    const result = analyzeRustReadOwnership({ ...input, limits });
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED");
    assert.equal("ownership" in result, false);
  }
});

for (const projection of [false, true]) {
  test(`an owned temporary transfers while a stored shared use retains its borrow (projection=${projection})`, async () => {
    for (const [sourceType, payload, ownedKind] of [
      ["string", rustStringTargetType(), "move"],
      ["number", rustSourcePrimitiveTargetType("float64"), "copy"],
    ]) {
      const source = createTargetSourceProgram(await checkedSource("ownership-owned-call-read", {
        "src/index.ts": `
          declare function get_text(): ${sourceType} | undefined;
          export function inspect(stored: ${sourceType} | undefined): void {
            void (get_text()!);
            void (stored!);
          }
        `,
      }));
      const storage = createSourceStorageQuery(source, source.sourceFiles);
      const { ast } = source;
      const temporary = storage.nodes.find(node => ast.is.IsCallExpression(node));
      const stored = storage.nodes.find(node => ast.is.IsIdentifier(node) && ast.text(node) === "stored" &&
        ast.is.IsNonNullExpression(ast.parent(node)));
      assert.equal(temporary !== undefined, true, "the checked fixture has its actual source invocation");
      assert.equal(stored !== undefined, true, "the checked fixture has its actual stored input read");
      const builder = createRustProgramRecordBuilder();
      const carrier = rustOptionTargetType(payload);
      for (const subject of [temporary, stored]) {
        builder.runtimeCarriers.selected(subject, carrier);
        if (projection) builder.flowReadProjections.project(subject, carrier, payload, { kind: "option-value" });
      }
      for (const node of storage.nodes) {
        if (ast.is.IsVoidExpression(node)) builder.targetOperations.source(node, {
          kind: "void-expression", operationId: "ownership-read.discard", resultCarrier: rustUnitTargetType(),
        });
      }
      const nativeNodes = new Set(storage.nodes);
      const selected = analyzeRustReadOwnership({
        storage, nativeNodes: storage.nodes, records: builder.seal([]),
        flow: { movingReads: new Set(), captureTransfers: new Map() },
        borrowEffects: { pureValues: new Set(), fieldWrites: new Map(), stableBindings: new Set(), nativeWrites: new Map() },
        borrowEffectsInput: { ast, isNativeNode: node => nativeNodes.has(node) },
        definitions: emptyRustTypeDefinitions,
        genericRequirements: { supportsClone: () => true },
        genericCallables: { definitionFor: () => undefined },
        capturesFor: () => undefined, invocationTransfersCapture: () => false, ownsExternalArgument: () => false,
      });
      assert.equal(selected.kind, "resolved", "the complete checked inventory admits the reads");
      const owned = selected.ownership.reads.get(temporary);
      const shared = selected.ownership.reads.get(stored);
      assert.equal(owned?.readsStorage, false, "an invocation does not read a native source place");
      assert.equal(owned?.value.kind, ownedKind, "the temporary payload is consumed without a borrowed adapter or hidden clone");
      assert.equal(owned?.source.kind, ownedKind, "narrowing does not reborrow the owned temporary container");
      assert.equal(shared?.readsStorage, true, "the input is a genuine native storage read");
      assert.equal(shared?.value.kind, "borrow", "an existing shared use keeps the input's native borrow");
      assert.equal(shared?.source.kind, "borrow", "a stored narrowed payload retains its container borrow");
    }
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`an owned external base argument follows native stored-read liveness on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      export class RetainedFailure extends Error {
        saved: string;
        constructor(message: string) { super(message); this.saved = message; }
      }
      export class TerminalFailure extends Error {
        constructor(message: string) { super(message); }
      }
    ` } });
    const { ast } = program.source;
    const constructors = new Map();
    const visit = node => {
      if (ast.is.IsConstructorDeclaration(node)) constructors.set(ast.text(ast.name(ast.parent(node))), node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    for (const [name, firstKind] of [["RetainedFailure", "clone"], ["TerminalFailure", "move"]]) {
      const owner = constructors.get(name);
      assert.equal(owner !== undefined, true, name + ": the actual native constructor is checked");
      const statements = ast.statements(ast.body(owner));
      const call = ast.as.AsExpressionStatement(statements[0]).Expression;
      const argument = ast.arguments(call)[0];
      const first = program.ownership.reads.get(argument);
      assert.equal(first?.readsStorage, true, name + ": the original message is a stored native input");
      assert.equal(first?.source.kind, firstKind, name + ": the owned field consumes one correctly selected native read");
      assert.equal(first?.value.kind, firstKind, name + ": the old provider borrow cannot override actual field ownership");
      if (name === "RetainedFailure") {
        const assignment = ast.as.AsBinaryExpression(ast.as.AsExpressionStatement(statements[1]).Expression);
        const last = program.ownership.reads.get(assignment.Right);
        assert.equal(last?.source.kind, "move", "the final saved field consumes the original after the one required clone");
        assert.equal(last?.value.kind, "move", "the final stored read never adds a second copy");
      }
    }
  });
}
