import assert from "node:assert/strict";
import test from "node:test";
import { getRustGeneratorProtocol, rustGeneratorTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustSourcePrimitiveTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustGeneratorStorageTargetType } from "../../dist/policy/types/callables/generators.js";
import { rustRuntimeTaskScopeTargetType } from "../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustTypeFromCarrier } from "../../dist/backend/planner/types/carrier-syntax.js";
import { rustCarrierSupportsClone, isRustCopyCarrier } from "../../dist/policy/constraints/native-traits.js";
import { rustFoundationForCarrier, rustFoundationForPath } from "../../dist/analysis/foundation/requirements.js";

const integer = rustSourcePrimitiveTargetType("int32");
const protocol = { kind: "sync", yieldType: integer, returnType: integer, nextType: integer };
const failure = rustNamedTargetType("test.NativeFailure", "NativeFailure");

test("source generator protocols never masquerade as the finalized native error ABI", () => {
  const logical = rustGeneratorTargetType(protocol);
  assert.equal(logical.genericArguments.length, 3, "only checked logical Y/R/N exist before physical selection");
  assert.equal(getRustGeneratorProtocol(logical)?.physical === undefined, true, "the source protocol has no guessed error");
  assert.equal(rustTypeFromCarrier(logical) === undefined, true, "the removed three-argument native ABI cannot render");
});

test("physical generator storage carries exact errors and zero-sized reentry policy on both native forms", () => {
  for (const kind of ["sync", "async"]) for (const reentry of ["excluded", "possible"]) {
    for (const lifetime of [undefined, { kind: "parameter", identity: "generator/input", name: "input" }]) {
      const physical = rustGeneratorStorageTargetType({ ...protocol, kind }, lifetime, failure, reentry);
      const selected = getRustGeneratorProtocol(physical);
      const label = `${kind}/${reentry}/${lifetime === undefined ? "static" : "borrowed"}`;
      assert.equal(physical.genericArguments.length, lifetime === undefined ? 5 : 6, label + ": canonical native ABI arity");
      assert.equal(selected?.kind, kind, label + ": native suspension kind");
      assert.equal(selected.physical.errorCarrier === failure, true, label + ": no native error narrowing");
      assert.equal(selected.physical.reentry, reentry, label + ": selected zero-sized policy");
      const rendered = rustTypeFromCarrier(physical);
      assert.equal(rendered?.kind, "named", label + ": native storage is renderable");
      assert.equal(rendered.genericArguments.at(-2).type.path, "NativeFailure", label + ": rendered exact payload");
      assert.equal(rendered.genericArguments.at(-1).type.path,
        reentry === "excluded" ? "rt::GeneratorNoReentry" : "rt::GeneratorMayReenter", label + ": native policy type");
      const malformed = [
        { ...physical, genericArguments: physical.genericArguments.slice(0, -1) },
        { ...physical, genericArguments: [...physical.genericArguments.slice(0, -1), { kind: "type", type: integer }] },
      ];
      for (const changed of malformed) {
        assert.equal(getRustGeneratorProtocol(changed) === undefined, true, label + ": malformed storage refused");
        assert.equal(rustTypeFromCarrier(changed) === undefined, true, label + ": no old ABI fallback");
      }
    }
  }
});

test("typed native task scopes use their real Clone implementation without constraining the error payload", () => {
  assert.equal(rustCarrierSupportsClone(failure), false, "the native error is move-only");
  const scope = rustRuntimeTaskScopeTargetType(failure);
  assert.equal(rustCarrierSupportsClone(scope), true, "the runtime handle's Clone has no E:Clone bound");
  assert.equal(isRustCopyCarrier(scope), false, "a scoped native handle is not Copy");
  assert.equal(rustTypeFromCarrier(scope).path, "rt::TaskScope", "the existing native carrier vocabulary renders the runtime API");
  assert.equal(rustFoundationForCarrier(scope), "std", "scope use requires the actual runtime feature");
  for (const path of ["rt::run_tasks", "rt::spawn", "rt::TaskScope"]) {
    assert.equal(rustFoundationForPath(path), "std", path + ": one registered native feature owner");
  }
});
