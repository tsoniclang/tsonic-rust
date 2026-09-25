import {
  canonicalTargetForbiddenDirectories,
  canonicalTargetLayerPolicies,
  canonicalTargetRootPolicies,
  canonicalTargetSourceRules,
  selectedTargetEvidenceRule,
  targetForbiddenPackage,
  createTargetLayerRules,
} from "../../../tsonic/test/architecture/tooling/target-layer-contract.mjs";

export const rustLayerRules = createTargetLayerRules();

export const rustLayerPolicies = canonicalTargetLayerPolicies;

export const rustForbiddenPackages = Object.freeze([
  targetForbiddenPackage("@tsonic/target-csharp", "Rust"),
  targetForbiddenPackage("@tsonic/csharp-runtime", "Rust"),
  targetForbiddenPackage("@tsonic/csharp-js", "Rust"),
  targetForbiddenPackage("@tsonic/csharp-nodejs", "Rust"),
]);

export const rustRootPolicies = canonicalTargetRootPolicies;

export const rustAllowedImplementationIndexes = new Set([
  "src/public/index.ts",
]);

export const rustForbiddenDirectories = canonicalTargetForbiddenDirectories;

export const rustSourceRules = Object.freeze([
  ...canonicalTargetSourceRules,
  Object.freeze({
    ruleId: "ARCH-RUST-PRINTER-001",
    matches: (file, source) => file.startsWith("src/print/") &&
      /\bfinalizeRustSourceStyle\b/u.test(source),
    reason: "Rust source normalization completes before output-plan closure; printers are observationally pure.",
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
  selectedTargetEvidenceRule([
    "src/analysis/operations/",
    "src/policy/operations/",
  ]),
]);
