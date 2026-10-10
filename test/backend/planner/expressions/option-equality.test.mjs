import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { nativeOwnershipCostSupport } from "../../../helpers/native-ownership-cost.mjs";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType, rustVecTargetType } from "../../../../dist/target-model/types/index.js";
import { planRustStringComparisonView } from "../../../../dist/backend/planner/expressions/string-comparison-views.js";
import { planRustOptionPayloadView } from "../../../../dist/backend/planner/expressions/option-payload-views.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";

test("optional equality rejects forged native carriers, borrowed views, presence depths and operators", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function equal(left: string | undefined, right: string): boolean { return left === right; }
    export function unequal(left: string | undefined, right: string | undefined): boolean { return left !== right; }
    export function identity(left: string[] | undefined, right: string[]): boolean { return left === right; }
  ` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "option-equality") operations.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(operations.length, 3);
  for (const { node, fact } of operations) {
    const context = selected => ({ input: { program: { ...program,
      facts: { ...program.facts, getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
        ? selected : program.facts.getFact(subject, key) } } }, diagnostics: [],
      sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
      syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
    });
    const accepted = context(fact);
    assert.equal(planBinaryExpression(node, accepted) !== undefined, true, "unchanged exact fact plans");
    assert.equal(accepted.diagnostics.length, 0);
    for (const mutation of [
      { view: "value" }, { view: "shared" }, { view: "forged" }, { borrowString: true },
      { leftLiftDepth: -1 }, { rightLiftDepth: fact.rightLiftDepth + 1 },
      { rightLiftDepth: Infinity }, { leftCarrier: rustSourcePrimitiveTargetType("int64") },
      { rightCarrier: rustSourcePrimitiveTargetType("int64") }, { comparisonCarrier: rustOptionTargetType(rustStringTargetType()) },
      { negated: !fact.negated }, { negated: "false" }, { operationId: "forged" }, { guessed: true },
    ]) {
      if (Object.keys(mutation).every(key => mutation[key] === fact[key])) continue;
      const rejected = context({ ...fact, ...mutation });
      assert.equal(planBinaryExpression(node, rejected) === undefined, true, Object.keys(mutation).join(","));
      assert.equal(rejected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"), true);
    }
  }
});

test("nested native non-Copy optional payload views compare without moves or cloning", () => {
  const { program } = analyzeRust({ files: { "index.ts": `export const source = "native";` } });
  const { ast } = program.source;
  const context = { input: { program }, diagnostics: [], sourceFile: program.sourceFiles[0],
    syntheticNames: createRustSyntheticNameState(ast, program.sourceFiles[0], []) };
  const carrier = rustOptionTargetType(rustOptionTargetType(rustOptionTargetType(rustVecTargetType(rustStringTargetType()))));
  const view = planRustOptionPayloadView({ kind: "path", path: "owned" }, carrier, "shared", context);
  const expression = printRustExpr(view);
  assert.doesNotMatch(expression, /\.clone\(|\.to_owned\(|String::from/u);
  const source = `${nativeOwnershipCostSupport}
fn equal(owned: &Option<Option<Option<Vec<String>>>>, borrowed: Option<Option<Option<&Vec<String>>>>) -> bool {
    ${expression} == borrowed
}

#[test]
fn nested_non_copy_presence_and_native_borrow_cost() {
    let values = vec![String::from("native")];
    let owned = Some(Some(Some(vec![String::from("native")])));
    let (_, cost) = measure(|| {
        for _ in 0..10_000 {
            assert!(std::hint::black_box(equal(&owned, Some(Some(Some(&values))))));
        }
    });
    assert_eq!(cost, Cost::default());
    assert!(equal(&None, None));
    assert!(!equal(&None, Some(None)));
    assert!(equal(&Some(None), Some(None)));
    assert!(!equal(&Some(None), Some(Some(None))));
    assert!(equal(&Some(Some(None)), Some(Some(None))));
    assert_eq!(owned.as_ref().unwrap().as_ref().unwrap().as_ref().unwrap(), &values);
    assert_eq!(values[0], "native");
}
`;
  const root = createTestWorkspace(fileURLToPath(new URL("../../../../.temp/", import.meta.url)), "native-option-borrow-");
  const path = join(root, "native.rs");
  const executable = join(root, "native");
  writeFileSync(path, source);
  for (const [command, args] of [
    ["rustfmt", ["--edition", "2021", path]],
    ["rustc", ["--edition=2021", "--test", "-Dwarnings", path, "-o", executable]],
    [executable, []],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576 });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  }
});

test("nested native String optional comparison views retain every presence level without allocations", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function equal(left: string | undefined, right: string): boolean { return left === right; }
  ` } });
  const { ast } = program.source;
  let read;
  const visit = node => {
    if (ast.is.IsIdentifier(node) && ast.text(node) === "left") read = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(read !== undefined, true);
  const context = { input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(read),
    syntheticNames: createRustSyntheticNameState(ast, read, []) };
  const carrier = rustOptionTargetType(rustOptionTargetType(rustOptionTargetType(rustStringTargetType())));
  const view = planRustStringComparisonView(read, { kind: "path", path: "owned" }, carrier, undefined, context);
  assert.equal(view !== undefined, true);
  assert.equal(context.diagnostics.length, 0);
  const source = `${nativeOwnershipCostSupport}
fn equal(owned: &Option<Option<Option<String>>>, borrowed: Option<Option<Option<&str>>>) -> bool {
    ${printRustExpr(view)} == borrowed
}

#[test]
fn nested_presence_and_native_borrow_cost() {
    let owned = Some(Some(Some(String::from("native"))));
    let (_, cost) = measure(|| {
        for _ in 0..10_000 {
            assert!(std::hint::black_box(equal(&owned, Some(Some(Some("native"))))));
            assert!(!equal(&owned, Some(Some(Some("other")))));
        }
    });
    assert_eq!(cost, Cost::default());
    assert!(equal(&None, None));
    assert!(!equal(&None, Some(None)));
    assert!(equal(&Some(None), Some(None)));
    assert!(!equal(&Some(None), Some(Some(None))));
    assert!(equal(&Some(Some(None)), Some(Some(None))));
    assert!(!equal(&Some(Some(None)), None));
    assert_eq!(owned.as_ref().unwrap().as_ref().unwrap().as_deref(), Some("native"));
}
`;
  const root = createTestWorkspace(fileURLToPath(new URL("../../../../.temp/", import.meta.url)), "nested-option-cost-");
  const path = join(root, "native.rs");
  const executable = join(root, "native");
  writeFileSync(path, source);
  for (const [command, args] of [
    ["rustfmt", ["--edition", "2021", path]],
    ["rustc", ["--edition=2021", "--test", "-Dwarnings", path, "-o", executable]],
    [executable, []],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576 });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  }
});
