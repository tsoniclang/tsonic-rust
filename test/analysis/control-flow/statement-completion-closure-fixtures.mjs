import assert from "node:assert/strict";

import { analyzeRust, compileRust, artifactText, acmePlatformPackage, acmeTestingPackage, boolCarrier, unitCarrier } from "../../helpers/rust-session.mjs";

import { analyzeRustStatementCompletions, rustRuntimeSetSourceInputs } from "../../../dist/analysis/control-flow/statement-completion.js";

import { createRustProviderPackage } from "../../../dist/public/provider.js";

import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

import { rustNativeFixtureNodes } from "../../helpers/records.mjs";

import { createRustStatementCompletionProducer } from "../../../dist/analysis/program/records/operations/statement-completion.js";

import { createRustDirectStorageProducer } from "../../../dist/analysis/program/records/storage/direct-storage.js";


// Statement decisions are published as sealed record families; the queries below read those families.
const statementQueries = Object.freeze({ conditionFor: "statementCondition", controlTargetsFor: "statementControlTargets",
  exitFor: "controlExit", iterationFor: "iterationCompletion", setterFor: "runtimeSetter", assignmentFor: "assignmentCompletion",
  projectTypeTestReadsFor: "projectTypeTestReads" });


function statementIndex(records) {
  return Object.freeze({ admitted: node => records.statementAdmission.get(node) === true,
    ...Object.fromEntries(Object.entries(statementQueries).map(([name, family]) => [name, node => records[family].get(node)])) });
}


function checkedGuardNodes(program) {
  const nodes = [];
  const pending = [...program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)];
  while (pending.length !== 0) {
    const node = pending.pop();
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return nodes;
}


function diagnosticSourceLabel(diagnostic, source) {
  const node = diagnostic.sourceNode;
  if (node === undefined) return "";
  const declaredName = source.ast.is.IsIdentifier(node) ? node : source.ast.name(node);
  const name = declaredName !== undefined && source.ast.is.IsIdentifier(declaredName) ? source.ast.text(declaredName) : undefined;
  const parent = source.ast.parent(node);
  return ` at ${source.ast.kindName(node)}${name === undefined ? "" : ` ${name.slice(0, 192)}`}` +
    `${parent === undefined ? "" : ` parent=${source.ast.kindName(parent)}`}`;
}


const source = `
export function run(flag: boolean): number {
  let total = 0;
  outer: inner: for (let index = 0; index < 3; index++) {
    if (flag) continue outer;
    switch (index) { case 1: break; default: total += index; }
    if (total > 2) break outer;
  }
  do { total += 1; } while (total < 0);
  while (flag) { break; }
  return total;
}
`;


function checked(text = source, options = {}) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text }, ...options });
  const nodes = [];
  const visit = node => { nodes.push(node); program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  return { program, nodes, ast: program.source.ast };
}


function select(program, records = program.records) {
  const nativeNodes = rustNativeFixtureNodes(program);
  const native = new Set(nativeNodes);
  const countedLoops = new Map(nativeNodes.flatMap(node => {
    const loop = program.records.countedLoop.get(node);
    return loop === undefined ? [] : [[node, loop]];
  }));
  const selected = analyzeRustStatementCompletions({ source: program.source, sourceFiles: program.sourceFiles, records,
    isNativeNode: node => native.has(node),
    names: program.names, typeDefinitions: program.typeDefinitions, errorRegions: program.errorRegions,
    projectFlowReadSelections: program.projectFlowReadSelections,
    producer: createRustStatementCompletionProducer(() => undefined), required: [], countedLoops,
    safetyApplications: program.safetyApplications, components: program.sourcePackageComponents,
    ownership: program.ownership, projectTypes: program.projectTypes, projectFieldDispatch: program.projectFieldDispatch,
    structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites });
  return selected.kind === "resolved" ? { ...selected, plan: statementIndex(selected.plan) } : selected;
}

export {
  statementQueries,
  statementIndex,
  checkedGuardNodes,
  diagnosticSourceLabel,
  source,
  checked,
  select,
};
