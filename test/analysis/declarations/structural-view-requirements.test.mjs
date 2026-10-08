import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

test("stored structural reads retain Clone only on their native implementation", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    class Box<Value> { constructor(public value: Value) {} }
    export function project<Value>(box: Box<Value>): { readonly value: Value } { return box; }
  ` } });
  const views = program.classValues.instanceViews;
  assert.equal(views.length, 1);
  const view = views[0];
  const contracts = program.declarationGenericRequirements;
  const classContract = contracts.contractFor(view.declaration);
  const implementation = contracts.contractForStructuralView(view);
  assert.equal(classContract !== undefined, true);
  assert.equal(implementation !== undefined, true);
  assert.equal(classContract.typeParameters.some(parameter => parameter.requirements.includes("clone")), false,
    "storage and construction do not inherit a read adapter's Clone restriction");
  assert.equal(implementation.typeParameters.some(parameter => parameter.requirements.includes("clone")), true,
    "the generated owned read has one exact Clone obligation");
  assert.equal(Object.isFrozen(implementation), true);
  assert.equal(Object.isFrozen(implementation.typeParameters), true);
  let project;
  const visit = node => {
    if (program.source.ast.is.IsFunctionDeclaration(node)) project = node;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const caller = contracts.contractFor(project);
  assert.equal(caller.typeParameters.some(parameter => parameter.requirements.includes("clone")), true,
    "the actual view publication caller retains its instantiated implementation obligation");
  const foreign = { ...view, targetCarrier: { kind: "tuple", elements: [] } };
  assert.equal(contracts.contractForStructuralView(foreign) === undefined, true,
    "foreign source-to-target relationships cannot acquire an implementation contract");
});
