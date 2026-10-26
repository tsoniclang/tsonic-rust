import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { analyzeRustOptionalChainEmission } from "../../../../dist/analysis/operations/optional-chains.js";
import { analyzeRustErrorFieldBorrows } from "../../../../dist/analysis/operations/error-field-borrows.js";
import { admitRustOperationSelection } from "../../../../dist/analysis/operations/operation-admission.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { assertRustRequiredRecords } from "../../../../dist/analysis/program/records/required-records.js";
import { createRustOptionalChainEmissionProducer } from "../../../../dist/analysis/program/records/optional-chain-emission.js";
import { createRustErrorFieldProducer } from "../../../../dist/analysis/program/records/error-field-borrows.js";
import { planPropertyAccess } from "../../../../dist/backend/planner/expressions/properties.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { acceptRustPolicy } from "../../../../dist/policy/model/contracts.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`optional ${surfaces.length === 0 ? "native" : "JS"} Error observations use exact member stages and one native borrow`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      export function name(error: Error | undefined): string | undefined { return error?.name; }
      export function message(error: Error | undefined): string | undefined { return error?.message; }
      export function stack(error: Error | undefined): string | undefined { return error?.stack; }
    ` } });
    const { ast } = program.source;
    const operations = [];
    const visit = node => {
      const fact = program.records.targetOperation.get(node);
      if (fact?.kind === "builtin-error-property") operations.push({ node, fact });
      for (const child of ast.children(node)) visit(child);
    };
    for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
    assert.equal(operations.length, 3);
    let vectors = 0;
    for (const { node, fact } of operations) {
      const optional = program.records.optionalChain.get(node);
      assert.equal(optional !== undefined, true, fact.property);
      const selectedOperation = program.records.selectedOperation.get(node);
      assert.equal(selectedOperation !== undefined, true, `${fact.property}: one admitted source operation`);
      assert.equal(rustTargetTypeRefEquals(selectedOperation.resultType, optional.resultCarrier), true,
        `${fact.property}: the selected result is the complete optional result`);
      assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, optional.innerResultCarrier), true,
        `${fact.property}: the member result retains its exact native stage`);
      assert.equal(rustTargetTypeRefEquals(fact.receiverCarrier, optional.selectedGuardCarrier), true,
        `${fact.property}: the member consumes the selected native Error receiver`);
      assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, optional.resultCarrier), true,
        `${fact.property}: runtime evidence describes the complete optional result`);
      const context = (records = program.records) => ({ input: { program: { ...program, records } }, diagnostics: [],
        sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
        syntheticNames: createRustSyntheticNameState(ast, node, []),
        moduleName: "index", structuralShapesModuleName: "shapes", moduleNameByFileName: new Map(),
        externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
        externalStructuralShapeModuleByFileName: new Map() });
      const valid = context();
      const planned = planPropertyAccess(node, valid);
      assert.equal(planned !== undefined, true, JSON.stringify(valid.diagnostics));
      assert.equal(valid.diagnostics.length, 0);
      const printed = printRustExpr(planned);
      assert.match(printed, new RegExp(`ErrorObject::error_${fact.property}\\(optional_receiver\\)`));
      assert.doesNotMatch(printed, /ErrorObject::error_\w+\(&optional_receiver\)/u);
      const sourceRequirements = requiredRecords.filter(requirement =>
        requirement.subject === node && requirement.family === "optionalChain");
      assert.equal(sourceRequirements.length > 0, true, `${fact.property}: source admission really requires the guard`);
      assert.equal(sourceRequirements.every(requirement => requirement.construct === "property" &&
        requirement.producer === "analysis/operations/members/result.ts"), true,
      `${fact.property}: the original source owner registered the exact guard`);
      const wrong = rustSourcePrimitiveTargetType("int32");
      const mutations = [
        { name: "missing optionalChain", records: createRustRecordFixture({ optionalChain: { get: subject =>
          subject === node ? undefined : program.records.optionalChain.get(subject) } }, program.records),
        reject(records) {
          assert.throws(() => assertRustRequiredRecords(records, sourceRequirements), analysisFailure(node,
            "Required Rust semantic plan 'optionalChain' was not published for 'property' by 'analysis/operations/members/result.ts'."));
        } },
        { name: "wrong inner result", records: createRustRecordFixture({ optionalChain: { get: subject =>
          subject === node ? { ...optional, innerResultCarrier: wrong } : program.records.optionalChain.get(subject) } }, program.records),
        reject: records => assertOptionalAdmissionRejected(program, records, node) },
        { name: "wrong member result", records: createRustRecordFixture({ targetOperation: { get: subject =>
          subject === node ? { ...fact, resultCarrier: wrong } : program.records.targetOperation.get(subject) } }, program.records),
        reject: records => assertErrorAdmissionRejected(program, records, node) },
        { name: "wrong member receiver", records: createRustRecordFixture({ targetOperation: { get: subject =>
          subject === node ? { ...fact, receiverCarrier: wrong } : program.records.targetOperation.get(subject) } }, program.records),
        reject: records => assertErrorAdmissionRejected(program, records, node) },
        { name: "wrong runtime result", records: createRustRecordFixture({ runtimeCarrier: { get: subject =>
          subject === node ? { carrier: wrong } : program.records.runtimeCarrier.get(subject) } }, program.records),
        reject: records => assertOptionalAdmissionRejected(program, records, node) },
        { name: "wrong selected result", records: createRustRecordFixture({ selectedOperation: { get: subject =>
          subject === node ? { ...selectedOperation, resultType: wrong } : program.records.selectedOperation.get(subject) } }, program.records),
        reject(records) {
          const writer = createRustProgramRecordBuilder(program.typeDefinitions, program.records);
          assert.throws(() => admitRustOperationSelection(node, acceptRustPolicy({
            operation: records.selectedOperation.get(node), targetFact: fact,
          }), { records: writer, requiredRecords: [] }), analysisFailure(node,
          "Conflicting Rust semantic plan 'selectedOperation' for one exact source subject."));
          assert.equal(writer.selectedOperation.get(node) === selectedOperation, true,
            "conflicting checked admission preserves the canonical original operation");
        } },
      ];
      for (const mutation of mutations) {
        const label = `${fact.property}: ${mutation.name}`;
        mutation.reject(mutation.records);
        assert.equal(mutation.records.optionalChainEmission.get(node) === program.records.optionalChainEmission.get(node), true,
          `${label}: the immutable completed chain was not forged or erased`);
        assert.equal(mutation.records.errorFieldEmission.get(node) === program.records.errorFieldEmission.get(node), true,
          `${label}: the immutable completed observation was not forged or erased`);
        const selected = context(mutation.records);
        const repeated = planPropertyAccess(node, selected);
        assert.equal(repeated !== undefined, true, `${label}: rendering reads admitted final plans, not superseded stages`);
        assert.equal(selected.diagnostics.length, 0, label);
        assert.equal(printRustExpr(repeated), printed, `${label}: the same one-borrow native operation is retained`);
        vectors += 1;
      }
      assertFinalObservationRequired(program, node, context);
    }
    assert.equal(vectors, 18, "every original six-vector, three-member axis remains on this surface");
  });
}

function analysisFailure(node, message) {
  return error => {
    assert.equal(error instanceof Error, true, "the source owner rejects with an actual invariant failure");
    assert.equal(error.message, message);
    assert.equal(error.diagnostic?.code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT");
    assert.equal(error.diagnostic.source, "tsonic-rust");
    assert.equal(error.diagnostic.category, "error");
    assert.equal(error.diagnostic.sourceNode === node, true, "the original checked source subject owns the refusal");
    return true;
  };
}

function assertOptionalAdmissionRejected(program, records, node) {
  const producer = createRustOptionalChainEmissionProducer(() => {});
  const issues = analyzeRustOptionalChainEmission({ ...program, records }, [node], producer, []);
  assert.equal(issues.length, 1, "malformed optional correspondence is rejected once before publication");
  assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT");
  assert.equal(issues[0].source, "tsonic-rust");
  assert.equal(issues[0].category, "error");
  assert.equal(issues[0].sourceNode === node, true);
  assert.equal(issues[0].message,
    "Optional-chain lowering conflicts with its exact guard, selected receiver, operation, or result carriers. Node kind: KindPropertyAccessExpression.");
  assert.deepEqual(issues[0].evidence, ["target.capability=rust.backend.optional-chain-contract"]);
  assert.equal(producer.records.optionalChainEmission.get(node) === undefined, true, "no malformed final chain is published");
}

function assertErrorAdmissionRejected(program, records, node) {
  const producer = createRustErrorFieldProducer(() => {});
  assert.throws(() => analyzeRustErrorFieldBorrows({ ...program, records }, [node], producer, []), analysisFailure(node,
    "Builtin Error property reading conflicts with its finalized member or exact native carriers."));
  assert.equal(producer.records.errorFieldEmission.get(node) === undefined, true, "no malformed final observation is published");
}

function assertFinalObservationRequired(program, node, context) {
  const writer = createRustProgramRecordBuilder(program.typeDefinitions, program.records);
  const required = [];
  assert.equal(analyzeRustOptionalChainEmission(program, [node], writer.optionalChainEmissionPlans, required).length, 0);
  assert.equal(analyzeRustErrorFieldBorrows(program, [node], writer.errorFieldPlans, required).length, 0);
  for (const [family, construct, producer] of [
    ["optionalChainEmission", "optional-chain", "analysis/operations/optional-chains.ts"],
    ["errorFieldEmission", "builtin-error-property", "analysis/operations/error-field-borrows.ts"],
  ]) {
    assert.equal(required.some(requirement => requirement.subject === node && requirement.family === family &&
      requirement.construct === construct && requirement.producer === producer), true,
    `${family}: the real final producer registers its required publication`);
    const records = createRustRecordFixture({ [family]: { get: subject =>
      subject === node ? undefined : writer.readers[family].get(subject) } }, { ...program.records, ...writer.readers });
    assert.throws(() => assertRustRequiredRecords(records, required), analysisFailure(node,
      `Required Rust semantic plan '${family}' was not published for '${construct}' by '${producer}'.`));
  }
  writer.seal(required);
  const records = createRustRecordFixture({ optionalChainEmission: writer.optionalChainEmission,
    errorFieldEmission: writer.errorFieldEmission, errorFieldSnapshot: writer.errorFieldSnapshot }, program.records);
  const selected = context(records);
  assert.equal(planPropertyAccess(node, selected) !== undefined, true, "the same real completed plans remain renderable");
  assert.equal(selected.diagnostics.length, 0);
}
