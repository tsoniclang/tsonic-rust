// End-to-end test harness: compiles in-memory TypeScript through TSTS with
// the Rust target extensions, then plans Rust artifacts via the backend.
// Uses only public @tsonic packages — no @tsonic/host.
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  createCompilerSessionFromFiles,
  createExtensionConsumerQueries,
  formatDiagnostics,
  runtimeCarrierFactKey,
} from "@tsonic/tsts";
import { createTsonicCoreSourceExtension } from "@tsonic/source-core";
import {
  normalizeTargetSourceProfileSegment,
  tsonicSourceProfileVirtualDirectory,
} from "@tsonic/target-api";
import {
  createRustBackend,
  createRustProviderPackage,
  composeRustCapabilities,
  createRustTargetPack,
} from "../../dist/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "../..");
export const repositoryRoot = resolve(testDirectory, "../..");
export const fixtureCratesRoot = resolve(repositoryRoot, "test/fixtures/crates");
export const rustRuntimeCratePath = resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime");

export const stringCarrier = { kind: "target-named", id: "rust.std.String" };
export const unitCarrier = { kind: "tuple", elements: [] };
export const int32Carrier = { kind: "source-primitive", name: "int32" };
export const boolCarrier = { kind: "source-primitive", name: "bool" };
export const storeCarrier = { kind: "target-named", id: "acme.platform.Store" };

export function acmeFilesPackage() {
  return createRustProviderPackage({
    id: "acme-files",
    displayName: "Acme files",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/files",
      providerModuleId: "acme.files",
      exports: [{
        id: "@acme/files::readText",
        name: "readText",
        kind: "function",
        signatures: [{
          id: "@acme/files::readText(path)",
          name: "readText",
          parameters: [{ name: "path", type: { kind: "string" } }],
          returnType: { kind: "string" },
        }],
      }],
    }],
    operations: [{
      exportId: "@acme/files::readText",
      operationKind: "method",
      target: { form: "call", path: "acme_files::read_text" },
      resultCarrier: stringCarrier,
      parameterCarriers: [stringCarrier],
    }],
    crates: [{ crateName: "acme_files", cargoPath: resolve(fixtureCratesRoot, "acme_files") }],
  });
}

export function acmeTestingPackage() {
  return createRustProviderPackage({
    id: "acme-testing",
    displayName: "Acme testing",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/testing",
      providerModuleId: "acme.testing",
      exports: [{
        id: "@acme/testing::check",
        name: "check",
        kind: "function",
        signatures: [{
          id: "@acme/testing::check(condition)",
          name: "check",
          parameters: [{ name: "condition", type: { kind: "boolean" } }],
          returnType: { kind: "void" },
        }],
      }],
    }],
    operations: [{
      exportId: "@acme/testing::check",
      operationKind: "method",
      target: { form: "call", path: "acme_testing::check" },
      resultCarrier: unitCarrier,
      parameterCarriers: [boolCarrier],
    }],
    crates: [{ crateName: "acme_testing", cargoPath: resolve(fixtureCratesRoot, "acme_testing") }],
  });
}

export function acmePlatformPackage({ includeHomeDir = true } = {}) {
  return createRustProviderPackage({
    id: "acme-platform",
    displayName: "Acme platform",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/platform",
      providerModuleId: "acme.platform",
      exports: [
        {
          id: "@acme/platform::Env",
          name: "Env",
          kind: "class",
          members: [
            { id: "@acme/platform::Env.homeDir", name: "homeDir", kind: "property", static: true, readonly: true, type: { kind: "string" } },
          ],
        },
        {
          id: "@acme/platform::Store",
          name: "Store",
          kind: "class",
          targetIdentity: { target: "rust", id: "acme.platform.Store" },
          members: [
            {
              id: "@acme/platform::Store.constructor",
              name: "constructor",
              kind: "constructor",
              signatures: [{ id: "@acme/platform::Store.constructor(seed)", parameters: [{ name: "seed", type: { kind: "string" } }] }],
            },
            { id: "@acme/platform::Store.count", name: "count", kind: "property", type: { kind: "source-primitive", name: "int32" } },
            {
              id: "@acme/platform::Store.indexer",
              name: "indexer",
              kind: "indexer",
              signatures: [{
                id: "@acme/platform::Store.indexer(index)",
                parameters: [{ name: "index", type: { kind: "source-primitive", name: "int32" } }],
                returnType: { kind: "source-primitive", name: "int32" },
              }],
            },
          ],
        },
      ],
    }],
    operations: [
      {
        exportId: "@acme/platform::Env",
        memberId: "@acme/platform::Env.homeDir",
        operationKind: "property",
        target: { form: "call", path: "acme_platform::env_home_dir" },
        resultCarrier: stringCarrier,
      },
      {
        exportId: "@acme/platform::Store",
        memberId: "@acme/platform::Store.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "acme_platform::Store::new" },
        resultCarrier: storeCarrier,
        parameterCarriers: [stringCarrier],
      },
      {
        exportId: "@acme/platform::Store",
        memberId: "@acme/platform::Store.count",
        operationKind: "property",
        target: { form: "field", name: "count" },
        resultCarrier: int32Carrier,
      },
      {
        exportId: "@acme/platform::Store",
        memberId: "@acme/platform::Store.indexer",
        operationKind: "indexer",
        target: { form: "method", name: "get" },
        resultCarrier: int32Carrier,
        parameterCarriers: [int32Carrier],
      },
    ].filter((row) => includeHomeDir || row.memberId !== "@acme/platform::Env.homeDir"),
    carrierPaths: { "acme.platform.Store": "acme_platform::Store" },
    crates: [{ crateName: "acme_platform", cargoPath: resolve(fixtureCratesRoot, "acme_platform") }],
  });
}

export function createRustSession({ files, target = { id: "rust", options: {} }, packages = [], capabilities = [], surfaces = [], entryPoint = "index.ts" } = {}) {
  const pack = createRustTargetPack();
  const project = { entryPoint, targets: [target] };
  const paths = {
    projectFilePath: "tsonic.json",
    projectRoot: ".",
    outputRoot: "out",
    targetOutputRoot: "out/rust",
  };
  const activation = collectCapabilityActivation(files, [...packages, ...capabilities], target.id);
  const selectedSurfaces = (pack.surfaces ?? []).filter((surface) => surfaces.includes(surface.id));
  const composed = composeRustCapabilities("rust", activation.selected, selectedSurfaces.map((surface) => surface.id));
  packages = composed.capabilities;
  const providerContext = {
    project,
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
  const fileMap = new Map(Object.entries(files).map(([name, text]) => [`/src/${name}`, text]));
  const appendSourceProfile = (ownerId, contributions) => {
    const ownerSegment = normalizeTargetSourceProfileSegment(ownerId);
    for (const declaration of contributions?.declarations ?? []) {
      fileMap.set(
        `/src/${tsonicSourceProfileVirtualDirectory}/${ownerSegment}/${declaration.fileName}`,
        declaration.text,
      );
    }
  };
  appendSourceProfile(pack.provider.id, pack.provider.sourceProfileContributions?.(providerContext));
  for (const surface of selectedSurfaces) {
    appendSourceProfile(surface.id, surface.sourceProfileContributions?.({ ...providerContext, surface }));
  }
  for (const capability of packages) {
    appendSourceProfile(capability.id, capability.sourceProfileContributions?.({ ...providerContext, capability }));
  }
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
      activeTarget: "rust",
      extensions: [
        createTsonicCoreSourceExtension(),
        ...pack.provider.createExtensions(providerContext),
        ...packages.flatMap((providerPackage) =>
          providerPackage.createExtensions?.({ ...providerContext, package: providerPackage }) ?? []),
      ],
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
  const staticSpecifiers = new Set();
  const valueSpecifiers = new Set();
  for (const sourceFile of session.getSourceFiles()) {
    if (sourceFile === undefined || !session.ast.getFileName(sourceFile).startsWith("/src/")) {
      continue;
    }
    for (const statement of session.ast.statements(sourceFile)) {
      const specifier = staticModuleSpecifier(session.ast, statement);
      if (specifier === undefined) {
        continue;
      }
      staticSpecifiers.add(specifier);
      if (!isTypeOnlyModuleDeclaration(session.ast, statement)) {
        valueSpecifiers.add(specifier);
      }
    }
  }
  const selected = candidates.filter((capability) => capability.targetId === targetId &&
    capability.moduleOwnership.some((ownership) =>
      [...staticSpecifiers].some((specifier) => moduleSpecifierMatchesOwnership(specifier, ownership.specifierPrefix))));
  const runtimeIds = new Set(selected.filter((capability) =>
    capability.moduleOwnership.some((ownership) =>
      [...valueSpecifiers].some((specifier) => moduleSpecifierMatchesOwnership(specifier, ownership.specifierPrefix))))
    .map((capability) => capability.id));
  return { selected, runtimeIds };
}

function staticModuleSpecifier(ast, statement) {
  const declaration = ast.is.IsImportDeclaration(statement)
    ? ast.as.AsImportDeclaration(statement)
    : ast.is.IsExportDeclaration(statement) ? ast.as.AsExportDeclaration(statement) : undefined;
  const moduleSpecifier = declaration?.ModuleSpecifier;
  if (moduleSpecifier === undefined) {
    return undefined;
  }
  const text = ast.text(moduleSpecifier);
  return text.length === 0 ? undefined : text;
}

function isTypeOnlyModuleDeclaration(ast, declaration) {
  if (ast.isTypeOnlyImportOrExportDeclaration(declaration)) {
    return true;
  }
  const importClause = ast.as.AsImportDeclaration(declaration)?.ImportClause;
  const namedBindings = importClause === undefined ? undefined : ast.as.AsImportClause(importClause)?.NamedBindings;
  return namedBindings !== undefined && ast.is.IsNamedImports(namedBindings) && ast.elements(namedBindings).length > 0 &&
    ast.elements(namedBindings).every((element) => element !== undefined && ast.as.AsImportSpecifier(element)?.IsTypeOnly === true);
}

function moduleSpecifierMatchesOwnership(specifier, prefix) {
  return specifier === prefix || specifier.startsWith(`${prefix}/`) ||
    (/[:/]$/.test(prefix) && specifier.startsWith(prefix));
}

export function checkRustSession(harness, fileNames) {
  const diagnostics = rustSourceDiagnostics(harness, fileNames);
  if (diagnostics !== "") {
    throw new Error(`TypeScript diagnostics:\n${diagnostics}`);
  }
  return harness.session.finalizeExtensions();
}

export function rustSourceDiagnostics(harness, fileNames) {
  const { session } = harness;
  const checked = fileNames ?? [...session.getSourceFiles()]
    .filter((sourceFile) => sourceFile !== undefined)
    .map((sourceFile) => session.ast.getFileName(sourceFile))
    .filter((fileName) => fileName.startsWith("/src/"));
  return checked
    .map((fileName) => formatDiagnostics(session.ensureChecked(session.getSourceFile(fileName))))
    .filter((diagnostics) => diagnostics !== "")
    .join("\n");
}

function createRustCompileInputFromSession({ session, extensionHost, project, target, runtimeReferences, paths }) {
  const sourceFiles = session.getSourceFiles().filter((sourceFile) =>
    sourceFile !== undefined && !session.ast.getFileName(sourceFile).endsWith(".d.ts"));
  const facts = createExtensionConsumerQueries(extensionHost, "tsonic-rust-test-backend");
  const resolveRuntimeCarrier = (subject) => {
    if (subject === undefined) {
      return { kind: "missing", reason: "No subject provided for carrier resolution.", evidence: [] };
    }
    const fact = extensionHost.facts.get(subject, runtimeCarrierFactKey) ??
      extensionHost.factResolver.resolve(subject, runtimeCarrierFactKey);
    return fact === undefined
      ? { kind: "missing", reason: "No finalized Rust runtime carrier fact.", evidence: [] }
      : { kind: "resolved", carrier: fact.carrier, evidence: [] };
  };
  return {
    program: session.program,
    ast: session.ast,
    types: session.types,
    sourceFiles,
    facts,
    analysis: {
      getEnumMemberConstant(node) {
        if (node === undefined) {
          return undefined;
        }
        const value = session.checker.getConstantValue(node);
        return typeof value === "number" || typeof value === "string" ? { value } : undefined;
      },
    },
    targetFacts: {
      resolveRuntimeCarrier,
      resolveRuntimeCarrierForNode: resolveRuntimeCarrier,
      resolveCallReturnRuntimeCarrier: resolveRuntimeCarrier,
      resolveDeclarationReturnCarrier: resolveRuntimeCarrier,
    },
    project,
    target,
    runtimeReferences,
    paths,
  };
}

export function compileRust({ files, target = { id: "rust", options: {} }, packages = [], capabilities = [], surfaces = [], entryPoint = "index.ts" }) {
  const harness = createRustSession({ files, target, packages, capabilities, surfaces, entryPoint });
  const extensionHost = checkRustSession(harness);
  const extensionDiagnostics = extensionHost.diagnostics.all()
    .filter((diagnostic) => diagnostic.category === "error")
    .map((diagnostic) => ({
      code: diagnostic.extensionCode,
      category: diagnostic.category,
      source: diagnostic.extensionId,
      message: diagnostic.message,
      evidence: (diagnostic.evidence ?? []).map((entry) => entry.message),
    }));
  if (extensionDiagnostics.length > 0) {
    return {
      result: { artifacts: [], diagnostics: extensionDiagnostics },
      extensionHost,
      harness,
    };
  }
  const contributionContext = harness.runtimeContributionContext;
  const capabilityReferences = harness.runtimeActivatedCapabilities.flatMap((providerPackage) =>
    providerPackage.runtimeContributions?.({
      ...contributionContext,
      targetPack: harness.pack,
      capability: providerPackage,
    }).references ?? []);
  const runtimeReferences = [
    ...(harness.pack.provider.runtimeContributions?.(contributionContext).references ?? []),
    ...harness.providerContext.selectedSurfaces.flatMap((surface) =>
      surface.runtimeContributions?.(contributionContext).references ?? []),
    ...capabilityReferences,
  ];
  const input = createRustCompileInputFromSession({
    session: harness.session,
    extensionHost,
    project: harness.project,
    target,
    runtimeReferences,
    paths: harness.paths,
  });
  const backend = createRustBackend({ project: harness.project, target });
  return { result: backend.compile(input), extensionHost, harness };
}

export function artifactText(result, path) {
  const artifact = result.artifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) {
    throw new Error(`Missing artifact '${path}'. Present: ${result.artifacts.map((a) => a.path).join(", ")}`);
  }
  return artifact.text;
}

export const vectorCarrier = { kind: "target-named", id: "acme.vectors.Vector" };

export function acmeVectorsPackage() {
  return createRustProviderPackage({
    id: "acme-vectors",
    displayName: "Acme vectors",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/vectors",
      providerModuleId: "acme.vectors",
      exports: [
        {
          id: "@acme/vectors::magnitude",
          name: "magnitude",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::magnitude(v)",
            name: "magnitude",
            parameters: [{ name: "v", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } }],
            returnType: { kind: "source-primitive", name: "int32" },
          }],
        },
        {
          id: "@acme/vectors::consume",
          name: "consume",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::consume(v)",
            name: "consume",
            parameters: [{ name: "v", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } }],
            returnType: { kind: "source-primitive", name: "int32" },
          }],
        },
        {
          id: "@acme/vectors::scale",
          name: "scale",
          kind: "function",
          signatures: [{
            id: "@acme/vectors::scale(v,factor)",
            name: "scale",
            parameters: [
              { name: "v", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
              { name: "factor", type: { kind: "source-primitive", name: "int32" } },
            ],
            returnType: { kind: "void" },
          }],
        },
        {
          id: "@acme/vectors::Vector",
          name: "Vector",
          kind: "class",
          targetIdentity: { target: "rust", id: "acme.vectors.Vector" },
          members: [
            {
              id: "@acme/vectors::Vector.constructor",
              name: "constructor",
              kind: "constructor",
              signatures: [{
                id: "@acme/vectors::Vector.constructor(x,y)",
                parameters: [
                  { name: "x", type: { kind: "source-primitive", name: "int32" } },
                  { name: "y", type: { kind: "source-primitive", name: "int32" } },
                ],
              }],
            },
            { id: "@acme/vectors::Vector.x", name: "x", kind: "property", readonly: true, type: { kind: "source-primitive", name: "int32" } },
            { id: "@acme/vectors::Vector.y", name: "y", kind: "property", readonly: true, type: { kind: "source-primitive", name: "int32" } },
            {
              id: "@acme/vectors::Vector.add",
              name: "add",
              kind: "method",
              static: true,
              signatures: [{
                id: "@acme/vectors::Vector.add(a,b)",
                parameters: [
                  { name: "a", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
                  { name: "b", type: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" } },
                ],
                returnType: { kind: "provider-ref", moduleSpecifier: "@acme/vectors", exportName: "Vector" },
              }],
            },
          ],
        },
      ],
    }],
    operations: [
      {
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "acme_vectors::Vector::new" },
        resultCarrier: vectorCarrier,
        parameterCarriers: [int32Carrier, int32Carrier],
      },
      {
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.x",
        operationKind: "property",
        target: { form: "field", name: "x" },
        resultCarrier: int32Carrier,
      },
      {
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.y",
        operationKind: "property",
        target: { form: "field", name: "y" },
        resultCarrier: int32Carrier,
      },
      {
        exportId: "@acme/vectors::magnitude",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::magnitude", argModes: ["ref"] },
        resultCarrier: int32Carrier,
        parameterCarriers: [vectorCarrier],
      },
      {
        exportId: "@acme/vectors::scale",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::scale", argModes: ["mut-ref", "value"] },
        resultCarrier: unitCarrier,
        parameterCarriers: [vectorCarrier, int32Carrier],
      },
      {
        exportId: "@acme/vectors::consume",
        operationKind: "method",
        target: { form: "call", path: "acme_vectors::consume", argModes: ["value"] },
        resultCarrier: int32Carrier,
        parameterCarriers: [vectorCarrier],
      },
      {
        // Source call Vector.add(a, b) lowers to the native `+` operator
        // backed by the crate's std::ops::Add implementation.
        exportId: "@acme/vectors::Vector",
        memberId: "@acme/vectors::Vector.add",
        operationKind: "method",
        target: { form: "binary-operator", operator: "+", trait: "std::ops::Add" },
        resultCarrier: vectorCarrier,
        parameterCarriers: [vectorCarrier, vectorCarrier],
      },
    ],
    carrierPaths: { "acme.vectors.Vector": "acme_vectors::Vector" },
    crates: [{ crateName: "acme_vectors", cargoPath: resolve(fixtureCratesRoot, "acme_vectors") }],
  });
}

export const dbCarrier = { kind: "target-named", id: "acme.db.Db" };

export function acmeDbPackage() {
  return createRustProviderPackage({
    id: "acme-db",
    displayName: "Acme db",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/db",
      providerModuleId: "acme.db",
      exports: [
        {
          id: "@acme/db::connect",
          name: "connect",
          kind: "function",
          signatures: [{
            id: "@acme/db::connect(path)",
            name: "connect",
            parameters: [{ name: "path", type: { kind: "string" } }],
            returnType: { kind: "provider-ref", moduleSpecifier: "@acme/db", exportName: "Db" },
          }],
        },
        {
          id: "@acme/db::Db",
          name: "Db",
          kind: "class",
          targetIdentity: { target: "rust", id: "acme.db.Db" },
          members: [
            {
              id: "@acme/db::Db.execute",
              name: "execute",
              kind: "method",
              signatures: [{
                id: "@acme/db::Db.execute(sql)",
                parameters: [{ name: "sql", type: { kind: "string" } }],
                returnType: { kind: "source-primitive", name: "int32" },
              }],
            },
          ],
        },
      ],
    }],
    operations: [
      {
        exportId: "@acme/db::connect",
        operationKind: "method",
        target: { form: "call", path: "acme_db::connect" },
        resultCarrier: dbCarrier,
        parameterCarriers: [stringCarrier],
        isAsync: true,
      },
      {
        exportId: "@acme/db::Db",
        memberId: "@acme/db::Db.execute",
        operationKind: "method",
        target: { form: "receiver-method", name: "execute", mutatesReceiver: true },
        resultCarrier: int32Carrier,
        parameterCarriers: [stringCarrier],
        isAsync: true,
      },
    ],
    carrierPaths: { "acme.db.Db": "acme_db::Db" },
    crates: [{ crateName: "acme_db", cargoPath: resolve(fixtureCratesRoot, "acme_db") }],
  });
}

// Installed-capability fixture: the real @tsonic/rust-nodejs plugin imported
// from package-declared artifacts. Cargo dependencies come from runtime
// contributions, not relative npm peer layout.
let cachedNodeCapability;
export async function nodejsCapability() {
  if (cachedNodeCapability === undefined) {
    const layout = buildInstalledLayout();
    const { createTsonicPlugin } = await import(
      new URL(`file://${layout}/node_modules/@tsonic/rust-nodejs/dist/index.js`).href
    );
    cachedNodeCapability = createTsonicPlugin();
  }
  return cachedNodeCapability;
}

export function buildInstalledLayout() {
  const nodePackageRoot = resolve(packageRoot, "../rust-nodejs");
  const runtimePackageRoot = resolve(packageRoot, "../rust-runtime");
  const jsPackageRoot = resolve(packageRoot, "../rust-js");
  const packages = [
    [packageRoot, "target-rust"],
    [runtimePackageRoot, "rust-runtime"],
    [jsPackageRoot, "rust-js"],
    [nodePackageRoot, "rust-nodejs"],
  ].map(([root, name]) => [root, name, declaredPackageArtifacts(root)]);
  const fingerprint = installedArtifactFingerprint(packages.map(([root, , entries]) => [root, entries]));
  const installedRoot = resolve(packageRoot, `.temp/installed/${fingerprint}`);
  const layoutRoot = resolve(installedRoot, "node_modules/@tsonic");
  if (packages.every(([, name]) => existsSync(resolve(layoutRoot, name, "package.json")))) {
    return installedRoot;
  }
  const stagingRoot = resolve(packageRoot, `.temp/installed/.staging-${fingerprint}-${process.pid}-${randomUUID()}`);
  const stagingPackages = resolve(stagingRoot, "node_modules/@tsonic");
  mkdirSync(stagingPackages, { recursive: true });
  try {
    for (const [sourceRoot, name, entries] of packages) {
      for (const entry of entries) {
        cpSync(resolve(sourceRoot, entry), resolve(stagingPackages, name, entry), {
          recursive: true,
          filter: packageArtifactFilter,
        });
      }
    }
    mkdirSync(dirname(installedRoot), { recursive: true });
    try {
      renameSync(stagingRoot, installedRoot);
    } catch (error) {
      if (!packages.every(([, name]) => existsSync(resolve(layoutRoot, name, "package.json")))) {
        throw error;
      }
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  return installedRoot;
}

function declaredPackageArtifacts(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assertPackageFiles(manifest.files, root);
  return ["package.json", ...manifest.files];
}

function assertPackageFiles(files, root) {
  if (!Array.isArray(files) || files.length === 0 || files.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`Package '${root}' must declare a non-empty files array.`);
  }
  for (const entry of files) {
    if (!existsSync(resolve(root, entry))) {
      throw new Error(`Package '${root}' declares missing artifact '${entry}'.`);
    }
  }
}

function packageArtifactFilter(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name !== "target" && name !== ".temp" && name !== "node_modules";
}

function installedArtifactFingerprint(roots) {
  const hash = createHash("sha256");
  for (const [root, entries] of roots) {
    for (const entry of entries) {
      for (const filePath of artifactFiles(resolve(root, entry))) {
        hash.update(relative(root, filePath));
        hash.update("\0");
        hash.update(readFileSync(filePath));
        hash.update("\0");
      }
    }
  }
  return hash.digest("hex");
}

function artifactFiles(path) {
  if (!packageArtifactFilter(path)) {
    return [];
  }
  if (!statSync(path).isDirectory()) {
    return [path];
  }
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => artifactFiles(resolve(path, entry.name)));
}

// Non-Node capability fixture: proves the installed-capability mechanism
// carries no Node-specific behavior.
export function acmeSuperbunapiCapability() {
  return createRustProviderPackage({
    id: "@acme/rust-superbunapi",
    displayName: "SuperBunAPI for Rust",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "superbunapi",
      providerModuleId: "acme.superbunapi",
      exports: [{
        id: "superbunapi::serve",
        name: "serve",
        kind: "function",
        signatures: [{
          id: "superbunapi::serve(port)",
          name: "serve",
          parameters: [{ name: "port", type: { kind: "number" } }],
          returnType: { kind: "string" },
        }],
      }],
    }],
    operations: [{
      exportId: "superbunapi::serve",
      operationKind: "method",
      target: { form: "call", path: "acme_superbunapi::serve" },
      resultCarrier: stringCarrier,
      parameterCarriers: [int32Carrier],
    }],
    crates: [{ crateName: "acme_superbunapi", cargoPath: resolve(fixtureCratesRoot, "acme_superbunapi") }],
  });
}

// Second non-Node capability: async + fallible rows, a named carrier, and
// a runtime crate contribution — proving composition scale is name-blind.
export function acmeTelemetryCapability() {
  const meterCarrier = { kind: "target-named", id: "acme.telemetry.Meter" };
  return createRustProviderPackage({
    id: "@acme/rust-telemetry",
    displayName: "Telemetry for Rust",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "telemetry",
      providerModuleId: "acme.telemetry",
      exports: [
        {
          id: "telemetry::createMeter",
          name: "createMeter",
          kind: "function",
          signatures: [{
            id: "telemetry::createMeter(name)",
            name: "createMeter",
            parameters: [{ name: "name", type: { kind: "string" } }],
            returnType: { kind: "provider-ref", moduleSpecifier: "telemetry", exportName: "Meter" },
          }],
        },
        {
          id: "telemetry::Meter",
          name: "Meter",
          kind: "class",
          targetIdentity: { target: "rust", id: "acme.telemetry.Meter" },
          members: [
            {
              id: "telemetry::Meter.record",
              name: "record",
              kind: "method",
              signatures: [{
                id: "telemetry::Meter.record(value)",
                parameters: [{ name: "value", type: { kind: "number" } }],
                returnType: { kind: "source-primitive", name: "int32" },
              }],
            },
            {
              id: "telemetry::Meter.total",
              name: "total",
              kind: "method",
              signatures: [{ id: "telemetry::Meter.total()", parameters: [], returnType: { kind: "source-primitive", name: "int32" } }],
            },
          ],
        },
      ],
    }],
    operations: [
      { exportId: "telemetry::createMeter", operationKind: "method", target: { form: "call", path: "acme_telemetry::create_meter", argModes: ["ref"] }, resultCarrier: meterCarrier, parameterCarriers: [stringCarrier], isFallible: true },
      { exportId: "telemetry::Meter", memberId: "telemetry::Meter.record", operationKind: "method", target: { form: "receiver-method", name: "record", mutatesReceiver: true }, resultCarrier: int32Carrier, parameterCarriers: [{ kind: "source-primitive", name: "float64" }], isFallible: true, isAsync: true },
      { exportId: "telemetry::Meter", memberId: "telemetry::Meter.total", operationKind: "method", target: { form: "receiver-method", name: "total" }, resultCarrier: int32Carrier },
    ],
    carrierPaths: { "acme.telemetry.Meter": "acme_telemetry::Meter" },
    crates: [{ crateName: "acme_telemetry", cargoPath: resolve(fixtureCratesRoot, "acme_telemetry") }],
  });
}

// Capability with a fallible property row and a formatter-like carrier.
export function acmeLogsinkCapability() {
  const sinkCarrier = { kind: "target-named", id: "acme.logsink.Sink" };
  return createRustProviderPackage({
    id: "@acme/rust-logsink",
    displayName: "Log sink for Rust",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "logsink",
      providerModuleId: "acme.logsink",
      exports: [
        { id: "logsink::openSink", name: "openSink", kind: "function", signatures: [{ id: "logsink::openSink()", name: "openSink", parameters: [], returnType: { kind: "provider-ref", moduleSpecifier: "logsink", exportName: "Sink" } }] },
        { id: "logsink::openSinkNamed", name: "openSinkNamed", kind: "function", signatures: [{ id: "logsink::openSinkNamed(name)", name: "openSinkNamed", parameters: [{ name: "name", type: { kind: "string" } }], returnType: { kind: "provider-ref", moduleSpecifier: "logsink", exportName: "Sink" } }] },
        {
          id: "logsink::Sink",
          name: "Sink",
          kind: "class",
          targetIdentity: { target: "rust", id: "acme.logsink.Sink" },
          members: [
            { id: "logsink::Sink.path", name: "path", kind: "property", readonly: true, type: { kind: "string" } },
            { id: "logsink::Sink.write", name: "write", kind: "method", signatures: [{ id: "logsink::Sink.write(line)", parameters: [{ name: "line", type: { kind: "string" } }], returnType: { kind: "source-primitive", name: "int32" } }] },
          ],
        },
      ],
    }],
    operations: [
      { exportId: "logsink::openSink", operationKind: "method", target: { form: "call", path: "acme_logsink::open_sink" }, resultCarrier: sinkCarrier },
      { exportId: "logsink::openSinkNamed", operationKind: "method", target: { form: "call", path: "acme_logsink::openSinkNamed", argModes: ["ref"] }, resultCarrier: sinkCarrier, parameterCarriers: [stringCarrier] },
      { exportId: "logsink::Sink", memberId: "logsink::Sink.path", operationKind: "property", target: { form: "receiver-method", name: "path" }, resultCarrier: stringCarrier, isFallible: true },
      { exportId: "logsink::Sink", memberId: "logsink::Sink.write", operationKind: "method", target: { form: "receiver-method", name: "write", argModes: ["ref"], mutatesReceiver: true }, resultCarrier: int32Carrier, parameterCarriers: [stringCarrier] },
    ],
    carrierPaths: { "acme.logsink.Sink": "acme_logsink::Sink" },
    crates: [{ crateName: "acme_logsink", cargoPath: resolve(fixtureCratesRoot, "acme_logsink") }],
  });
}
