import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustErrorRegionCatalog } from "../../../dist/backend/planner/program/error-regions.js";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { selectRustNativeTypeCarrier } from "../../../dist/policy/types/model/native-type-selection.js";
import { nativeDeclarationSelectionInput } from "../../helpers/native-type-selection.mjs";

function fixture() {
  const { program } = analyzeRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "sealed_regions" } },
    files: { "index.ts": `
      export async function pure(): Promise<string> { return "value"; }
      export async function failed(): Promise<string> { throw "failure"; }
      export function invoke(callback: () => string): string { return callback(); }
    ` },
  });
  const producer = name => program.callableValues.nativeProducers.producers.find(candidate => {
    const selected = program.source.ast.name(candidate.declaration);
    return selected !== undefined && program.source.ast.text(selected) === name;
  });
  const reference = (name, channel) => rustProducerErrorReference(
    program.callableValues.nativeProducers.errorFor(producer(name).declaration, channel));
  return { program, producer, reference };
}

test("completed regions publish physical payloads and producer templates before native reconstruction", () => {
  const current = fixture();
  const records = current.program.errorRegions;
  assert.equal(records.get(current.producer("pure").declaration).kind, "infallible");
  const failed = records.get(current.producer("failed").declaration);
  assert.equal(failed.kind, "package");
  assert.equal(failed.localOwner.kind, "physical");
  assert.equal(records.producerError(current.reference("pure", 0)).id, "rust.core.Infallible");
  assert.equal(records.producerError(current.reference("failed", 0)).errorOwner.kind, "physical");
  assert.equal(records.get({}) === undefined, true, "source identity is not reconstructed from shape");
  assert.equal(Object.isFrozen(records) && Object.isFrozen(failed) && Object.isFrozen(failed.sources), true);
});

test("producer rendering substitutes a sealed template without source, fact, name or callable analysis", () => {
  const current = fixture();
  const neverRead = new Proxy({}, { get() { throw new Error("post-publication semantic access"); } });
  const catalog = createRustErrorRegionCatalog({ ...current.program, records: neverRead, names: neverRead,
    callableValues: neverRead, source: { ...current.program.source,
      ast: { getFileName: current.program.source.ast.getFileName } } });
  const reference = current.reference("invoke", "invoke");
  const replacement = { kind: "type-parameter", identity: "caller:physical", name: "Physical" };
  const instantiated = { ...reference, genericArguments: [{ kind: "type", type: replacement }] };
  let rendered;
  assert.equal(Object.hasOwn(catalog, "producerErrorType"), false, "the superseded backend semantic service is absent");
  assert.equal(Object.hasOwn(catalog, "nativeErrorJoinType"), false, "native join identity has only its canonical policy owner");
  const selected = nativeDeclarationSelectionInput({ ...current.program, names: neverRead, callableValues: neverRead })
    .nativeTypeInputFor(current.producer("invoke").fileName, undefined);
  const result = selectRustNativeTypeCarrier(rustProducerErrorTargetType(instantiated), { ...selected,
    producerErrorCarrier: reference => { rendered = current.program.errorRegions.producerError(reference); return rendered; },
  }, "general");
  assert.equal(result.kind, "resolved", "the canonical native selector consumes the same sealed producer template");
  assert.equal(result.carrier.kind, "associated-type", "the exact native error projection is retained, not a backend placeholder");
  assert.equal(result.carrier.owner.name, "Physical", "native syntax uses the caller's actual physical binder");
  assert.equal(rustTargetTypeRefEquals(rendered.owner, replacement), true, "only declared generic substitution occurs after publication");
});

test("sealed producer queries reject malformed and foreign references without executing accessors", () => {
  const current = fixture();
  const reference = current.reference("invoke", "invoke");
  for (const change of [{ identity: "foreign" }, { fileName: "/foreign.ts" }, { channel: -1 },
    { channel: Infinity }, { genericArguments: [] },
    { genericArguments: [{ kind: "const", value: { kind: "integer", value: "2" } }] }])
    assert.equal(current.program.errorRegions.producerError({ ...reference, ...change }) === undefined, true);
  let reads = 0;
  const accessor = Object.defineProperty({ ...reference }, "identity", { enumerable: true,
    get() { reads++; return reference.identity; } });
  assert.equal(current.program.errorRegions.producerError(accessor) === undefined, true);
  assert.equal(reads, 0);
});
