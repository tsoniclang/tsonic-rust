import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  evaluateArchitecture,
  evaluateBarrelModules,
  formatArchitectureFindings,
} from "../../../tsonic/test/architecture/tooling/architecture-rules.mjs";
import { collectFiles, readSourceInventory } from "../../../tsonic/test/architecture/tooling/file-inventory.mjs";
import { classifyFiles } from "../../../tsonic/test/architecture/tooling/layer-classification.mjs";
import { buildTypeScriptModuleAnalysis } from "../../../tsonic/test/architecture/tooling/module-graph.mjs";
import { evaluateTestDomainOwnership } from "../../../tsonic/test/architecture/tooling/test-inventory.mjs";
import { evaluatePublicExportInventory } from "../../../tsonic/test/architecture/tooling/public-export-inventory.mjs";
import {
  rustAllowedImplementationIndexes,
  rustForbiddenDirectories,
  rustForbiddenPackages,
  rustLayerPolicies,
  rustLayerRules,
  rustRootPolicies,
  rustSourceRules,
} from "./layer-policy.mjs";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);

test("Rust architecture rules reject target-specific boundary mutations", () => {
  const mutations = [
    ["ARCH-RUST-CONFIG-001", "src/backend/planner/project.ts", "configuration.projectFile"],
    ["ARCH-RUST-PRINTER-001", "src/print/source/index.ts", "finalizeRustSourceStyle(model);"],
    ["ARCH-RUST-PLAN-001", "src/backend/artifact-model/output.ts", "readonly diagnostics: readonly string[];"],
    ["ARCH-RUST-PROGRAM-001", "src/analysis/program/model.ts", "readonly values: Set<string>;"],
    ["ARCH-RUST-PROVIDER-001", "src/providers/packages/model.ts", "interface RustProviderSemantics { readonly carrierPaths: ReadonlyMap<string, string>; }"],
    ["ARCH-RUST-PROVIDER-002", "src/providers/packages/materialization.ts", "type Carriers = Readonly<Record<string, string>> | ReadonlyMap<string, string>;"],
    ["ARCH-RUST-SELECTION-001", "src/analysis/operations/call.ts", "semantics.types.callSignatures(type);"],
    ["ARCH-TARGET-PLANNER-002", "src/backend/planner/call.ts", "selectRustTargetCall(node);"],
    ["ARCH-TARGET-ANALYSIS-002", "src/analysis/calls.ts", 'import { planCall } from "../backend/planner/call.js";'],
    ["ARCH-TARGET-MODEL-001", "src/target-model/types.ts", 'import { analyzeType } from "../analysis/types.js";'],
    ["ARCH-TARGET-PRINTER-002", "src/print/source.ts", 'import { selectType } from "../policy/types.js";'],
  ];
  for (const [ruleId, file, source] of mutations) {
    assert.equal(
      rustSourceRules.some((rule) => rule.ruleId === ruleId && rule.matches(file, source)),
      true,
      `${ruleId} did not reject its mutation`,
    );
  }
});

test("Rust product imports conform to the declared architecture", () => {
  const sourceFiles = readSourceInventory(repositoryRoot, {
    extensions: [".ts"],
    exclude: ["dist", "node_modules", "test", ".temp", ".analysis"],
  });
  const classification = classifyFiles(sourceFiles.keys(), rustLayerRules);
  const moduleAnalysis = buildTypeScriptModuleAnalysis(sourceFiles);
  const architecture = evaluateArchitecture({
    sourceFiles,
    edges: moduleAnalysis.edges,
    classifications: classification.classifications,
    layerPolicies: rustLayerPolicies,
    forbiddenPackages: rustForbiddenPackages,
    forbiddenDirectories: rustForbiddenDirectories,
    rootPolicies: rustRootPolicies,
    sourceRules: rustSourceRules,
  });
  const barrelFindings = evaluateBarrelModules(moduleAnalysis.modules, {
    allowedImplementationFiles: rustAllowedImplementationIndexes,
  });
  const findings = [
    ...classification.findings,
    ...architecture.findings,
    ...barrelFindings,
  ];
  assert.deepEqual(findings, [], formatArchitectureFindings(findings));
});

test("Rust package exposes only approved audience entrypoints", async () => {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
  assert.deepEqual(
    Object.keys(manifest.exports).sort(),
    [".", "./package.json", "./provider"],
  );
  const root = await import(new URL("../../dist/index.js", import.meta.url));
  assert.deepEqual(
    Object.keys(root).sort(),
    ["createRustTargetPack", "createTsonicPlugin", "rustTargetId"],
  );
  const findings = evaluatePublicExportInventory({
    manifest,
    expectedEntrypoints: [".", "./package.json", "./provider"],
    sourceTextByEntrypoint: new Map([
      ["src/public/index.ts", readFileSync(resolve(repositoryRoot, "src/public/index.ts"), "utf8")],
      ["src/public/provider.ts", readFileSync(resolve(repositoryRoot, "src/public/provider.ts"), "utf8")],
    ]),
    forbiddenNamesByEntrypoint: new Map([
      ["src/public/index.ts", [
        "RustPlanningContext",
        "RustTargetProgram",
        "planRustOutput",
        "printRustSourceFile",
      ]],
      ["src/public/provider.ts", [
        "RustPlanningContext",
        "RustTargetProgram",
        "createRustCompilerWorkerClient",
        "rustTargetOperationFactKey",
        "planRustOutput",
        "printRustSourceFile",
      ]],
    ]),
  });
  assert.deepEqual(findings, [], formatArchitectureFindings(findings));
});

test("Rust tests mirror explicit architecture domains", () => {
  const domains = [
    "analysis",
    "architecture",
    "backend",
    "integration",
    "policy",
    "providers",
    "source",
    "target-model",
    "toolchain",
  ];
  const files = collectFiles(resolve(repositoryRoot, "test"), {
    extensions: [".test.mjs"],
  }).map((file) => `test/${file}`);
  const findings = evaluateTestDomainOwnership(
    files,
    domains.map((domain) => ({
      directory: `test/${domain}`,
      productDomain: domain,
    })),
    new Set(domains),
  );
  assert.deepEqual(findings, [], formatArchitectureFindings(findings));
});

test("Rust runtime-reference construction has one owner and explicit core/surface ownership", () => {
  const helper = readFileSync(
    resolve(repositoryRoot, "src/compilation/runtime-references.ts"),
    "utf8",
  );
  const session = readFileSync(
    resolve(repositoryRoot, "src/compilation/session.ts"),
    "utf8",
  );
  const composition = readFileSync(
    resolve(repositoryRoot, "src/compilation/composition.ts"),
    "utf8",
  );

  assert.match(helper, /export function rustRuntimeCrateReference/u);
  assert.doesNotMatch(session, /function rustRuntimeCrateReference/u);
  assert.doesNotMatch(composition, /function rustRuntimeCrateReference/u);
  assert.match(session, /"@tsonic\/rust-runtime"/u);
  assert.doesNotMatch(session, /"@tsonic\/rust-js"/u);
  assert.match(composition, /"@tsonic\/rust-js"/u);
  assert.doesNotMatch(composition, /"@tsonic\/rust-runtime"/u);
});
