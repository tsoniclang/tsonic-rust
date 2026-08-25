import assert from "node:assert/strict";
import {
  collectImportActivatedTargetCapabilities,
  collectRuntimeActivatedTargetCapabilities,
} from "../../../../tsonic/packages/host/dist/target/capability-activation.js";
import {
  captureTargetCapabilityContributions,
  createTargetSourceCompilerComposition,
  getTargetRequiredProviderModules,
  selectInstalledTargetCapabilities,
  selectTargetSurfaceImplementations,
} from "../../../../tsonic/packages/host/dist/target/extensions.js";
import { collectTargetRuntimeContributions } from "../../../../tsonic/packages/host/dist/target/runtime-contributions.js";
import { collectTargetSourceProfileContributions } from "../../../../tsonic/packages/host/dist/target/source-profile.js";
import { collectTargetSourcePackageGraph } from "../../../../tsonic/packages/host/dist/source-package-inputs.js";
import {
  createCompilerSessionFromFiles,
  formatDiagnostics,
} from "@tsonic/tsts";
import {
  createTargetSourceProgram,
  sourceProjectFiles,
} from "@tsonic/target-api/source";
import { createRustTargetPack } from "../../../dist/index.js";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import {
  createRustTargetConfigurationInput,
  sealRustTargetConfiguration,
} from "../../../dist/options/rust-target-options.js";
import { composeRustProviderSemantics } from "../../../dist/providers/packages/semantics.js";

export function createRustSession({
  files,
  target = { id: "rust", options: {} },
  packages = [],
  capabilities = [],
  surfaces = [],
  entryPoint = "index.ts",
  sourcePackages,
  compilerOptions = {},
} = {}) {
  const pack = createRustTargetPack();
  target = surfaces.length === 0 || target.surfaces !== undefined
    ? target
    : { ...target, surfaces };
  const project = { entryPoint, targets: [target] };
  const paths = Object.freeze({
    projectFilePath: "/src/tsonic.json",
    projectRoot: "/src",
    outputRoot: "/src/out",
    targetOutputRoot: "/src/out/rust",
  });
  const candidates = [...packages, ...capabilities];
  const activation = collectCapabilityActivation(files, candidates, target);
  const surfaceSelection = selectTargetSurfaceImplementations(pack, target);
  if ("error" in surfaceSelection) {
    throw new Error(surfaceSelection.error);
  }
  const capabilitySelection = selectInstalledTargetCapabilities(
    target,
    activation.selected,
    surfaceSelection.selectedSurfaces,
  );
  if ("error" in capabilitySelection) {
    throw new Error(capabilitySelection.error);
  }
  const selectedSurfaces = surfaceSelection.selectedSurfaces;
  const selectedCapabilities = capabilitySelection.selectedCapabilities;
  const capturedCapabilities = captureTargetCapabilityContributions({
    project,
    projectDirectory: "/src",
    target,
    selectedCapabilities,
    selectedSurfaces,
  });
  const targetSession = pack.createCompilationSession(Object.freeze({
    project,
    projectDirectory: "/src",
    target,
    paths,
    selectedSurfaceIds: Object.freeze(selectedSurfaces.map((surface) => surface.id)),
    capabilities: capturedCapabilities,
  }));
  const sourceProfile = collectTargetSourceProfileContributions({
    project,
    projectRoot: "/src",
    projectDirectory: "/src",
    target,
    targetPackId: pack.id,
    selectedCapabilities,
    selectedSurfaces,
    targetContributions: targetSession.sourceProfileContributions(),
  });
  if (sourceProfile.diagnostics.length !== 0) {
    targetSession.close();
    throw new Error(sourceProfile.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  const projectFiles = new Map(
    Object.entries(files).map(([name, text]) => [`/src/${name}`, text]),
  );
  sourcePackages ??= withFixtureEntryExport(
    collectTargetSourcePackageGraph("/src", "/src", projectFiles),
    projectFiles,
    entryPoint,
  );
  const fileMap = new Map([
    ...projectFiles,
    ...sourceProfile.files.map((file) => [file.path, file.text]),
  ]);
  const composition = createTargetSourceCompilerComposition({
    project,
    projectDirectory: "/src",
    target,
    targetPack: pack,
    selectedCapabilities,
    selectedSurfaces,
    targetContributions: targetSession.sourceCompilerContributions(),
  });
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: fileMap,
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      noLib: true,
      strictNullChecks: true,
      target: "es2022",
      ...compilerOptions,
    },
    extensionHostOptions: {
      extensions: composition.extensions,
      requiredProviderModules: getTargetRequiredProviderModules(
        target,
        pack.provider,
        selectedCapabilities,
      ),
    },
  });
  return {
    session,
    targetSession,
    pack,
    project,
    target,
    selectedSurfaces,
    selectedCapabilities,
    capturedCapabilities,
    paths,
    sourcePackages,
    runtimeActivatedCapabilities: selectedCapabilities.filter((capability) =>
      activation.runtimeIds.has(capability.id)),
  };
}

function withFixtureEntryExport(sourcePackages, projectFiles, entryPoint) {
  const entryFile = entryPoint.startsWith("/")
    ? entryPoint
    : `/src/${entryPoint.replace(/^\.\//u, "")}`;
  if (!projectFiles.has(entryFile)) {
    return sourcePackages;
  }
  const packages = sourcePackages.packages.map((sourcePackage) =>
    sourcePackage.id !== sourcePackages.rootPackageId
      ? sourcePackage
      : Object.freeze({
          ...sourcePackage,
          exports: Object.freeze([{
            specifier: ".",
            sourceFile: entryFile,
          }]),
        }));
  return Object.freeze({
    ...sourcePackages,
    fingerprint: `${sourcePackages.fingerprint}:fixture-entry:${entryFile}`,
    packages: Object.freeze(packages),
  });
}

function collectCapabilityActivation(files, candidates, target) {
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
  const diagnostics = rustSourceDiagnosticsText(harness, fileNames);
  if (diagnostics !== "") {
    harness.targetSession.close();
    throw new Error(`TypeScript diagnostics:\n${diagnostics}`);
  }
  const source = checkedRustSource(harness);
  harness.targetSession.close();
  return source;
}

export function rustSourceDiagnostics(harness, fileNames) {
  try {
    return rustSourceDiagnosticsText(harness, fileNames);
  } finally {
    harness.targetSession.close();
  }
}

function rustSourceDiagnosticsText(harness, fileNames) {
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

function createRustCompileInputFromSession({
  source,
  sourcePackages,
  project,
  target,
  runtimeReferences,
  paths,
}) {
  return {
    source: createTargetSourceProgram(source),
    sourcePackages,
    project,
    target,
    runtimeReferences,
    paths,
  };
}

export function compileRust(options) {
  const harness = createRustSession(options);
  const sourceDiagnostics = rustSourceDiagnosticsText(harness);
  if (sourceDiagnostics !== "") {
    harness.targetSession.close();
    throw new Error(`TypeScript diagnostics:\n${sourceDiagnostics}`);
  }
  const source = checkedRustSource(harness);
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
    harness.targetSession.close();
    return {
      result: {
        artifacts: [],
        diagnostics: withBoundedDiagnosticInspection(extensionDiagnostics),
      },
      source,
      harness,
    };
  }
  const runtime = runtimeContributionsForHarness(harness);
  if (runtime.diagnostics.length !== 0) {
    harness.targetSession.close();
    return {
      result: {
        artifacts: [],
        diagnostics: withBoundedDiagnosticInspection(runtime.diagnostics),
      },
      source,
      harness,
    };
  }
  const input = createRustCompileInputFromSession({
    source,
    sourcePackages: harness.sourcePackages,
    project: harness.project,
    target: harness.target,
    runtimeReferences: runtime.references,
    paths: harness.paths,
  });
  let compiled;
  try {
    compiled = harness.targetSession.compile(input);
  } finally {
    harness.targetSession.close();
  }
  const result = {
    artifacts: compiled.kind === "resolved" ? compiled.value.artifacts : [],
    diagnostics: withBoundedDiagnosticInspection(compiled.diagnostics),
  };
  return {
    result,
    source,
    harness,
  };
}

export function analyzeRust(options) {
  const harness = createRustSession(options);
  try {
    const sourceDiagnostics = rustSourceDiagnosticsText(harness);
    if (sourceDiagnostics !== "") {
      throw new Error(`TypeScript diagnostics:\n${sourceDiagnostics}`);
    }
    const source = checkedRustSource(harness);
    const runtime = runtimeContributionsForHarness(harness);
    if (runtime.diagnostics.length !== 0) {
      throw new Error(runtime.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    const input = createRustCompileInputFromSession({
      source,
      sourcePackages: harness.sourcePackages,
      project: harness.project,
      target: harness.target,
      runtimeReferences: runtime.references,
      paths: harness.paths,
    });
    const configurationInput = createRustTargetConfigurationInput(
      harness.target,
      "/src",
      harness.paths.targetOutputRoot,
    );
    const configuration = sealRustTargetConfiguration(configurationInput, Object.freeze({
      edition: configurationInput.edition,
      compilerIdentity: "rust-session-test-harness",
      enabledLanguageFeatures: Object.freeze([]),
    }));
    const analysis = analyzeRustTargetProgram(Object.freeze({
      input,
      configuration,
      providerSemantics: composeRustProviderSemantics(harness.capturedCapabilities),
      jsEnabled: harness.selectedSurfaces.some((surface) => surface.id === "js"),
      rootPublishesLibrary: configuration.outputType === "lib",
    }));
    if (analysis.kind === "rejected") {
      throw new Error(analysis.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    return Object.freeze({ source, program: analysis.value });
  } finally {
    harness.targetSession.close();
  }
}

export function compileRustThroughTargetPack(options) {
  return compileRust(options);
}

function runtimeContributionsForHarness(harness) {
  return collectTargetRuntimeContributions({
    project: harness.project,
    projectDirectory: "/src",
    target: harness.target,
    targetPackId: harness.pack.id,
    selectedCapabilities: harness.selectedCapabilities,
    runtimeActivatedCapabilities: harness.runtimeActivatedCapabilities,
    selectedSurfaces: harness.selectedSurfaces,
    paths: harness.paths,
    targetContributions: harness.targetSession.runtimeContributions(),
  });
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
    if (Object.prototype.hasOwnProperty.call(diagnostic, "sourceNode")) {
      Object.defineProperty(clone, "sourceNode", {
        configurable: true,
        enumerable: false,
        value: diagnostic.sourceNode,
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
    throw new Error(`Missing artifact '${path}'. Present: ${result.artifacts.map((artifact) => artifact.path).join(", ")}`);
  }
  return artifact.text;
}
