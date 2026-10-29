import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { analyzeRustOptionalChainEmission } from "../../../dist/analysis/operations/optional-chains.js";
import { selectRustProviderReads } from "../../../dist/analysis/operations/provider-forms.js";
import { createRustOptionalChainEmissionProducer } from "../../../dist/analysis/program/records/operations/optional-chain-emission.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { Node_Initializer, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { recursiveOptionalCollectionUnionFiles } from "../../../../tsonic/test/fixtures/recursive-source-unions.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("generated optional loans preserve the exact present and absent slots and native missing-index behavior", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "lib", crateName: "optional_loan_identity" } }, files: {
      "index.ts": `export type Children = readonly Children[] | undefined;
        export function first(children: Children): Children { return children?.[0]; }
        export function wrapped(children: Children): Children { return (children?.[0]); }`,
    } });
  assert.equal(result.diagnostics.length, 0, "both the direct and transparent native slot loans are admitted");
  for (const artifact of result.artifacts.filter(value => value.path.endsWith(".rs")))
    assert.doesNotMatch(artifact.text, /\.clone\(/u, "neither native result copies the recursive payload");
  const directory = writeGeneratedProject("optional-loan-identity", result.artifacts);
  mkdirSync(join(directory, "tests"), { recursive: true });
  writeFileSync(join(directory, "tests/identity.rs"), `
use optional_loan_identity::index::{first, wrapped, Children};

#[test]
fn exact_native_slots() {
    let absent: Option<Children> = None;
    assert!(std::ptr::eq(first(&absent).unwrap(), &absent));
    assert!(std::ptr::eq(wrapped(&absent).unwrap(), &absent));
    let present = Some(Children::Variant0(vec![None]));
    let expected = match &present {
        Some(Children::Variant0(children)) => &children[0],
        None => unreachable!(),
    };
    assert!(std::ptr::eq(first(&present).unwrap(), expected));
    assert!(std::ptr::eq(wrapped(&present).unwrap(), expected));
    let empty = Some(Children::Variant0(vec![]));
    assert!(std::panic::catch_unwind(|| first(&empty)).is_err());
    assert!(std::panic::catch_unwind(|| wrapped(&empty)).is_err());
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline", "--test", "identity"]);
});

function fixture(files = { "index.ts": `
export type Children = readonly Children[] | null | undefined;
export function first(children: Children): Children { return children?.[0]; }
` }) {
  let program;
  const { result } = compileRust({ surfaces: [], files, compileTarget(request) {
    const analyzed = analyzeRustAnalysisProgram(request);
    if (analyzed.kind === "rejected") return analyzed;
    program = analyzed.value;
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  assert.equal(result.diagnostics.length, 0, "the original native optional element has a completed analysis contract");
  assert.equal(program !== undefined, true, "the actual analysis program is retained");
  const nodes = [];
  const collect = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) collect(child); });
  };
  program.sourceFiles.forEach(collect);
  const operation = nodes.find(node => program.records.optionalChain.get(node) !== undefined);
  assert.equal(operation !== undefined, true, "the checked native index is present");
  const declaration = sourceEnclosingCallable(operation, program.source.ast);
  const returned = program.records.sourceCallableReturn.get(declaration);
  assert.equal(returned?.borrowedReturn !== undefined, true, "the declaration owns a completed return loan");
  return { program, nodes, operation, declaration, returned,
    reads: selectRustProviderReads(program, nodes).reads };
}

test("a returned optional slot cannot outlive an unretained actual argument", () => {
  const { program, nodes, reads } = fixture(recursiveOptionalCollectionUnionFiles);
  const { ast } = program.source;
  const declaration = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "present");
  assert.equal(declaration !== undefined, true, "the original effectful guarded initializer is retained");
  const initializer = Node_Initializer(ast, declaration);
  const retained = program.records.borrowedInitializer.get(initializer);
  assert.equal(retained?.loan !== undefined, true, "the actual source call has a declaration-owned physical loan");
  assert.equal(retained.retained.some(value => value.expression === retained.receiver), true,
    "the fresh original input has an enclosing-statement owner");
  assert.equal(program.ownership.reads.get(retained.receiver)?.readsStorage, false,
    "the fresh actual argument has no independent longer-lived storage");
  const records = createRustRecordFixture({ borrowedInitializer: {
    get: node => node === initializer ? { ...retained, retained: [] } : program.records.borrowedInitializer.get(node),
  } }, program.records);
  const producer = createRustOptionalChainEmissionProducer(() => {});
  const issues = analyzeRustOptionalChainEmission({ ...program, records }, nodes, producer, [], reads);
  assert.equal(issues.length, 1, "the absent temporary owner produces one precise physical-contract error");
  assert.equal(issues[0].sourceNode === initializer, true, "the error belongs to the exact initializer whose owner is absent");
  assert.equal(producer.records.optionalChainEmission.get(initializer) === undefined, true,
    "a loan from a discarded temporary owner is never published");
});

test("a native optional element seals its exact whole-slot loan without recomputing reads", () => {
  const { program, nodes, operation, returned, reads } = fixture();
  const producer = createRustOptionalChainEmissionProducer(() => {});
  let revoked = false;
  const records = createRustRecordFixture({ sourceCallableReturn: { get(node) {
    assert.equal(revoked, false, "only the open producer reads its required declaration input");
    return program.records.sourceCallableReturn.get(node);
  } } }, program.records);
  const issues = analyzeRustOptionalChainEmission({ ...program, records }, nodes, producer, [], reads);
  assert.equal(issues.length, 0, "the existing finalized ABI and selected stored-slot read agree");
  const selected = producer.records.optionalChainEmission.get(operation);
  assert.equal(selected?.loan !== undefined, true, "the native result carries an explicit physical loan");
  assert.equal(selected.loan.parameter === returned.borrowedReturn.parameter, true, "the original parameter identity is retained");
  assert.equal(selected.loan.owner === returned.borrowedReturn.parameter, true, "the whole optional guard is owned by that input");
  assert.equal(rustTargetTypeRefEquals(selected.loan.carrier, returned.borrowedReturn.carrier), true,
    "the physical result is the same declaration-owned reference and lifetime");
  assert.equal(selected.loan.abi.target.form, "index", "the present branch is a native stored index");
  assert.equal(selected.closure, undefined, "a native stored-slot loan does not use a value-producing closure");
  assert.equal(Object.isFrozen(selected.loan), true, "the physical loan is immutable");
  assert.equal(Object.isFrozen(selected.loan.bodies), true, "all applicable physical-body selections are immutable");
  revoked = true;
  assert.equal(producer.records.optionalChainEmission.get(operation) === selected, true,
    "sealed readback preserves identity after its producer inputs are revoked");
});

for (const label of ["parameter", "lifetime", "carrier", "guard", "ABI", "body", "mode", "missing read"])
  test(`a native optional loan rejects a mismatched ${label} before publication`, () => {
    const { program, nodes, operation, declaration, returned, reads } = fixture();
    const parameter = returned.borrowedReturn.parameter;
    const originalAbi = program.records.sourceParameterAbi.get(parameter);
    let records = program.records;
    let selectedReads = reads;
    if (label === "parameter" || label === "carrier") {
      const borrowedReturn = label === "parameter" ? { ...returned.borrowedReturn, parameter: operation }
        : { ...returned.borrowedReturn, carrier: { ...returned.borrowedReturn.carrier,
          referent: { kind: "source-primitive", name: "bool" } } };
      records = createRustRecordFixture({ sourceCallableReturn: {
        get: node => node === declaration ? { ...returned, borrowedReturn } : program.records.sourceCallableReturn.get(node),
      } }, records);
    } else if (label === "lifetime") {
      records = createRustRecordFixture({ sourceParameterAbi: {
        get: node => node === parameter ? { ...originalAbi, inputLifetime: { kind: "static" } }
          : program.records.sourceParameterAbi.get(node),
      } }, records);
    } else if (label === "guard") {
      records = createRustRecordFixture({ optionalChain: {
        get: node => node === operation ? { ...program.records.optionalChain.get(node), guard: operation }
          : program.records.optionalChain.get(node),
      } }, records);
    } else {
      selectedReads = reads.flatMap(selected => selected.node !== operation ? [selected] : label === "missing read" ? []
        : [{ ...selected, ...(label === "ABI" ? { abi: { ...selected.abi } } : {}),
          bodies: selected.bodies.map(body => ({ ...body, ...(label === "body" ? { body: body.body === true ? undefined : true } : {}),
            ...(label === "mode" ? { read: "storage" } : {}) })) }]);
    }
    const producer = createRustOptionalChainEmissionProducer(() => {});
    const issues = analyzeRustOptionalChainEmission({ ...program, records }, nodes, producer, [], selectedReads);
    assert.equal(issues.length, 1, `${label}: one exact physical-contract error is retained`);
    assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT", `${label}: a missing native proof is not admitted`);
    assert.equal(producer.records.optionalChainEmission.get(operation) === undefined, true,
      `${label}: no partial optional loan is published`);
  });
