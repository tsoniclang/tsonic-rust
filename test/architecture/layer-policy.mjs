const targetModelFiles = new Set([
  "src/policy/conversions/model.ts",
  "src/policy/conversions/contracts.ts",
  "src/policy/model/closed-data.ts",
  "src/policy/operations/error-boundary.ts",
  "src/policy/operations/forms.ts",
  "src/policy/operations/model.ts",
  "src/policy/operations/numeric-promotion-model.ts",
  "src/policy/types/equality.ts",
  "src/policy/types/model.ts",
  "src/policy/types/target-types.ts",
]);

const targetModelPrefixes = Object.freeze([
  "src/backend/model/",
  "src/policy/types/carriers/",
]);

function isTargetModel(path) {
  return targetModelFiles.has(path) ||
    targetModelPrefixes.some((prefixValue) => path.startsWith(prefixValue));
}

function isProviderModel(path) {
  return path.startsWith("src/providers/model/") ||
    path === "src/providers/packages/model.ts";
}

export const rustLayerRules = Object.freeze([
  exact(["src/index.ts"], "public-entrypoint"),
  prefix("src/public/", "public-entrypoint"),
  prefix("src/descriptor/", "descriptor"),
  prefix("src/options/", "options"),
  prefix("src/plugin/", "plugin"),
  prefix("src/source/", "source"),
  {
    layer: "provider-model",
    matches: isProviderModel,
  },
  {
    layer: "provider-implementation",
    matches: (path) => path.startsWith("src/providers/") && !isProviderModel(path),
  },
  {
    layer: "target-model",
    matches: isTargetModel,
  },
  {
    layer: "policy",
    matches: (path) => path.startsWith("src/policy/") && !isTargetModel(path),
  },
  prefix("src/analysis/", "analysis"),
  prefix("src/backend/rust-ast/", "target-ast"),
  prefix("src/backend/artifacts/", "artifact-model"),
  prefix("src/backend/project-model/", "artifact-model"),
  prefix("src/backend/planner/", "planner"),
  prefix("src/backend/emission/", "emission"),
  exact(["src/backend/rust-backend.ts"], "backend-entrypoint"),
  prefix("src/print/", "printer"),
  prefix("src/toolchain/", "toolchain"),
]);

export const rustLayerPolicies = Object.freeze([
  policy("public-entrypoint", [
    "descriptor", "options", "provider-model", "provider-implementation",
    "target-model",
  ], "ARCH-API-001", "Public entrypoints expose only target selection and provider-authoring contracts."),
  policy("descriptor", [
    "backend-entrypoint", "options", "source", "provider-model",
    "provider-implementation", "toolchain",
  ], "ARCH-TARGET-001", "The target descriptor composes services but does not consume analysis, planner, or printer internals."),
  policy("options", ["provider-model"], "ARCH-TARGET-001", "Rust options are leaf configuration contracts."),
  policy("plugin", [], "ARCH-TARGET-001", "Capability composition depends only on shared plugin contracts."),
  policy("source", ["provider-model", "target-model"], "ARCH-POLICY-001", "Source composition may use immutable target/provider contracts but not target execution layers."),
  policy("provider-model", ["target-model"], "ARCH-PROVIDER-001", "Provider contracts depend only on shared source contracts and immutable Rust target models."),
  policy("provider-implementation", [
    "provider-model", "target-model", "source", "options",
  ], "ARCH-PROVIDER-001", "Provider implementation cannot depend on analysis, planning, printing, emission, or toolchain execution."),
  policy("target-model", [], "ARCH-POLICY-001", "Immutable Rust target models are leaves below policy, providers, analysis, and planning."),
  policy("policy", ["target-model", "provider-model", "source"], "ARCH-POLICY-001", "Rust policy cannot depend on analysis, planning, target AST, printers, emission, or toolchains."),
  policy("analysis", ["target-model", "provider-model", "policy", "source"], "ARCH-ANALYSIS-001", "Rust analysis creates the sealed target program without consuming planning or emission."),
  policy("target-ast", ["target-model"], "ARCH-PLANNER-001", "The typed Rust AST cannot depend on policy, analysis, planning, or printers."),
  policy("artifact-model", ["target-model", "target-ast", "provider-model", "options"], "ARCH-PLANNER-001", "Artifact and Cargo models contain completed immutable data only."),
  policy("planner", [
    "analysis", "policy", "target-model", "target-ast", "artifact-model",
    "source", "provider-model", "options",
  ], "ARCH-PLANNER-001", "Rust planning consumes finalized analysis and cannot invoke provider workers, emission, printers, or toolchains."),
  policy("emission", ["artifact-model", "printer"], "ARCH-PRINTER-001", "Emission materializes completed typed artifacts through pure printers."),
  policy("backend-entrypoint", [
    "analysis", "planner", "emission", "provider-model",
  ], "ARCH-PLANNER-001", "The backend entrypoint only sequences analysis, planning, and materialization."),
  policy("printer", ["target-model", "target-ast", "artifact-model"], "ARCH-PRINTER-001", "Rust and Cargo printers consume only typed syntax and completed project models."),
  policy("toolchain", ["artifact-model", "options", "provider-model"], "ARCH-TOOLCHAIN-001", "Cargo execution consumes completed artifacts, references, and target options only."),
]);

export const rustForbiddenPackages = Object.freeze([
  forbidden("@tsonic/target-csharp"),
  forbidden("@tsonic/csharp-runtime"),
  forbidden("@tsonic/csharp-js"),
  forbidden("@tsonic/csharp-nodejs"),
]);

export const rustRootPolicies = Object.freeze([
  root("src/", ["src/index.ts"]),
  root("src/backend/", ["src/backend/rust-backend.ts"]),
  root("src/backend/planner/", [
    "src/backend/planner/context.ts",
    "src/backend/planner/diagnostics.ts",
    "src/backend/planner/option-default.ts",
  ]),
]);

export const rustAllowedImplementationIndexes = new Set([
  "src/public/index.ts",
]);

export const rustForbiddenDirectories = Object.freeze([
  "common",
  "helpers",
  "misc",
  "translate",
  "utils",
]);

function prefix(pathPrefix, layer) {
  return Object.freeze({
    layer,
    matches: (path) => path.startsWith(pathPrefix),
  });
}

function exact(paths, layer) {
  const values = new Set(paths);
  return Object.freeze({
    layer,
    matches: (path) => values.has(path),
  });
}

function policy(source, allowed, ruleId, reason) {
  return Object.freeze({ source, allowed: new Set(allowed), ruleId, reason });
}

function forbidden(prefixValue) {
  return Object.freeze({
    prefix: prefixValue,
    ruleId: "ARCH-TARGET-001",
    reason: `Rust target source cannot depend on sibling target package '${prefixValue}'.`,
  });
}

function root(prefixValue, allowed) {
  return Object.freeze({ prefix: prefixValue, allowed: new Set(allowed) });
}
