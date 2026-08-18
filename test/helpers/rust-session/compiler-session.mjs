import { collectImportActivatedTargetCapabilities, collectRuntimeActivatedTargetCapabilities } from "../../../../tsonic/packages/host/dist/target/capability-activation.js";
import { collectTargetSourceProfileContributions, createTargetSourceCompilerComposition, getTargetRequiredProviderModules } from "../../../../tsonic/packages/host/dist/index.js";
import { createRustTargetPack } from "../../../dist/index.js";
import { composeRustCapabilities } from "../../../dist/plugin/compose.js";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { materializeRustArtifacts } from "../../../dist/backend/emission/materialize.js";
import { planRustArtifacts } from "../../../dist/backend/planner/program/index.js";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createRustPlanningContext } from "../../../dist/backend/planner/context.js";
import { composeRustProviderSemantics } from "../../../dist/providers/packages/semantics.js";
import {
  createTargetSourceProgram,
  sourceProjectFiles,
} from "@tsonic/target-api/source";
import assert from "node:assert/strict";

export function createRustSession({ files, target = { id: "rust", options: {} }, packages = [], capabilities = [], surfaces = [], entryPoint = "index.ts" } = {}) {
  const pack = createRustTargetPack();
  target = surfaces.length === 0 || target.surfaces !== undefined
    ? target
    : { ...target, surfaces };
  const project = { entryPoint, targets: [target] };
  const paths = {
    projectFilePath: "/src/tsonic.json",
    projectRoot: "/src",
    outputRoot: "/src/out",
    targetOutputRoot: "/src/out/rust",
  };
  const activation = collectCapabilityActivation(files, [...packages, ...capabilities], target.id);
  const selectedSurfaces = (pack.surfaces ?? []).filter((surface) => surfaces.includes(surface.id));
  const composed = composeRustCapabilities("rust", activation.selected, selectedSurfaces.map((surface) => surface.id));
  packages = composed.capabilities;
  const providerContext = {
    project,
    projectDirectory: "/src",
    target,
    targetPack: pack,
    selectedSurfaces,
    selectedCapabilities: packages,
  };
  const runtimeContributionContext = {
    project,
    target,
    selectedSurfaces,
    selectedCapabilities: packages,
    paths,
  };
  const sourceProfile = collectTargetSourceProfileContributions({
    project,
    projectRoot: "/src",
    target,
    targetPack: pack,
    selectedCapabilities: packages,
    selectedSurfaces,
  });
  if (sourceProfile.diagnostics.length !== 0) {
    throw new Error(sourceProfile.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  const fileMap = new Map([
    ...Object.entries(files).map(([name, text]) => [`/src/${name}`, text]),
    ...sourceProfile.files.map((file) => [file.path, file.text]),
  ]);
  const composition = createTargetSourceCompilerComposition(providerContext);
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: fileMap,
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      noLib: true,
      strictNullChecks: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: composition.extensions,
      requiredProviderModules: getTargetRequiredProviderModules(pack, target, packages),
    },
  });
  return {
    session,
    pack,
    project,
    target,
    providerContext,
    runtimeContributionContext,
    paths,
    runtimeActivatedCapabilities: packages.filter((capability) => activation.runtimeIds.has(capability.id)),
  };
}

function collectCapabilityActivation(files, candidates, targetId) {
  if (candidates.length === 0) {
    return { selected: [], runtimeIds: new Set() };
  }
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: new Map(Object.entries(files).map(([name, text]) => [`/src/${name}`, text])),
    compilerOptions: { module: "esnext", moduleResolution: "bundler", noLib: true, target: "es2022" },
  });
  const source = session.checkSource();
  const projectSourceFiles = sourceProjectFiles(source);
  const target = { id: targetId, options: {} };
  const selected = collectImportActivatedTargetCapabilities(
    source.ast,
    projectSourceFiles,
    candidates,
    target,
  );
  const runtimeIds = new Set(collectRuntimeActivatedTargetCapabilities(
    source.ast,
    projectSourceFiles,
    selected,
  ).map((capability) => capability.id));
  return { selected, runtimeIds };
}

export function checkRustSession(harness, fileNames) {
  const diagnostics = rustSourceDiagnostics(harness, fileNames);
  if (diagnostics !== "") {
    throw new Error(`TypeScript diagnostics:\n${diagnostics}`);
  }
  return checkedRustSource(harness);
}

export function rustSourceDiagnostics(harness, fileNames) {
  void fileNames;
  const source = checkedRustSource(harness);
  const sourceDiagnostics = formatDiagnostics(source.diagnostics);
  const extensionDiagnostics = source.extensionDiagnostics
    .map((diagnostic) => `TSEXT${diagnostic.numericCode}: ${diagnostic.message}`)
    .join("\n");
  return [sourceDiagnostics, extensionDiagnostics]
    .filter((diagnostics) => diagnostics !== "")
    .join("\n");
}

function checkedRustSource(harness) {
  harness.checkedSource ??= harness.session.checkSource();
  return harness.checkedSource;
}

function createRustCompileInputFromSession({ source, project, target, runtimeReferences, paths }) {
  return {
    source: createTargetSourceProgram(source),
    project,
    target,
    runtimeReferences,
    paths,
  };
}

export function compileRust({ files, target = { id: "rust", options: {} }, packages = [], capabilities = [], surfaces = [], entryPoint = "index.ts" }) {
  const harness = createRustSession({ files, target, packages, capabilities, surfaces, entryPoint });
  const source = checkRustSession(harness);
  const extensionDiagnostics = source.extensionDiagnostics
    .filter((diagnostic) => diagnostic.category === "error")
    .map((diagnostic) => ({
      code: diagnostic.extensionCode,
      category: diagnostic.category,
      source: diagnostic.extensionId,
      message: diagnostic.message,
      evidence: (diagnostic.evidence ?? []).map((entry) => entry.message),
    }));
  if (extensionDiagnostics.length > 0) {
    const diagnostics = withBoundedDiagnosticInspection(extensionDiagnostics);
    return {
      result: { artifacts: [], diagnostics },
      source,
      harness,
    };
  }
  const runtimeReferences = runtimeReferencesForHarness(harness);
  const input = createRustCompileInputFromSession({
    source,
    project: harness.project,
    target,
    runtimeReferences,
    paths: harness.paths,
  });
  const jsEnabled = target.options?.typescriptCompatibility === "compat" ||
    harness.providerContext.selectedSurfaces.some((surface) => surface.id === "js");
  const analysis = analyzeRustTargetProgram(
    harness.providerContext,
    input,
    composeRustProviderSemantics(harness.providerContext),
    jsEnabled,
  );
  if (analysis.kind === "rejected") {
    const diagnostics = withBoundedDiagnosticInspection(analysis.diagnostics);
    return {
      result: { artifacts: [], diagnostics },
      source,
      harness,
    };
  }
  const translationContext = createRustPlanningContext(
    harness.providerContext,
    input,
    analysis.program,
  );
  const compiled = materializeRustArtifacts(planRustArtifacts(translationContext));
  const result = {
    ...compiled,
    diagnostics: withBoundedDiagnosticInspection(compiled.diagnostics),
  };
  return {
    result,
    source,
    translationContext,
    harness,
  };
}

export function compileRustThroughTargetPack({
  files,
  target = { id: "rust", options: {} },
  packages = [],
  capabilities = [],
  surfaces = [],
  entryPoint = "index.ts",
}) {
  const harness = createRustSession({ files, target, packages, capabilities, surfaces, entryPoint });
  const source = checkRustSession(harness);
  const input = createRustCompileInputFromSession({
    source,
    project: harness.project,
    target,
    runtimeReferences: runtimeReferencesForHarness(harness),
    paths: harness.paths,
  });
  const compiled = harness.pack.createBackend(harness.providerContext).compile(input);
  const result = {
    ...compiled,
    diagnostics: withBoundedDiagnosticInspection(compiled.diagnostics),
  };
  return { result, source, harness };
}

function runtimeReferencesForHarness(harness) {
  const contributionContext = harness.runtimeContributionContext;
  const capabilityReferences = harness.runtimeActivatedCapabilities.flatMap((providerPackage) =>
    providerPackage.runtimeContributions?.({
      ...contributionContext,
      targetPack: harness.pack,
      capability: providerPackage,
    }).references ?? []);
  return [
    ...(harness.pack.provider.runtimeContributions?.(contributionContext).references ?? []),
    ...harness.providerContext.selectedSurfaces.flatMap((surface) =>
      surface.runtimeContributions?.(contributionContext).references ?? []),
    ...capabilityReferences,
  ];
}

export function assertRustTargetRejection(options, expectedDiagnostics) {
  const compilation = compileRust(options);
  assert.equal(compilation.result.artifacts.length, 0);
  assert.deepEqual(
    compilation.result.diagnostics.map(({ code, message }) => ({ code, message })),
    expectedDiagnostics,
  );
  return compilation;
}

const diagnosticInspection = Symbol.for("nodejs.util.inspect.custom");

function withBoundedDiagnosticInspection(diagnostics) {
  const presented = diagnostics.map((diagnostic) => {
    if (diagnostic === null || typeof diagnostic !== "object") {
      return diagnostic;
    }
    const clone = { ...diagnostic };
    if (diagnostic !== null && typeof diagnostic === "object" &&
      Object.prototype.hasOwnProperty.call(diagnostic, "sourceNode")) {
      const sourceNode = diagnostic.sourceNode;
      Object.defineProperty(clone, "sourceNode", {
        configurable: true,
        enumerable: false,
        value: sourceNode,
      });
    }
    return clone;
  });
  Object.defineProperty(presented, diagnosticInspection, {
    configurable: true,
    enumerable: false,
    value() {
      return presented.map((diagnostic) => ({
        code: boundedDiagnosticText(diagnostic.code),
        category: boundedDiagnosticText(diagnostic.category),
        source: boundedDiagnosticText(diagnostic.source),
        message: boundedDiagnosticText(diagnostic.message),
        ...(diagnostic.sourceSpan === undefined ? {} : { sourceSpan: diagnostic.sourceSpan }),
        evidence: Array.isArray(diagnostic.evidence)
          ? diagnostic.evidence.slice(0, 32).map((entry) =>
              boundedDiagnosticText(typeof entry === "string" ? entry : entry?.message))
          : [],
      }));
    },
  });
  return presented;
}

function boundedDiagnosticText(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.length <= 2_000 ? value : `${value.slice(0, 2_000)}…`;
}

export function artifactText(result, path) {
  const artifact = result.artifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) {
    throw new Error(`Missing artifact '${path}'. Present: ${result.artifacts.map((a) => a.path).join(", ")}`);
  }
  return artifact.text;
}
