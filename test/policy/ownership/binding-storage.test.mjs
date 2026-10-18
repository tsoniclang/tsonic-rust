import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativeBindingStorage, selectRustNativeFrameStorageOwner } from "../../../dist/policy/ownership/binding-storage.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";

const payload = rustNamedTargetType("native.actual.Guard", "native_alias::Guard",
  [{ kind: "lifetime", lifetime: { kind: "parameter", identity: "actual-owner", name: "owner" } }],
  [], undefined, [], undefined, []);

function typeArgument(carrier, path) {
  const selected = rustNamedTypeCarrierValue(carrier);
  assert.equal(selected?.path, path, "the native storage path is selected at its owning policy");
  assert.equal(selected.genericArguments[0]?.kind, "type", "the actual storage preserves its typed payload");
  return selected.genericArguments[0].type;
}

test("one native storage policy preserves the exact payload and every existing inline construction", () => {
  for (const [storage, path, constructor, requirements] of [
    ["value", null, null, []],
    ["cell", "core::cell::Cell", "core::cell::Cell::new", ["copy"]],
    ["borrow-cell", "core::cell::RefCell", "core::cell::RefCell::new", []],
    ["location", "rt::Location", "rt::Location::allocate", ["clone", "static"]],
  ]) {
    const selected = selectRustNativeBindingStorage({ kind: "binding", storage, initialization: "ready", payloadCarrier: payload,
      nativeAllocation: null });
    assert.equal(selected.payloadCarrier === payload, true, "no logical substitute or clone is the native payload");
    assert.equal(selected.valueConstructor, constructor, storage);
    assert.deepEqual(selected.requirements, requirements, storage);
    assert.equal(selected.holderCarrier === selected.slotCarrier, true, "an inline native slot is not a fabricated shared owner");
    assert.equal(path === null ? selected.slotCarrier === payload : typeArgument(selected.slotCarrier, path) === payload,
      true, storage);
    assert.equal(Object.isFrozen(selected), true, "the published choice is immutable data");
    assert.equal(Object.isFrozen(selected.requirements), true, "native requirements cannot change after publication");
  }
});

test("native-backed locations retain the selected layout and the real allocation requirements", () => {
  const layout = Object.freeze({ kind: "scalar", pointeeCarrier: payload, size: 8, alignment: 8,
    width: 64, littleEndian: true, fields: Object.freeze([]) });
  for (const initialization of ["ready", "deferred"]) {
    const selected = selectRustNativeBindingStorage({ kind: "binding", storage: "location", initialization,
      payloadCarrier: payload, nativeAllocation: layout });
    assert.equal(selected.nativeAllocation === layout, true, "the actual native layout is retained without reconstruction");
    assert.equal(selected.valueConstructor, "rt::raw_memory::allocate_native_location", "the allocation is not an invented Clone-requiring constructor");
    assert.deepEqual(selected.requirements, initialization === "ready" ? ["static"] : ["clone", "static"],
      "deferred runtime initialization retains its actual additional constructor constraint");
    assert.equal(selected.deferredConstructor, initialization === "ready" ? null : "rt::Location::uninitialized");
  }
});

test("captured fields retain the complete ready or deferred shared slot and constructor", () => {
  for (const storage of ["shared", "cell", "borrow-cell"]) {
    for (const initialization of ["ready", "deferred"]) {
      const selected = selectRustNativeBindingStorage({ kind: "captured-field", storage, initialization, payloadCarrier: payload });
      const slot = typeArgument(selected.holderCarrier, "alloc::rc::Rc");
      assert.equal(slot === selected.slotCarrier, true, "the whole owner retains the selected slot");
      assert.equal(initialization === "ready" ? slot === selected.valueCarrier
        : typeArgument(slot, "core::cell::OnceCell") === selected.valueCarrier, true, storage);
      assert.equal(selected.ownerConstructor, "alloc::rc::Rc::new", "actual shared ownership is never inferred from a lifetime name");
      assert.equal(selected.slotConstructor, initialization === "deferred" ? "core::cell::OnceCell::from" : null);
      assert.equal(selected.deferredConstructor, initialization === "deferred" ? "core::cell::OnceCell::new" : null);
      assert.equal(selected.payloadCarrier === payload, true, "deferred storage does not erase the native lifetime");
    }
  }
  const copied = selectRustNativeBindingStorage({ kind: "captured-field", storage: "copy", initialization: "ready",
    payloadCarrier: payload });
  assert.equal(copied.holderCarrier === payload, true, "an actual direct field acquires no shared wrapper");
  assert.equal(copied.ownerConstructor, null, "no Rc allocation is added to an inline field");
});

test("frame slots retain a separate exact enclosing owner rather than substituting the binding payload", () => {
  const frame = rustNamedTargetType("generated.actual.Frame", "crate::actual::Frame", [], [], undefined, [], undefined, []);
  const owner = selectRustNativeFrameStorageOwner(frame, "standalone");
  assert.equal(owner.frameCarrier === frame, true, "the original complete frame declaration is retained by identity");
  assert.equal(typeArgument(owner.holderCarrier, "alloc::rc::Rc") === frame, true,
    "the enclosing allocation owns the actual frame, never a slot/payload lookalike");
  assert.equal(owner.constructor, "alloc::rc::Rc::new", "one canonical frame allocation policy");
  for (const storage of ["value", "cell", "borrow-cell", "location"]) {
    const selected = selectRustNativeBindingStorage({ kind: "frame", storage, initialization: "deferred",
      payloadCarrier: payload });
    assert.equal(owner.holderCarrier === selected.slotCarrier, false, "a frame field is never its own destruction owner");
    assert.equal(selected.holderCarrier === selected.slotCarrier, true, "the slot descriptor has no competing enclosing allocation");
    assert.equal(selected.ownerConstructor, null, "a frame field cannot accidentally construct Rc<Slot> as its whole frame");
    assert.equal(selected.deferredConstructor, "core::cell::OnceCell::new", "every deferred frame slot keeps its actual OnceCell");
    assert.equal(typeArgument(selected.slotCarrier, "core::cell::OnceCell") === selected.valueCarrier, true,
      "a deferred Location payload is still wrapped by the existing frame initialization protocol");
    assert.equal(selected.payloadCarrier === payload, true, "entry or payload selection is supplied before storage application");
  }
  const object = selectRustNativeFrameStorageOwner(frame, "object");
  assert.equal(object.holderCarrier === frame, true, "the actual object-backed owner is retained without another wrapper");
  assert.equal(object.constructor, null, "an object frame does not allocate a separate standalone frame");
});

test("module holders keep their actual construction bounds and never become initializer-local storage", () => {
  for (const initialization of ["ready", "deferred"]) {
    const selected = selectRustNativeBindingStorage({ kind: "module", initialization, payloadCarrier: payload });
    assert.equal(typeArgument(selected.holderCarrier, "rt::ModuleCell") === payload, true, "native module slot uses the original payload");
    assert.equal(selected.valueConstructor, "rt::ModuleCell::initialized");
    assert.equal(selected.deferredConstructor, "rt::ModuleCell::new", "the actual TLS declaration is empty before module initialization");
    assert.deepEqual(selected.requirements, ["clone", "static"], "construction and load use the real native runtime contract");
    assert.equal(selected.ownerConstructor, null, "no additional synthetic shared owner is invented");
  }
});
