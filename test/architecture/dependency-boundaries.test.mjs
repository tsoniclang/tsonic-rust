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
} from "./layer-policy.mjs";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);

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
        "planRustArtifacts",
        "printRustSourceFile",
      ]],
      ["src/public/provider.ts", [
        "RustPlanningContext",
        "RustTargetProgram",
        "createRustCompilerWorkerClient",
        "rustTargetOperationFactKey",
        "planRustArtifacts",
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
