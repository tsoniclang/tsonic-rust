import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";

function source(order) {
  const closed = "function closed(): View<string> { return new Box<string>(); }";
  const open = "function open<T>(box: Box<T>): View<T> { return box; }";
  return `
type View<T> = { readonly callback: (value: T, ignored: number) => T };
class Box<T> { callback = (value: T): T => value; }
${order === "open-first" ? `${open}\n${closed}` : order === "closed-first" ? `${closed}\n${open}` : closed}
export function run(value: string): string {
  const view: View<string> = new Box<string>();
  return view.callback(value, 42);
}`;
}

for (const surfaces of [[], ["js"]]) {
  for (const order of ["closed-only", "closed-first", "open-first"]) {
    test(`a structural property keeps its selected getter's callable ABI ${order} in ${surfaces[0] ?? "native"}`, () => {
      let program;
      const { result } = compileRust({ surfaces, files: { "index.ts": source(order) }, compileTarget(request) {
        const analyzed = analyzeRustAnalysisProgram(request);
        if (analyzed.kind === "rejected") return analyzed;
        program = analyzed.value;
        return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
      } });
      assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
      assert.equal(program !== undefined, true, "the complete structural-view program is admitted");
      const nodes = [];
      const visit = node => {
        nodes.push(node);
        program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      for (const file of program.sourceFiles) visit(file);
      const read = nodes.find(node => program.source.ast.text(node) === "view.callback");
      const operation = program.records.targetOperation.get(read);
      assert.equal(operation?.kind === "source-field" && operation.storage === "structural-object", true,
        "the read uses its exact selected structural field");
      assert.equal(program.structuralShapes.field(operation.receiverCarrier, operation.storageIndex)?.storage, "property",
        "the getter is a real physical storage boundary");
      const logical = rustCallableProtocol(operation.resultCarrier);
      assert.equal(logical?.parameters.length, 2, "the view's extra argument belongs to its own ABI");
      const selected = program.callableValues.nativeStorage.valueFor(read);
      assert.equal(selected.kind !== "unresolved", true, selected.kind === "unresolved" ? selected.reason : "selected getter storage");
      const physical = rustCallablePhysicalSignature(selected.carrier);
      assert.equal(physical?.parameters.length, 2, "physical selection cannot bypass the getter to the one-argument class producer");
      assert.equal(rustTargetTypeRefEquals(physical?.result, logical.result), true, "the exact getter result carrier is retained");
      assert.equal(rustTargetTypeRefEquals(physical?.error, logical.error), true, "the exact getter error carrier is retained");
      assert.equal(selected.kind === "selected" && selected.erased === true, true,
        "the selected runtime getter callable is marked erased, not re-selected from its class producer");
      const views = [...new Set(program.classValues.instanceViewImplementations.flatMap(view =>
        program.records.structuralViewImplementations.get(view.declaration, view.ownerFileName) ?? []))];
      assert.equal(views.length > 0, true, "the structural implementations have a published physical contract");
      for (const view of views) {
        assert.equal(program.records.structuralViewRequirements.get(view) !== undefined, true,
          "the final view object owns its sealed generic requirements");
        for (const member of view.fields) {
          const adapter = member.readAdapter;
          const source = adapter === undefined ? undefined : rustCallablePhysicalSignature(adapter.sourceCarrier);
          assert.equal(source?.parameters.length, 1, "the view reads the class field's actual one-argument physical callable");
          assert.equal(source.error.kind === "target-named" && source.error.id === rustInfallibleTargetId, true,
            "the field's real infallible invocation error is not replaced by the getter error");
          assert.equal(rustCallableProtocol(adapter.targetCarrier)?.parameters.length, 2,
            "one adapter supplies the fixed getter ABI and ignores the extra argument");
          assert.equal(adapter.kind === "conversion" && adapter.conversion.kind === "callable-adapter", true,
            "the view has one canonical callable adapter, not a logical read fallback");
          assert.equal(program.records.callableContract.get(member.declaration, adapter.conversion) !== undefined, true,
            "the physical source adapter is fully planned before publication");
          const operand = program.records.callableOperand.get(member.declaration, adapter.conversion.source);
          assert.equal(operand?.physical.erased, true, "the same synthetic physical source owns its erased operand record");
          assert.equal(rustTargetTypeRefEquals(operand?.physical.carrier, adapter.sourceCarrier), true,
            "the operand and conversion contract name the identical physical field carrier");
          assert.equal(program.records.carrierRead.get(adapter.sourceCarrier)?.clone, true,
            "the exact physical field read has sealed native read evidence");
        }
      }
    });
  }
  test(`incompatible structural callable fields remain rejected in ${surfaces[0] ?? "native"}`, () => {
    const session = createRustSession({ surfaces, files: { "index.ts": `
type View = { readonly callback: (value: string, ignored: number) => string };
class Box { callback = (value: number): number => value; }
const view: View = new Box();` } });
    assert.match(rustSourceDiagnostics(session), /error TS2322/u,
      "a getter boundary cannot manufacture type correspondence for an incompatible class field");
  });
}
