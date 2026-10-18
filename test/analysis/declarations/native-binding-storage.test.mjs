import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { publishRustNativeBindingStorage } from "../../../dist/analysis/declarations/native-binding-storage.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

function programFor(source) {
  const { program } = analyzeRust({ files: { "index.ts": source } });
  assert.equal(program !== undefined, true, "the real checked pipeline publishes its complete native forms");
  return program;
}

test("native binding storage retains its original declaration, selected use and complete immutable native slot", () => {
  const program = programFor("export function next(start: number): number { let value = start; value++; return value; }");
  const rows = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeBindings);
  assert.equal(rows.length > 0, true, "the actual emitted local bindings have final storage");
  for (const context of program.physicalEmissionContexts.contexts) {
    const declarations = new Set();
    const capturedSlots = new Map();
    for (const row of context.nativeBindings) {
      assert.equal(row.contextUse === context.use, true, "publication retains the exact selecting physical context");
      if (row.owner.kind === "capture") {
        const slots = capturedSlots.get(row.owner.environment) ?? new Set();
        assert.equal(slots.has(row.owner.slotIndex), false, "one actual capture owner publishes each physical slot once");
        slots.add(row.owner.slotIndex);
        capturedSlots.set(row.owner.environment, slots);
        assert.equal(context.nativeEnvironments.includes(row.owner.environment), true,
          "the slot references the identical completed owner in its physical context");
      } else {
        assert.equal(declarations.has(row.declaration), false, "one original local or field has one physical storage per context");
        declarations.add(row.declaration);
      }
      assert.equal(program.source.ast.getSourceFile(row.declaration) !== undefined, true, "the owner is an actual checked declaration");
      assert.equal(Object.isFrozen(row) && Object.isFrozen(row.storage), true, "a consumer cannot mutate the final native choice");
      assert.equal(row.readCarrier !== undefined, true, "a native read has an explicit carrier, not a storage spelling guess");
      assert.equal("preparation" in row, false, "private ABI preparation does not leak into sealed native holder records");
      assert.equal(program.physicalEmissionContexts.contextFor(row.contextUse) === context, true,
        "the published native holder uses the original context index");
      assert.equal(row.sourceBindings === context.bindings, true, "original correlated source substitutions are retained");
    }
  }
});

test("captured values keep their actual read representation rather than becoming a declaration's frame entry", () => {
  const program = programFor(`
export function observed(start: number): number {
  let value = start;
  const next = () => ++value;
  return next();
}`);
  const captures = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeBindings)
    .filter(row => row.source.kind === "capture");
  assert.equal(captures.length > 0, true, "the actual capture inventories supply the storage request");
  for (const row of captures) {
    assert.equal(row.owner.kind, "capture", "a captured read retains its actual enclosing environment, not a declaration-only or frame-entry surrogate");
    const slot = row.source.slot;
    assert.equal(program.source.ast.getSourceFile(slot.capture.reference) !== undefined, true,
      "the exact original captured reference is preserved");
    assert.equal(row.owner.environment.slots[row.owner.slotIndex] === slot, true,
      "the original capture and its completed owner's physical field keep identical correlation");
    const storage = slot.kind === "binding" ? slot.capture.storage : slot.kind === "receiver" ? "value"
      : slot.capture.storage.kind === "copy" || slot.capture.storage.kind === "shared" ? "value" : slot.capture.storage.kind;
    assert.equal(row.storage.kind, storage, "the original capture mode owns the native slot");
    assert.equal(rustTargetTypeRefEquals(row.readCarrier, row.storage.payloadCarrier), true,
      "the captured payload's native read is distinct from any enclosing slot wrappers");
    if (slot.kind !== "receiver-field") assert.equal(row.owner.fieldCarrier === row.storage.slotCarrier, true,
      "ordinary bindings and whole receivers keep their exact original emitted slot without an identity wrapper");
  }
});

test("native capture environments publish complete owner inventories and no private preparation", () => {
  const program = programFor(`
export function observed(start: number): number {
  let value = start;
  const next = () => ++value;
  return next();
}`);
  const environments = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeEnvironments);
  assert.equal(environments.length > 0, true, "real emitted captures publish their complete native owner inventory");
  for (const context of program.physicalEmissionContexts.contexts) for (const environment of context.nativeEnvironments) {
    assert.equal(environment.use === context.use && environment.sourceBindings === context.bindings, true,
      "the owner retains its original physical context and correlated bindings");
    assert.equal(Object.isFrozen(environment) && Object.isFrozen(environment.slots), true,
      "native ownership publication has no mutable slot inventory");
    assert.equal(typeof environment.nativeOwnerFileName === "string" && environment.nativeOwnerFileName.length > 0, true,
      "the actual native defining file survives preparation");
    for (const slot of environment.slots) {
      const rows = context.nativeBindings.filter(binding => binding.owner.kind === "capture" &&
        binding.owner.environment === environment && binding.source.kind === "capture" && binding.source.slot === slot);
      assert.equal(rows.length, 1, "every original capture has one completed physical slot in this exact owner");
      assert.equal("input" in rows[0].source, false, "private capture preparation never leaks into a sealed row");
    }
    if (environment.kind === "frame" && environment.payload.kind === "none")
      assert.equal(environment.slots.length, 0, "an absent actual frame state is not an unavailable captured payload");
  }
});

test("receiver-field capture publication retains its exact shared owner and selected freeze identity envelope", () => {
  const payload = Object.freeze({ kind: "source-primitive", name: "number" });
  const bindings = Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
  const unavailable = () => undefined;
  const records = { bindingStorage: { get: unavailable }, moduleBinding: { get: unavailable } };
  for (const kind of ["copy", "shared", "cell", "borrow-cell"]) {
    for (const initialization of kind === "copy" ? ["ready"] : ["ready", "deferred"]) {
      for (const guarded of [false, true]) {
        const label = `${kind}/${initialization}/${guarded ? "guarded" : "unguarded"}`;
        const declaration = {};
        const reference = {};
        const use = {};
        const slot = Object.freeze({ kind: "receiver-field", capture: Object.freeze({ declaration, reference,
          receiver: {}, references: Object.freeze([reference]), carrier: payload,
          storage: Object.freeze({ kind, initialization }) }) });
        const input = Object.freeze({ slots: Object.freeze([Object.freeze({ slot, slotIndex: 0 })]) });
        const environment = Object.freeze({ kind: "native", use, sourceBindings: bindings,
          slots: Object.freeze([slot]) });
        let identityQueries = 0;
        const result = publishRustNativeBindingStorage({
          ast: {}, contextUse: use, fieldBindings: [], records, frames: {}, projectTypes: {},
          nativeTypeContext: { typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: new Map() },
          physicalCarrierFor: () => payload, captureEnvironments: [{ input, environment }],
          requests: [{ use, declaration, logicalCarrier: payload, physicalCarrier: payload, sourceBindings: bindings,
            source: { kind: "capture", input, slot, slotIndex: 0, initialization } }],
          frozenDataWrites: { capturesFieldIdentity(selectedDeclaration, selectedReference) {
            identityQueries++;
            assert.equal(selectedDeclaration === declaration && selectedReference === reference, true,
              `${label}: only the original field and exact captured use decide identity retention`);
            return guarded;
          } },
        });
        assert.equal(result.kind, "resolved", `${label}: exact capture storage is published`);
        assert.equal(result.value.length, 1, `${label}: one original captured field`);
        const row = result.value[0];
        assert.equal(row.owner.kind, "capture", `${label}: original capture owner`);
        assert.equal(row.owner.environment === environment && row.source.slot === slot, true,
          `${label}: original owner, field and selecting bindings remain correlated`);
        assert.equal(identityQueries, 1, `${label}: the existing selected identity fact is consumed once`);
        const field = row.owner.fieldCarrier;
        const holder = guarded ? field.elements[1] : field;
        if (guarded) {
          assert.equal(field.kind, "tuple", `${label}: the writer retains the required envelope`);
          assert.equal(field.elements.length, 2, `${label}: exactly the identity and original owner`);
          assert.equal(rustNamedTypeCarrierValue(field.elements[0])?.path, "rt::ObjectIdentity",
            `${label}: the native identity is not a logical EmptyObject substitute`);
          assert.equal(Object.isFrozen(field) && Object.isFrozen(field.elements), true,
            `${label}: the completed envelope cannot change after publication`);
        }
        assert.equal(holder === row.storage.holderCarrier, true, `${label}: no copy, unwrapping or second owner`);
        assert.equal(row.readCarrier === payload, true, `${label}: field reads retain the original payload`);
        if (kind !== "copy") {
          assert.equal(rustNamedTypeCarrierValue(holder)?.path, "alloc::rc::Rc", `${label}: the shared field owner is retained`);
          assert.equal(holder === row.storage.slotCarrier, false, `${label}: a bare interior slot is never the captured owner`);
        } else assert.equal(holder === payload, true, `${label}: readonly-copy storage acquires no shared owner`);
      }
    }
  }
});

test("native module cells retain their module destruction owner and actual empty TLS constructor", () => {
  const program = programFor("export let total = 1; export function next(): number { total += 1; return total; }");
  const rows = program.physicalEmissionContexts.contexts.flatMap(context => context.nativeBindings)
    .filter(row => row.owner.kind === "module");
  assert.equal(rows.length > 0, true, "the actual mutable module binding has a native holder");
  for (const row of rows) {
    assert.equal(row.storage.kind, "module-cell", "the native module slot is not initializer-local storage");
    assert.equal(row.owner.sourceFile === program.source.ast.getSourceFile(row.declaration), true,
      "cleanup belongs to the original module, not the initializer lexical scope");
    assert.equal(row.storage.deferredConstructor, "rt::ModuleCell::new", "the real TLS declaration starts empty");
    assert.deepEqual(row.storage.requirements, ["clone", "static"], "the actual runtime construction bounds are preserved");
  }
});

test("class fields publish final payload and slot through the same one completed native declaration", () => {
  const program = programFor("export class Box { constructor(public value: number) {} read(): number { return this.value; } }");
  const definition = program.projectTypes.definitions.find(definition => definition.kind === "class");
  assert.equal(definition !== undefined, true, "the real authored class has a checked declaration");
  const form = program.nativeDeclarations.get(definition.declaration);
  assert.equal(form?.kind, "class", "the original declaration owns its final physical fields");
  assert.equal(program.nativeDeclarations.get(definition.declaration) === form, true, "the native declaration is a sealed lookup");
  assert.equal(form.fields.length, 1, "the exact original parameter-property remains present");
  const field = form.fields[0];
  assert.equal(field.nativePayloadCarrier === field.nativeStorage.payloadCarrier, true, "the selected payload is published by identity");
  assert.equal(field.nativeCarrier === field.nativeStorage.slotCarrier, true, "the renderer receives the complete actual slot");
  assert.equal(Object.isFrozen(field.nativeStorage), true, "field publication contains no computing storage service");
});

test("inherited construction fields retain their actual consuming plan and original declaring owner", () => {
  const program = programFor(`
export class Base { constructor(public value: number) {} }
export class Derived extends Base { constructor(value: number) { super(value); } }
`);
  const definition = program.projectTypes.definitions.find(definition => definition.sourceName === "Derived");
  assert.equal(definition !== undefined, true, "the actual derived class has its own construction plan");
  const plan = program.projectConstructions.forDefinition(definition);
  assert.equal(plan !== undefined, true, "the canonical construction owner publishes the derived plan");
  const inherited = plan.fields.find(field => field.owner !== definition);
  assert.equal(inherited !== undefined, true, "the real plan contains its inherited physical field");
  const context = program.physicalEmissionContexts.contextForOwner(plan, "constructor");
  assert.equal(context !== undefined, true, "the exact consuming constructor owns a physical context");
  const row = context.nativeBindings.find(row => row.declaration === inherited.declaration);
  assert.equal(row?.source.kind, "field", "an inherited row is not checked against a different class's plan object");
  assert.equal(row.source.definingOwner === inherited.owner.declaration, true, "the original native field owner is retained");
  assert.equal(row.contextUse === context.use, true, "the actual derived-constructor occurrence remains the selecting use");
});
