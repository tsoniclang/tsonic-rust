// End-to-end test harness: compiles in-memory TypeScript through TSTS with
// the Rust target extensions, then plans Rust artifacts via the backend.
// Uses only public @tsonic packages — no @tsonic/host.
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTsonicCoreSourceExtension } from "@tsonic/source-core";
import {
  createRustBackend,
  createRustCompileInputFromSession,
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

export function acmePlatformPackage() {
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
        receiverTypeId: "acme.platform.Store",
        operationKind: "indexer",
        target: { form: "method", name: "get" },
        resultCarrier: int32Carrier,
        parameterCarriers: [int32Carrier],
      },
    ],
    crates: [{ crateName: "acme_platform", cargoPath: resolve(fixtureCratesRoot, "acme_platform") }],
  });
}

export function createRustSession({ files, target = { id: "rust", options: {} }, packages = [], capabilities = [], surfaces = [], entryPoint = "index.ts" } = {}) {
  const pack = createRustTargetPack();
  const project = { entryPoint, targets: [target] };
  // Local composition proof: capability plugin objects compose exactly as
  // the host will hand them to the target (this is not host discovery).
  const composed = composeRustCapabilities("rust", [...packages, ...capabilities]);
  packages = composed.capabilities;
  const selectedSurfaces = (pack.surfaces ?? []).filter((surface) => surfaces.includes(surface.id));
  const providerContext = {
    project,
    target,
    targetPack: pack,
    selectedSurfaces,
    selectedCapabilities: packages,
  };
  const fileMap = new Map(Object.entries(files).map(([name, text]) => [`/src/${name}`, text]));
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: fileMap,
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
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
  return { session, pack, project, target, providerContext };
}

export function checkRustSession(harness, fileNames) {
  const { session } = harness;
  const checked = fileNames ?? [...session.getSourceFiles()]
    .filter((sourceFile) => sourceFile !== undefined)
    .map((sourceFile) => session.ast.getFileName(sourceFile))
    .filter((fileName) => fileName.startsWith("/src/"));
  for (const fileName of checked) {
    const diagnostics = formatDiagnostics(session.ensureChecked(session.getSourceFile(fileName)));
    if (diagnostics !== "") {
      throw new Error(`TypeScript diagnostics for ${fileName}:\n${diagnostics}`);
    }
  }
  return session.finalizeExtensions();
}

export function compileRust({ files, target = { id: "rust", options: {} }, packages = [], capabilities = [], surfaces = [], entryPoint = "index.ts" }) {
  const harness = createRustSession({ files, target, packages, capabilities, surfaces, entryPoint });
  const extensionHost = checkRustSession(harness);
  const contributionContext = harness.providerContext;
  const capabilityReferences = harness.providerContext.selectedCapabilities.flatMap((providerPackage) =>
    providerPackage.runtimeContributions?.({}).references ?? []);
  // When a capability is loaded from the simulated install, the host would
  // have loaded the target from the same node_modules root; target-owned
  // crate references share that root so the cargo graph has one instance
  // of each crate.
  const layoutMarker = resolve(packageRoot, ".temp/installed/node_modules/@tsonic");
  const layoutActive = capabilityReferences.some((reference) => reference.include.startsWith(layoutMarker));
  const remapTargetReference = (reference) => {
    const repoRuntimes = resolve(packageRoot, "runtimes");
    if (layoutActive && reference.include.startsWith(repoRuntimes)) {
      return { ...reference, include: reference.include.replace(repoRuntimes, resolve(layoutMarker, "target-rust/runtimes")) };
    }
    return reference;
  };
  const runtimeReferences = [
    ...(harness.pack.provider.runtimeContributions?.(contributionContext).references ?? []).map(remapTargetReference),
    ...harness.providerContext.selectedSurfaces.flatMap((surface) =>
      surface.runtimeContributions?.(contributionContext).references ?? []).map(remapTargetReference),
    ...capabilityReferences,
  ];
  const input = createRustCompileInputFromSession({
    session: harness.session,
    extensionHost,
    project: harness.project,
    target,
    runtimeReferences,
    selectedCapabilities: harness.providerContext.selectedCapabilities,
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
    crates: [{ crateName: "acme_db", cargoPath: resolve(fixtureCratesRoot, "acme_db") }],
  });
}

// Installed-capability fixture: the real @tsonic/rust-nodejs plugin,
// imported from a simulated flat node_modules install so every path
// contribution and peer-layout crate dependency resolves exactly as it
// would from a real npm install.
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
  const layoutRoot = resolve(packageRoot, ".temp/installed/node_modules/@tsonic");
  // Idempotent across concurrent test processes: the layout is rebuilt only
  // when absent (npm test clears .temp/installed up front via pretest).
  if (existsSync(resolve(layoutRoot, "rust-nodejs/package.json")) && existsSync(resolve(layoutRoot, "target-rust/package.json"))) {
    return resolve(packageRoot, ".temp/installed");
  }
  rmSync(resolve(packageRoot, ".temp/installed"), { recursive: true, force: true });
  const copies = [
    [packageRoot, "target-rust", ["package.json", "dist", "runtimes"]],
    [resolve(packageRoot, "../rust-nodejs"), "rust-nodejs", ["package.json", "dist", "runtimes"]],
  ];
  for (const [sourceRoot, name, entries] of copies) {
    for (const entry of entries) {
      cpSync(resolve(sourceRoot, entry), resolve(layoutRoot, name, entry), { recursive: true });
    }
  }
  // The copied rust-nodejs plugin resolves @tsonic/target-rust and its own
  // transitive compiler dependencies through standard walk-up resolution.
  return resolve(packageRoot, ".temp/installed");
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
