import {
  canonicalTargetForbiddenDirectories,
  canonicalTargetLayerPolicies,
  canonicalTargetSourceRules,
  targetForbiddenPackage,
  targetLayerExact,
  targetLayerPrefix,
  targetLayerPredicate,
  targetRootPolicy,
} from "../../../tsonic/test/architecture/tooling/target-layer-contract.mjs";

function isProviderModel(path) {
  return path.startsWith("src/providers/model/") ||
    path === "src/providers/packages/model.ts";
}

export const rustLayerRules = Object.freeze([
  targetLayerExact(["src/index.ts", "src/public/index.ts"], "public-root"),
  targetLayerExact(["src/public/provider.ts"], "public-provider-sdk"),
  targetLayerPrefix("src/descriptor/", "descriptor"),
  targetLayerPrefix("src/compilation/", "compilation"),
  targetLayerPrefix("src/options/", "options"),
  targetLayerPrefix("src/source/", "source"),
  targetLayerPredicate("provider-model", isProviderModel),
  targetLayerPredicate(
    "provider-implementation",
    (path) => path.startsWith("src/providers/") && !isProviderModel(path),
  ),
  targetLayerPrefix("src/target-model/", "target-model"),
  targetLayerPrefix("src/policy/", "policy"),
  targetLayerPrefix("src/analysis/", "analysis"),
  targetLayerPrefix("src/backend/target-ast/", "target-ast"),
  targetLayerPrefix("src/backend/artifact-model/", "artifact-model"),
  targetLayerPrefix("src/backend/planner/", "planner"),
  targetLayerPrefix("src/backend/emission/", "emission"),
  targetLayerExact(["src/backend/compile.ts"], "backend-entrypoint"),
  targetLayerPrefix("src/print/", "printer"),
  targetLayerPrefix("src/toolchain/", "toolchain"),
]);

export const rustLayerPolicies = canonicalTargetLayerPolicies;

export const rustForbiddenPackages = Object.freeze([
  targetForbiddenPackage("@tsonic/target-csharp", "Rust"),
  targetForbiddenPackage("@tsonic/csharp-runtime", "Rust"),
  targetForbiddenPackage("@tsonic/csharp-js", "Rust"),
  targetForbiddenPackage("@tsonic/csharp-nodejs", "Rust"),
]);

export const rustRootPolicies = Object.freeze([
  targetRootPolicy("src/", ["src/index.ts"]),
  targetRootPolicy("src/backend/", ["src/backend/compile.ts"]),
  targetRootPolicy("src/backend/planner/", [
    "src/backend/planner/context.ts",
    "src/backend/planner/diagnostics.ts",
    "src/backend/planner/option-default.ts",
  ]),
]);

export const rustAllowedImplementationIndexes = new Set([
  "src/public/index.ts",
]);

export const rustForbiddenDirectories = canonicalTargetForbiddenDirectories;

export const rustSourceRules = Object.freeze([
  ...canonicalTargetSourceRules,
  Object.freeze({
    ruleId: "ARCH-RUST-CONFIG-001",
    matches: (file, source) => file.startsWith("src/backend/") &&
      /\bconfiguration\.projectFile\b|from\s+["'][^"']*\/options\//u.test(source),
    reason: "Rust analysis and backend planning consume the one normalized target configuration.",
  }),
  Object.freeze({
    ruleId: "ARCH-RUST-PRINTER-001",
    matches: (file, source) => file.startsWith("src/print/") &&
      /\bfinalizeRustSourceStyle\b/u.test(source),
    reason: "Rust source normalization completes before output-plan closure; printers are observationally pure.",
  }),
  Object.freeze({
    ruleId: "ARCH-RUST-PLAN-001",
    matches: (file, source) => file === "src/backend/artifact-model/output.ts" &&
      /\bdiagnostic/u.test(source),
    reason: "Rust output plans contain complete target artifacts, never stage diagnostics.",
  }),
  Object.freeze({
    ruleId: "ARCH-RUST-PROGRAM-001",
    matches: (file, source) => file === "src/analysis/program/model.ts" &&
      /\b(?:Map|Set|Builder|Registry)\s*</u.test(source),
    reason: "The sealed Rust target program cannot expose mutable collections or builders.",
  }),
  Object.freeze({
    ruleId: "ARCH-RUST-PROVIDER-001",
    matches: (file, source) => file === "src/providers/packages/model.ts" &&
      /interface RustProviderSemantics[\s\S]*?\bReadonlyMap\s*</u.test(source),
    reason: "Sealed Rust provider semantics expose immutable metadata values rather than mutable Map objects.",
  }),
  Object.freeze({
    ruleId: "ARCH-RUST-PROVIDER-002",
    matches: (file, source) => file === "src/providers/packages/materialization.ts" &&
      /Readonly<Record<[^>]+>>\s*\|\s*ReadonlyMap\s*</u.test(source),
    reason: "Rust provider carrier materialization accepts one canonical immutable metadata representation.",
  }),
  Object.freeze({
    ruleId: "ARCH-RUST-SELECTION-001",
    matches: (file, source) => (
      file.startsWith("src/analysis/operations/") ||
      file.startsWith("src/policy/operations/")
    ) && /\.types\.(?:propertyInfos|callSignatures|constructSignatures)\s*\(/u.test(source),
    reason: "Checked Rust operation mapping consumes selected evidence and cannot fall back to structural member or signature enumeration.",
  }),
]);
