import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustFrameCallablePlan } from "../../../dist/analysis/callables/frame-values.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";

const joinedSource = `
type Identity = <Value>(value: Value) => Value;
function make(callback: () => number): Identity {
  const original = <Value>(value: Value): Value => { callback(); return value; };
  const alias: Identity = original;
  return alias;
}
export function choose(left: () => number, right: () => number, select: boolean): Identity {
  return select ? make(left) : make(right);
}
`;

function sourceNodes(program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return nodes;
}

test("published callable storage contains only finite read ports and keeps every selected answer stable", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedSource } });
  const storage = program.callableValues.nativeStorage;
  for (const name of ["subjectFor", "boundSubjectFor", "genericBindingsFor", "invocationReturnFor", "invocationInputFor",
    "invocationOriginsFor", "implementationOriginsFor"]) assert.equal(name in storage, false, `private construction port ${name}`);
  let selected = 0;
  for (const node of sourceNodes(program)) {
    const value = storage.valueFor(node);
    const operand = storage.operandFor(node);
    const returned = storage.returnFor(node);
    assert.equal(storage.valueFor(node) === value, true, "value read identity");
    assert.equal(storage.operandFor(node) === operand, true, "operand read identity");
    assert.equal(storage.returnFor(node) === returned, true, "return read identity");
    if (value.kind === "selected" || operand.kind === "selected" || returned.kind === "selected") selected += 1;
  }
  assert.equal(selected > 0, true, "the witness reads actual selected physical carriers");
});

test("every selected generic flow is one immutable physical application, including both conditional arms", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedSource } });
  const applications = program.callableValues.flowApplications;
  let flows = 0;
  for (const node of sourceNodes(program)) {
    const conversion = program.records.contextualValueConversion.get(node)?.conversion;
    if (conversion?.kind !== "generic-callable-flow") continue;
    const application = applications.forNode(node, conversion, undefined);
    assert.equal(applications.forNode(node, conversion, undefined) === application, true, "one selected flow record");
    assert.equal(Object.isFrozen(application), true, "immutable selected flow record");
    flows += 1;
  }
  assert.equal(flows > 0, true, "the witness contains actual admitted generic value flows");
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign source"); } });
  assert.throws(() => applications.forNode(foreign, foreign, foreign),
    failure => failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT", "unknown required source key");
  assert.equal(inspected, 0, "a missing source key never inspects foreign conversion metadata");
});

test("native producer publication reads completed results after source and return selection are revoked", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function identity(value: number): number { return value; }
export function choose(): typeof identity { return identity; }
` } });
  const ast = Proxy.revocable(program.source.ast, {});
  const records = Proxy.revocable(program.records, {});
  let open = true;
  let selections = 0;
  const construction = createRustNativeCallableProducerPlan({ ast: ast.proxy, nodes: sourceNodes(program), records: records.proxy,
    native: program.callableValues.native, definitions: program.typeDefinitions,
    returnCarrierFor(declaration) {
      assert.equal(open, true, "only private construction selects return storage");
      selections += 1;
      const selected = program.callableValues.nativeStorage.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  const requests = new Map();
  for (const node of sourceNodes(program)) {
    const value = program.records.directCallableReference.get(node);
    if (value !== undefined && rustCallableProtocol(value.carrier) !== undefined)
      requests.set(value.sourceDeclaration, [...requests.get(value.sourceDeclaration) ?? [], value.carrier]);
  }
  const published = construction.seal(requests);
  assert.equal("seal" in published, false, "the producer construction port is private");
  const before = selections;
  open = false;
  ast.revoke();
  records.revoke();
  assert.equal(published.producers.length > 0, true, "real native producer domain");
  for (const producer of published.producers) {
    const declaration = producer.declaration;
    const outward = published.outwardReturnFor(declaration);
    const invocation = published.invocationResultFor(declaration);
    const body = published.bodyResultFor(declaration);
    const error = published.errorFor(declaration, "invoke");
    assert.equal(published.outwardReturnFor(declaration) === outward, true, "outward result identity");
    assert.equal(published.invocationResultFor(declaration) === invocation, true, "invocation result identity");
    assert.equal(published.bodyResultFor(declaration) === body, true, "body result identity");
    assert.equal(published.errorFor(declaration, "invoke") === error, true, "producer error identity");
    for (const carrier of requests.get(declaration) ?? []) {
      const physical = published.physicalFor(declaration, carrier);
      assert.equal(physical !== undefined, true, "required physical request selected before publication");
      assert.equal(published.physicalFor(declaration, carrier) === physical, true, "physical producer identity");
    }
  }
  assert.equal(selections, before, "no source or storage selection after publication");
  assert.throws(() => construction.seal(requests), /exactly once/u, "one native producer publication");
});

test("published producer physical lookup rejects a foreign declaration without inspecting its carrier", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": "export function answer(): number { return 42; }" } });
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign carrier"); } });
  assert.equal(program.callableValues.nativeProducers.physicalFor(foreign, foreign) === undefined, true, "unknown declaration is absent");
  assert.equal(inspected, 0, "foreign declaration/metadata is not source-inspected");
});

test("frame reads and same-activation proofs remain data-only after construction inputs are revoked", () => {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped(): (count: number) => number {
  const value = new Value();
  const before = value.recurse;
  value.rebind();
  return before;
}
` } });
  const source = createTargetSourceProgram(checked);
  const sourceStorage = createSourceStorageQuery(source, program.sourceFiles);
  const guarded = [];
  const guard = value => {
    const selected = Proxy.revocable(value, {});
    guarded.push(selected);
    return selected.proxy;
  };
  const frames = createRustFrameCallablePlan({ ast: guard(program.source.ast), records: guard(program.records),
    ownership: guard(program.callableOwnership), sourceStorage: guard(sourceStorage), usedNames: new Set(),
    navigation: guard(source.navigation), projectTypes: guard(program.projectTypes),
    objectRepresentations: guard(program.objectRepresentations) });
  const nodes = sourceNodes(program);
  const witnesses = frames.definitions.flatMap(definition => definition.entries.flatMap(entry => entry.implementations
    .map(implementation => ({ definition, entry, implementation }))));
  assert.equal(witnesses.length > 0, true, "real class/frame entry alternatives");
  for (const selected of guarded) selected.revoke();
  for (const { definition, entry, implementation } of witnesses) {
    assert.equal(frames.definitionFor(implementation.carrier) === definition, true, "prepared frame owner");
    assert.equal(frames.entryFor(implementation.carrier) === entry, true, "prepared frame signature");
    const before = frames.isSameActivationInput(implementation.declaration, definition);
    assert.equal(before, true, "an owned entry belongs to its own activation");
    assert.equal(frames.isSameActivationInput(implementation.declaration, definition), before, "stable same-activation proof");
  }
  for (const node of nodes) {
    const definition = frames.definitionForOwner(node);
    if (definition !== undefined) assert.equal(frames.definitionForOwner(node) === definition, true, "native activation owner identity");
  }
  assert.equal(frames.isSameActivationInput({}, {}), false, "foreign activation is absent without source inspection");
});
