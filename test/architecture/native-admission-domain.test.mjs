import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const walkerContracts = new Map([
  ["analysis/source-modules/component-semantics.ts", [1, "mixed"]],
  ["analysis/reachability/generated-item-usage.ts", [1, "native-domain"]],
  ["analysis/callables/values/lexical-value-environments.ts", [1, "native-domain"]],
  ["analysis/objects/class-values.ts", [1, "native-domain"]],
  ["analysis/project-types/receiver-captures.ts", [1, "native-domain"]],
  ["analysis/errors/regions.ts", [1, "native-domain"]],
  ["analysis/project/dispatch-demand.ts", [1, "native-domain"]],
  ["analysis/control-flow/counted-loop-representations.ts", [3, "admitted-loop-subtrees"]],
  ["analysis/control-flow/project-flow-read-selections.ts", [1, "native-domain"]],
  ["analysis/control-flow/statement-completion.ts", [1, "native-domain"]],
  ["analysis/objects/copied-methods.ts", [1, "native-domain"]],
  ["analysis/objects/frozen-receiver-captures.ts", [1, "native-domain"]],
  ["analysis/program/records/callables/module-callable-storage.ts", [1, "native-domain"]],
  ["analysis/project-types/mutable-storage-requirements.ts", [1, "native-domain"]],
  ["analysis/project-types/object-representation.ts", [2, "native-domain"]],
  ["analysis/errors/thrown-values.ts", [1, "native-domain"]],
  ["analysis/callables/async/async-results.ts", [1, "admitted-callable-subtrees"]],
  ["analysis/callables/generics/specializations.ts", [1, "admitted-name-inventory"]],
  ["analysis/project-types/construction-readiness.ts", [2, "native-domain"]],
  ["analysis/callables/calls/inferred-return.ts", [1, "admitted-callable-subtrees"]],
  ["analysis/declarations/generic-callable-requirements.ts", [1, "admitted-contract-subtrees"]],
  ["analysis/errors/closed-errors.ts", [1, "native-domain"]],
  ["analysis/project-types/catalog/helpers.ts", [1, "admitted-name-inventory"]],
  ["analysis/reachability/this-references.ts", [1, "admitted-method-subtrees"]],
  ["analysis/project-types/source-declarations.ts", [1, "native-domain"]],
  ["analysis/callables/generics/generic-values.ts", [1, "native-domain"]],
  ["analysis/callables/ownership/ownership-components.ts", [2, "checked-source-identities-and-native-roots"]],
  ["analysis/callables/calls/signatures.ts", [1, "native-domain"]],
  ["analysis/callables/emission/emission-requests.ts", [1, "native-domain"]],
  ["analysis/callables/native/native-inputs.ts", [1, "admitted-callable-subtrees"]],
  ["analysis/callables/emission/entry-parameters.ts", [1, "admitted-leading-receiver-subtrees"]],
  ["analysis/callables/emission/entry-header-placements.ts", [2, "admitted-emitted-header-placement-subtrees"]],
  ["analysis/callables/storage/native-storage-values.ts", [1, "admitted-callable-subtrees"]],
  ["analysis/control-flow/binding-liveness.ts", [1, "admitted-callable-subtrees"]],
  ["analysis/operations/optional-chains.ts", [1, "admitted-operation-subtrees"]],
  ["analysis/declarations/emission.ts", [1, "admitted-parameter-subtrees"]],
  ["analysis/declarations/generic-callable-requirement-uses.ts", [1, "admitted-contract-subtrees"]],
  ["analysis/objects/object-literal-emission.ts", [1, "checked-identities-filtered-by-native-membership"]],
  ["analysis/program/records/objects/class-value-registry.ts", [1, "native-domain"]],
  ["analysis/project/binary-dispatch-emission.ts", [1, "checked-source-name-inventory"]],
  ["analysis/project-types/construction-plan.ts", [1, "native-domain"]],
  ["analysis/source-modules/emission.ts", [1, "admitted-module-statements"]],
  ["analysis/source-modules/package-initializers.ts", [1, "checked-source-name-inventory"]],
  ["analysis/callables/values/value-plan.ts", [1, "native-domain"]],
  ["analysis/declarations/lifetimes.ts", [2, "native-domain"]],
  ["analysis/module-initialization/analyze.ts", [1, "admitted-module-statements"]],
  ["analysis/names/plan.ts", [1, "native-domain"]],
  ["analysis/numeric/literal-admission.ts", [1, "native-domain"]],
  ["analysis/objects/class-environments.ts", [3, "native-domain"]],
  ["analysis/operations/inputs.ts", [1, "admitted-operation-subtrees"]],
  ["analysis/ownership/effects.ts", [1, "native-domain"]],
  ["analysis/program/analyze.ts", [1, "mixed"]],
  ["analysis/project-types/implicit-interfaces.ts", [1, "native-domain"]],
  ["analysis/project-types/type-family-demands.ts", [2, "native-domain"]],
  ["analysis/reachability/plan.ts", [1, "native-domain"]],
  ["analysis/errors/error-declarations.ts", [1, "native-domain"]],
  ["analysis/errors/fallibility.ts", [1, "native-domain"]],
  ["analysis/source-modules/analyze.ts", [1, "admitted-module-statements"]],
]);

const checkedStorageConsumers = new Map([
  ["analysis/program/context.ts", [2, "checked Promise-result disposition and integer-range identity; participation receives the actual storage owner"]],
  ["analysis/callables/calls/participation.ts", [1, "the sole native-domain producer checks source failure before reading the finite domain"]],
  ["analysis/callables/ownership/ownership-components.ts", [1, "checked source foreign-node and binding identity domain"]],
  ["analysis/callables/native/native-future-inputs.ts", [1, "checked source identity membership; discovery uses nativeNodes"]],
  ["analysis/callables/storage/native-storage.ts", [1, "checked source identity membership; conversion discovery uses nativeNodes"]],
  ["analysis/callables/generics/generic-physical.ts", [1, "complete checked source-file ownership identity"]],
  ["analysis/callables/native/native-captures.ts", [1, "complete checked capture identity membership"]],
  ["analysis/callables/ownership/borrowed-returns.ts", [2, "checked lexical callable and borrowed-return identities"]],
  ["analysis/callables/ownership/physical-lifecycle.ts", [1, "exact checked source-node identity map"]],
  ["analysis/callables/async/promise-results.ts", [1, "checked promise-result disposition identity domain"]],
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

function walkerIssue(path, source) {
  const count = [...source.matchAll(/\bforEachChild\b/gu)].length;
  const contract = walkerContracts.get(path);
  if (count === 0) return undefined;
  if (contract === undefined) return `${path}: unregistered source traversal`;
  if (count !== contract[0]) return `${path}: source traversal count changed from ${contract[0]} to ${count}`;
  if (contract[1] === "native-domain" && !/\b(?:isNativeNode|nativeNodes)\b/u.test(source))
    return `${path}: native traversal lost its required admitted domain`;
  return undefined;
}

test("every Rust source traversal has one native-domain or checked-input contract", () => {
  for (const directory of ["analysis", "policy"]) for (const path of sourceFiles(join(root, "src", directory))) {
    const source = readFileSync(path, "utf8");
    const name = relative(join(root, "src"), path);
    assert.equal(walkerIssue(name, source) === undefined, true, walkerIssue(name, source) ?? name);
  }
});

test("a new traversal cannot hide behind an already registered native owner", () => {
  const path = "analysis/names/plan.ts";
  const source = readFileSync(join(root, "src", path), "utf8");
  assert.equal(walkerIssue(path, source) === undefined, true, "the actual native name owner is registered");
  assert.equal(walkerIssue(path, source + "\nast.forEachChild(unfilteredRoot, visit);\n") !== undefined, true,
    "adding a second source walk still requires a reviewed domain contract");
  assert.equal(walkerIssue("analysis/unregistered-owner.ts", "ast.forEachChild(root, visit)") !== undefined, true,
    "a new file cannot introduce unreviewed global discovery");
});

test("whole checked storage nodes are used only by their explicit identity owners", () => {
  const counts = new Map();
  for (const directory of ["analysis", "policy"]) for (const path of sourceFiles(join(root, "src", directory))) {
    const source = readFileSync(path, "utf8");
    const count = [...source.matchAll(/\b(?:sourceStorage|storage)\.nodes\b/gu)].length;
    if (count === 0) continue;
    const name = relative(join(root, "src"), path);
    const contract = checkedStorageConsumers.get(name);
    assert.equal(contract !== undefined, true, `${name}: raw checked domain requires an explicit identity owner`);
    assert.equal(count, contract[0], `${name}: an extra raw discovery cannot hide in a checked identity owner`);
    counts.set(name, count);
  }
  assert.equal(counts.size, checkedStorageConsumers.size, "all declared checked identity consumers remain exact");
});

test("native context failure stops before numeric names lifetimes and body work", () => {
  const source = readFileSync(join(root, "src/analysis/program/context.ts"), "utf8");
  const body = source.slice(source.indexOf("export function createRustAnalysisContext("));
  const failedSource = body.indexOf("if (sourceStorageFailure !== undefined) return rejectedTargetStage");
  const failedDomain = body.indexOf('if (participation.kind === "unresolved") return rejectedTargetStage');
  const nativeAdmission = body.indexOf("const numericLiteralAdmission =");
  assert.equal(failedSource >= 0 && failedDomain > failedSource && nativeAdmission > failedDomain, true,
    "a partial or unresolved domain cannot reach native admission");
  assert.match(body, /const nativeNodes = participation\.nodes;/u);
  assert.doesNotMatch(body, /participation\.kind[^;]*Object\.freeze\(\[\]\)/u);
});

test("the native-domain owner refuses incomplete source storage before any callback", () => {
  const source = readFileSync(join(root, "src/analysis/callables/calls/participation.ts"), "utf8");
  const body = source.slice(source.indexOf("export function analyzeRustNativeParticipation("));
  assert.match(body, /readonly storage: Pick<SourceStorageQueries, "nodes" \| "failureReason">;/u);
  assert.equal(body.indexOf('if (failure !== undefined) return Object.freeze({ kind: "unresolved", reason: failure });') >= 0 &&
    body.indexOf('if (failure !== undefined) return Object.freeze({ kind: "unresolved", reason: failure });') <
      body.indexOf("return sourceNodesOutsideErasedSubtrees("), true,
  "a truncated but parent-closed source prefix is rejected before classification or records");
});

test("discarded native callable rendering precedes every body and capture read", () => {
  const source = readFileSync(join(root, "src/backend/planner/expressions/callable.ts"), "utf8");
  const body = source.slice(source.indexOf("export function planRustCallableExpressionBody("));
  assert.equal(body.indexOf('resultUse === "discarded" || rustCallableCreationIsErased(node, context)') >= 0 &&
    body.indexOf('resultUse === "discarded" || rustCallableCreationIsErased(node, context)') < body.indexOf("const closureFact ="), true,
  "sealed native participation reaches unit rendering before missing erased records");
  assert.match(source, /records\.nativeParticipation\.get\(node\)/u);
  assert.doesNotMatch(source, /sourceCallableDefinitionIsDiscarded/u);
});
