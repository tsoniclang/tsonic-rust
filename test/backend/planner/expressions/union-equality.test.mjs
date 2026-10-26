import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";


import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustEffectiveValueCarrier } from "../../../../dist/analysis/conversions/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";
import { crossFileBranchUnionFiles } from "../../../../../tsonic/test/fixtures/cross-file-branch-unions.mjs";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceOptionalElementCarrier } from "../../../../dist/target-model/types/carriers/optional.js";
import { analyzeRustUnionEquality } from "../../../../dist/analysis/operations/union-equality.js";
import { analyzeRustBinaryEmission } from "../../../../dist/analysis/operations/binary-emission.js";
import { createRustUnionEqualityProducer } from "../../../../dist/analysis/program/records/union-equality.js";
import { createRustBinaryEmissionProducer } from "../../../../dist/analysis/program/records/expression-binary.js";

function planningContext(program, node) {
  const { ast } = program.source;
  return { input: { program }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
}

function assertRejectedBeforeSeal(program, node, fact, label) {
  const changed = { ...program, records: createRustRecordFixture({
    targetOperation: { get: subject => subject === node ? fact : program.records.targetOperation.get(subject) },
  }, program.records) };
  const binary = createRustBinaryEmissionProducer(() => {});
  const issues = analyzeRustBinaryEmission(changed, [node], binary);
  const union = createRustUnionEqualityProducer(() => {});
  if (issues.length !== 0) {
    assert.equal(issues.every(issue => issue.code === "RUST_MISSING_TARGET_FACT"), true, label + ": exact source-operation correspondence");
    assert.equal(binary.records.binaryEmission.get(node) === undefined, true, label + ": invalid operands are not published");
  } else {
    assert.throws(() => analyzeRustUnionEquality(changed, [node], union), failure =>
      failure?.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" &&
      failure.message === "Union comparison requires exact sealed native operands, variants and equality operations.", label);
  }
  assert.equal(union.records.unionEquality.get(node) === undefined, true, label + ": no invalid union plan reaches the planner");
}

test("union equality publishes immutable borrows and same-owner snapshots through the binary read owner", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Token {}
type Choice = string | Token;
export function mutating(initial: Choice, replacement: Choice): boolean {
  let current = initial;
  const replace = (): Choice => { current = replacement; return initial; };
  return current === replace();
}
export function stable(left: Choice, right: Choice): boolean { return left === right; }
` } });
  const { ast } = program.source;
  const pending = program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile);
  const selected = new Map();
  while (pending.length !== 0) {
    const node = pending.pop();
    const emission = program.records.binaryEmission.get(node);
    if (emission?.fact.kind === "union-equality") selected.set(ast.text(emission.left), emission);
    pending.push(...ast.children(node));
  }
  const mutating = selected.get("current");
  const stable = selected.get("left");
  assert.equal(mutating !== undefined, true, "the whole closed-union mutation is admitted");
  assert.equal(stable !== undefined, true, "the native readonly union comparison is admitted");
  const read = program.records.readOwnership.get(mutating.left);
  assert.equal(read?.value.kind, "clone", `the original payload is captured before replacing its owner; readsStorage=${read?.readsStorage}; source=${read?.source.kind}; snapshot=${read?.snapshot?.kind}; stablePlace=${read?.stablePlace}`);
  assert.equal(read.borrowedAcross.has(mutating.right), false, "the snapshot does not retain a lease across mutation");
  assert.equal(mutating.leftShared, false, "union emission consumes the selected snapshot exactly once");
  assert.equal(stable.leftShared, true, "the immutable native left operand stays shared");
  assert.equal(stable.rightShared, true, "the immutable native right operand stays shared");
  const node = ast.parent(mutating.left);
  assert.equal(ast.is.IsBinaryExpression(node), true, "the native operand retains its actual comparison parent");
  const context = planningContext(program, node);
  context.expressionOverrides = new Map([
    [mutating.left, { expression: { kind: "call", path: "selected_snapshot", args: [] }, carrier: mutating.fact.leftCarrier }],
    [mutating.right, { expression: { kind: "call", path: "mutate_owner", args: [] }, carrier: mutating.fact.rightCarrier }],
  ]);
  const planned = planBinaryExpression(node, context);
  assert.equal(planned.kind, "block", "the owned snapshot has its own complete native temporary scope");
  assert.equal(planned.body.statements[0].kind, "let", "the first operand completes before RHS evaluation");
  assert.equal(planned.body.statements[1].kind, "let", "the second operand follows without reordering a shared first expression");
  const printed = printRustExpr(planned);
  assert.equal(printed.match(/selected_snapshot\(\)/gu)?.length, 1, "snapshot executes once");
  assert.equal(printed.match(/mutate_owner\(\)/gu)?.length, 1, "RHS executes once");
  assert.equal(printed.indexOf("selected_snapshot()") < printed.indexOf("mutate_owner()"), true,
    "the first native statement releases temporary guards before the later mutation");
});

test("native union equality keeps independent eq and ne calls and exact absent-arm polarity", () => {
  for (const surfaces of [[], ["js"]]) {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Token { value: number = 1; }
type Choice = string | Token;
export function same(left: Choice | undefined, right: Choice | undefined): boolean { return left === right; }
export function different(left: Choice | undefined, right: Choice | undefined): boolean { return left !== right; }
` } });
    const ast = program.source.ast;
    const comparisons = [];
    const visit = node => {
      const selected = program.records.unionEquality.get(node);
      if (selected !== undefined) comparisons.push({ node, selected });
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(comparisons.length, 2, "both authored native union comparisons reach the sealed owner");
    for (const { node, selected } of comparisons) {
      const method = selected.fact.negated ? "ne" : "eq";
      const label = (surfaces[0] ?? "native") + ": " + method;
      const object = selected.arms.find(arm => arm.operation.kind === "operator-call" &&
        arm.operation.path.startsWith("core::cmp::PartialEq::"));
      assert.equal(object !== undefined, true, label + ": the original native object arm remains present");
      assert.equal(object.operation.path, `core::cmp::PartialEq::${method}`,
        label + ": the native ne implementation is not derived from eq");
      assert.equal(object.operation.operandModes.every(mode => mode === "ref"), true,
        label + ": native object comparison borrows both original payloads");
      const absent = selected.arms.find(arm => arm.left.absence && arm.right.absence);
      assert.equal(absent !== undefined, true, label + ": one native absence pair remains present");
      assert.equal(absent.constant, !selected.fact.negated, label + ": the absent pair has its exact native result");
      assert.equal(selected.unmatchedResult, selected.fact.negated, label + ": disjoint native variants keep authored polarity");
      assert.equal(Object.hasOwn(selected, "fallback"), false, label + ": only the current unmatched-result data reaches rendering");
      const context = planningContext(program, node);
      const planned = planBinaryExpression(node, context);
      assert.equal(planned !== undefined, true, label + ": the admitted native plan renders");
      assertNoTargetDiagnostics(context.diagnostics);
      const output = printRustExpr(planned);
      assert.equal(output.includes(`core::cmp::PartialEq::${method}`), true, label + ": exact native call emitted");
      assert.equal(output.includes(`core::cmp::PartialEq::${method === "eq" ? "ne" : "eq"}`), false,
        label + ": opposite native implementation is not substituted");
      assert.doesNotMatch(output, /!\s*match|\.clone\(|Box::|Arc::|Rc::|dyn |from_closed/u,
        label + ": no global negation, copied payload or new compatibility carrier");
    }
  }
});

test("inferred cross-file optional unions retain absence and compare literals without enum injection", () => {
  const { program } = analyzeRust({ target: { id: "rust", options: { outputType: "bin" } }, files: {
    ...crossFileBranchUnionFiles, "index.ts": crossFileBranchUnionFiles["index.ts"] +
      '\nexport function main(): void { if (!run()) throw new Error("branch unions"); }\nmain();\n',
  } });
  const { ast } = program.source;
  const pending = [...program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)];
  let comparisons = 0;
  while (pending.length !== 0) {
    const node = pending.pop();
    const binary = ast.as.AsBinaryExpression(node);
    if (binary?.Right !== undefined && ast.is.IsStringLiteral(binary.Right)) {
      const fact = program.records.targetOperation.get(node);
      if (fact?.kind === "union-equality") {
        comparisons++;
        assert.equal(rustSourceOptionalElementCarrier(fact.leftCarrier) !== undefined, true, "checked inferred source absence survives");
        assert.equal(rustTargetTypeRefEquals(fact.rightCarrier, rustStringTargetType()), true, "literal stays native string");
        assert.equal(program.records.contextualValueConversion.get(binary.Right) === undefined, true,
          "comparison does not manufacture a complete enum payload");
      }
    }
    pending.push(...ast.children(node));
  }
  assert.equal(comparisons, 2);
});

test("union equality rejects stale carriers, paths, operations, coverage and polarity", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Token { value: number = 1; }
export function same(value: string | Token): boolean { return value === "a"; }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "union-equality") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.arms) && fact.arms.every(Object.isFrozen));
  const valid = planningContext(program, node);
  assert.ok(planBinaryExpression(node, valid), JSON.stringify(valid.diagnostics));
  assertNoTargetDiagnostics(valid.diagnostics);
  const arm = fact.arms[0];
  const mutations = [
    { arms: undefined }, { arms: [] }, { arms: [arm, arm] }, { arms: new Array(1) },
    { arms: [{ ...arm, left: { ...arm.left, path: [] } }] },
    { arms: [{ ...arm, operation: { ...arm.operation, rustOperator: "!=" } }] },
    { arms: [{ ...arm, right: { ...arm.right, carrier: rustSourcePrimitiveTargetType("int64") } }] },
    { exhaustive: true }, { negated: true }, { negated: "false" },
    { leftCarrier: undefined }, { rightCarrier: rustSourcePrimitiveTargetType("int64") },
    { resultCarrier: rustSourcePrimitiveTargetType("int64") }, { operationId: "changed" },
  ];
  for (const mutation of mutations) {
    assertRejectedBeforeSeal(program, node, { ...fact, ...mutation }, JSON.stringify(mutation));
  }
});

test("nullable union producer does not speculate payload conversions and planner borrows native arms once", () => {
  for (const surfaces of [[], ["js"]]) {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
class Entry { value: number = 3; }
type Value = string | Entry;
type OptionalValue = Value | null | undefined;
export function equalText(left: OptionalValue, right: string | null | undefined): boolean { return left === right; }
export function equalEntry(left: OptionalValue, right: Entry | null | undefined): boolean { return left === right; }
export function reversed(right: Entry, left: OptionalValue): boolean { return right === left; }
` } });
    const { ast } = program.source;
    const operations = [];
    const visit = node => {
      const fact = program.records.targetOperation.get(node);
      if (fact?.kind === "union-equality") operations.push({ node, fact });
      for (const child of ast.children(node)) visit(child);
    };
    for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
    assert.equal(operations.length, 3);
    for (const { node, fact } of operations) {
      const binary = ast.as.AsBinaryExpression(node);
      for (const [operand, selected] of [[binary.Left, fact.leftCarrier], [binary.Right, fact.rightCarrier]]) {
        assert.ok(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(operand)?.carrier, selected));
        assert.ok(rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.records, operand), selected));
        assert.equal(program.records.contextualValueConversion.get(operand), undefined);
        assert.equal(program.records.optionProjection.get(operand), undefined);
      }
      const nativeContext = planningContext(program, node);
      const native = planBinaryExpression(node, nativeContext);
      assert.ok(native, JSON.stringify(nativeContext.diagnostics));
      assertNoTargetDiagnostics(nativeContext.diagnostics);
      assert.doesNotMatch(printRustExpr(native), /\.clone\(|Box::|Arc::|Rc::|dyn |from_closed|\.map\(/u);
      const context = planningContext(program, node);
      context.expressionOverrides = new Map([
        [binary.Left, { expression: { kind: "call", path: "produceLeft", args: [] }, carrier: fact.leftCarrier }],
        [binary.Right, { expression: { kind: "call", path: "produceRight", args: [] }, carrier: fact.rightCarrier }],
      ]);
      const planned = planBinaryExpression(node, context);
      assert.ok(planned, JSON.stringify(context.diagnostics));
      assertNoTargetDiagnostics(context.diagnostics);
      const output = printRustExpr(planned);
      assert.equal(output.match(/produceLeft\(\)/gu)?.length, 1);
      assert.equal(output.match(/produceRight\(\)/gu)?.length, 1);
      assert.ok(output.indexOf("produceLeft()") < output.indexOf("produceRight()"));
      assert.match(output, /Some\([^)]*::Variant\d\(/u);
      assert.doesNotMatch(output, /\.clone\(|Box::|Arc::|Rc::|dyn |from_closed|\.map\(/u);
      if (fact.arms.some(arm => arm.left.path.length === 0 && arm.right.path.length === 0)) assert.match(output, /\(None, None\) => true/u);
      assertRejectedBeforeSeal(program, node, { ...fact, arms: fact.arms.slice(0, -1) }, "every optional native arm remains required");
    }
  }
});
