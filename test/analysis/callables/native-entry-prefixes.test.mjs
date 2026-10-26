import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustNativeHelperStatePassing, selectRustNativeFrameOwnerPassing, selectRustNativeStructuralReceiverPassing } from "../../../dist/policy/ownership/generic-callables.js";
import { rustTargetGenericArgumentEquals, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { prepareRustClassImplementationContexts } from "../../../dist/analysis/objects/class-implementation-contexts.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";

test("native class entry contexts preserve the exact original owner bindings before header selection", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Box<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
  read(): Value { return this.value; }
}
class Other<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
}
export function read(): number { return new Box<number>(1).read(); }
` } });
  const nodes = [];
  assert.equal("callableEntries" in program, false, "private native entry construction authority is absent from the published analysis program");
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const observed = new Map();
  let count = 0;
  const observe = (declaration, carrier, selected) => {
    const keys = observed.get(declaration) ?? new Set();
    const key = closedMetadataKey(carrier);
    assert.equal(keys.has(key), false, "an exact original owner and instance are published only once");
    keys.add(key);
    observed.set(declaration, keys);
    const prior = program.records.classImplementationContext.get(declaration, carrier);
    assert.equal(prior !== undefined, true, "the same owner inventory supplies the real completed program context");
    assert.equal(selected.types.size === prior.types.size && [...selected.types].every(([identity, type]) =>
      rustTargetTypeRefEquals(type, prior.types.get(identity))), true, "original-to-native type substitutions are unchanged");
    assert.equal(selected.lifetimes.size === prior.lifetimes.size && [...selected.lifetimes].every(([identity, lifetime]) =>
      prior.lifetimes.has(identity) && rustLifetimeKey(lifetime) === rustLifetimeKey(prior.lifetimes.get(identity))), true,
    "original-to-native lifetime substitutions are unchanged");
    assert.equal(selected.names.size === prior.names.size && [...selected.names].every(([identity, name]) => prior.names.get(identity) === name),
      true, "the original hygienic native binder names are preserved");
    assert.equal(selected.types.set === undefined && selected.lifetimes.set === undefined && selected.names.set === undefined,
      true, "published original-owner correspondence exposes no mutation route");
    count++;
  };
  const complete = prepareRustClassImplementationContexts(program, { implementationContext: observe }, nodes);
  assert.equal(count > 0, true, "the real generic native class exercises owner-context publication");
  complete.seal();
  observed.clear();
  count = 0;
  const contexts = prepareRustClassImplementationContexts(program, { implementationContext: observe }, []);
  assert.equal(count > 0, true, "the separate source-node-free owner prepares its original open class contexts");
  const definition = program.projectTypes.definitions.find(definition => definition.kind === "class" &&
    program.source.ast.text(program.source.ast.name(definition.declaration)) === "Box");
  assert.equal(definition !== undefined, true, "the exact original native class owns its context query");
  const carrier = program.projectTypes.openCarrier(definition);
  const instance = nodes.map(node => program.records.runtimeCarrier.get(node)?.carrier).find(selected =>
    selected !== undefined && program.projectTypes.definitionForCarrier(selected) === definition && !rustTargetTypeRefEquals(selected, carrier));
  assert.equal(instance !== undefined, true, "the checked source supplies an actual concrete native class instance for later demand");
  assert.equal(observed.get(definition.declaration)?.has(closedMetadataKey(instance)), false,
    "the intentionally source-node-free initial context inventory has not admitted that concrete instance");
  const other = program.projectTypes.definitions.find(definition => definition.kind === "class" &&
    program.source.ast.text(program.source.ast.name(definition.declaration)) === "Other");
  assert.equal(other !== undefined && other.genericParameters.length === definition.genericParameters.length, true,
    "the wrong-owner inverse has the same authored generic arity");
  assert.throws(() => contexts.forInstance(other, instance), /A native class implementation context requires its exact original carrier owner/u,
    "matching generic arity cannot substitute a foreign original owner");
  const initial = count;
  const concrete = contexts.forInstance(definition, instance);
  assert.equal(count, initial + 1, "a real late physical instance is admitted once by the original context producer");
  assert.equal(contexts.forInstance(definition, instance) === concrete, true, "a repeated late request reuses its canonical immutable context");
  const selected = contexts.forInstance(definition, carrier);
  const before = count;
  contexts.seal();
  contexts.seal();
  assert.equal(contexts.forInstance(definition, carrier) === selected, true, "a closed context owner reads the exact original instance without recomputation");
  assert.equal(count, before, "repeated context reads and seals cannot publish the same native instance twice");
  assert.throws(() => contexts.forInstance(definition, { kind: "source-primitive", name: "bool" }),
    /A sealed class implementation context cannot admit a new native instance/u,
    "a closed owner cannot compute or publish a new instance");
});

test("native async entry captures retain authored phantom type identities even without a stored value", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export async function empty<Value>(): Promise<void> {}
` } });
  let declaration;
  const visit = node => {
    if (program.source.ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === "empty") declaration = node;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declaration !== undefined, true, "the original async declaration is retained");
  const selected = program.records.callableLeading.get(declaration);
  const parameter = selected?.genericHeader?.sourceContract.parameters[0];
  assert.equal(parameter?.kind === "type", true, "the exact authored generic contract is finalized before retention");
  const entry = selected.nativeEntry.direct.body;
  assert.equal(entry.slots.length, 0, "the native body has no invented value input or helper state");
  const header = selected.headerSelections.get(program.source.ast.getSourceFile(declaration), undefined, undefined)?.body;
  assert.equal(header !== undefined, true, "the actual emitted async placement owns its selected header");
  assert.equal(header.captureArguments.some(argument => argument.kind === "type" && argument.type.kind === "type-parameter" &&
    argument.type.identity === parameter.identity), true,
  "the native async capture inventory retains the phantom type's static-proof obligation");
});

test("fixed native method entries retain canonical shape and selected field facet identity", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function make(value: number): { read(): number } {
  return { read(): number { return value; } };
}
` } });
  let checked = 0;
  for (const shape of program.structuralShapes.definitions) for (const field of shape.fields) {
    if (field.methodPlan?.kind !== "fixed") continue;
    const leading = program.records.callableLeading.get(field.methodPlan.declaration);
    const entries = leading?.nativeEntry.structuralFixed;
    const fields = entries?.get(shape);
    const selected = fields?.get(field.sourceName);
    assert.equal(selected !== undefined, true, "the actual canonical shape and selected field own their entry facets");
    assert.equal(entries.get({ ...shape }) === undefined, true, "a foreign same-shaped owner cannot select this field's entry");
    assert.equal(entries.set === undefined && fields.set === undefined && Object.isFrozen(selected), true,
      "the complete context-indexed publication exposes no mutation route");
    for (const facet of ["body", "object"]) {
      const receiver = selected[facet].slots[0];
      assert.equal(receiver.kind === "structural-receiver" && receiver.owner === shape && receiver.sourceName === field.sourceName &&
        receiver.carrier === shape.carrier, true, "the selected receiver retains exact canonical owner, field and carrier identities");
      assert.equal(receiver.passing, facet === "body" ? "shared" : field.methodPlan.factoryReceiver,
        "native body and object adapter retain their independently selected receiver ABI");
      assert.equal(selected[facet].slots.some(slot => slot.kind === "leading" && slot.parameter.kind === "this"), false,
        "the selected structural receiver replaces this rather than adding a duplicate input");
      const headers = leading.headerSelections.get(field, undefined, undefined);
      const header = facet === "body" ? headers?.body : headers?.source;
      assert.equal(header !== undefined, true, "the actual fixed field facet owns its selected native header");
      assert.equal(shape.genericArguments.every(argument => header.captureArguments.some(selected =>
        rustTargetGenericArgumentEquals(selected, argument))), true,
      "all owner-bound generic arguments remain capture obligations even when not introduced as method binders");
    }
    checked++;
  }
  assert.equal(checked > 0, true, "the real captured structural method exercises a fixed native entry");
});

test("nested object method entries preserve object receivers and lexical class generics without inventing native class self", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Enclosing<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
  make(): { value: Value; read(): Value } {
    return { value: this.value, read(): Value { return this.value; } };
  }
}
export function read(): number { return new Enclosing<number>(7).make().read(); }
` } });
  const { ast } = program.source;
  let nested;
  let direct;
  const visit = node => {
    if (ast.is.IsMethodDeclaration(node)) {
      const parent = ast.parent(node);
      if (parent !== undefined && ast.is.IsObjectLiteralExpression(parent)) nested = node;
      if (parent !== undefined && ast.is.IsClassDeclaration(parent)) direct = node;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(nested !== undefined && direct !== undefined, true, "the real source contains distinct object and original class methods");
  const lexicalOwner = program.projectTypes.definitionContainingDeclaration(nested);
  assert.equal(lexicalOwner?.kind, "class", "the object method retains its actual enclosing class generic owner");
  assert.equal(ast.parent(nested) === lexicalOwner.declaration, false, "lexical containment is not native class member ownership");
  const leading = program.records.callableLeading.get(nested);
  assert.equal(leading?.nativeEntry.module !== undefined, true, "the nested object method has its own module helper entry");
  assert.equal(leading.nativeEntry.direct === leading.nativeEntry.module, true, "the nested object's direct entry cannot acquire an unrelated class receiver");
  assert.equal(leading.nativeEntry.module.body.slots.some(slot => slot.kind === "method-receiver" || slot.kind === "class-environment"),
    false, "an enclosing class never invents class self or static environment for the object method");
  assert.equal(leading.parameters.some(parameter => parameter.kind === "this"), true, "the original object this parameter is retained");
  const ownerParameters = lexicalOwner.genericParameters.filter(parameter => parameter.kind === "type");
  assert.equal(ownerParameters.length, 1, "the original enclosing Value binder is present before capture preservation is checked");
  const fixed = program.structuralShapes.definitions.flatMap(shape => shape.fields)
    .find(field => field.methodPlan?.kind === "fixed" && field.methodPlan.declaration === nested);
  const header = fixed === undefined ? undefined : leading.headerSelections.get(fixed, undefined, undefined)?.body;
  assert.equal(header !== undefined, true, "the object method retains its actual emitted structural field header");
  assert.equal(ownerParameters.every(parameter =>
    header.captureArguments.some(argument => argument.kind === "type" &&
      argument.type.kind === "type-parameter" && argument.type.identity === parameter.identity)), true,
  "direct member selection does not erase the actual enclosing generic capture obligations");
  const directEntry = program.records.callableLeading.get(direct)?.nativeEntry.direct;
  assert.equal(directEntry?.body.slots.some(slot => slot.kind === "method-receiver" && slot.owner.declaration === ast.parent(direct)),
    true, "an original class member still keeps its exact native self receiver");
});

test("native helper prefix policy preserves every physical state and frame passing mode", () => {
  for (const mode of ["value", "shared"]) {
    const selected = selectRustNativeStructuralReceiverPassing(mode);
    assert.equal(selected.body === "shared" && selected.object === mode, true,
      "structural body borrowing and object factory ownership remain independent native facets");
  }
  for (const suspended of [false, true]) for (const storage of ["value", "shared"]) {
    assert.equal(selectRustNativeHelperStatePassing({ suspended, storage, hasPayload: false }), undefined,
      "a marker-only environment has no fabricated physical state input");
    assert.equal(selectRustNativeHelperStatePassing({ suspended, storage, hasPayload: true }),
      !suspended ? "shared-reference" : storage === "value" ? "value" : "rc",
      "the selected state retains its actual suspension and ownership mode");
    assert.equal(selectRustNativeFrameOwnerPassing(suspended), suspended ? "rc" : "shared-reference-to-rc",
      "the live frame owner keeps the original outer Rc even when the owner itself has a handle");
  }
});

test("native frame helper entries retain exact early owner environment and immutable implementation keys", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
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
  let checked = 0;
  for (const definition of program.callableValues.frames.definitions) for (const entry of definition.entries) {
    for (const implementation of entry.implementations) {
      if (implementation.independent) continue;
      const entries = program.records.callableLeading.get(implementation.declaration)?.frameEntries;
      const selected = entries?.get(implementation);
      assert.equal(selected?.implementation === implementation && selected.type.definition === definition && selected.type.entry === entry,
        true, "the helper keeps the exact admitted implementation, frame owner and entry identities");
      assert.equal(Object.isFrozen(entries) && entries.set === undefined && entries.clear === undefined, true,
        "the sealed implementation lookup exposes no mutable Map");
      assert.equal(entries.get({ ...implementation }) === undefined, true, "a foreign implementation cannot select an entry by declaration shape");
      const published = program.records.frameType.get(implementation.carrier);
      assert.equal(published !== undefined && published.environment === selected.type.environment && published.owner === selected.type.owner,
        true, "late error completion reuses the identical early environment and owner without reselection");
      assert.equal(selected.arguments.length === definition.environmentParameters.length && selected.arguments.every((argument, index) =>
        argument.kind === "type" && argument.type === selected.type.environment[index]), true,
      "the helper arguments preserve the complete original ordered environment inventory");
      assert.equal(selected.suspended, false, "the original recursive callbacks are synchronous");
      assert.equal(selected.ownerPassing, "shared-reference-to-rc", "the helper borrows its actual live Rc owner");
      const captures = implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length;
      assert.equal(selected.statePassing, captures === 0 ? undefined : "shared-reference",
        "only actual physical captures introduce a borrowed state parameter");
      checked++;
    }
  }
  assert.equal(checked > 0, true, "the original rebound recursive callable exercises a real native frame helper");
});
