import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { dirname, relative, resolve } from "node:path";
import { fixtureCratesRoot, packageRoot } from "./paths.mjs";
import { int32Carrier, stringCarrier } from "./provider-core.mjs";

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
    types: [{ exportId: "telemetry::Meter", targetCarrier: { kind: "target-named", id: "acme.telemetry.Meter" } }],
    operations: [
      { exportId: "telemetry::createMeter", operationKind: "method", target: { form: "call", path: "acme_telemetry::create_meter", argModes: ["ref"] }, resultCarrier: meterCarrier, parameterCarriers: [stringCarrier], isFallible: true, errorBoundary: "source-program" },
      { exportId: "telemetry::Meter", memberId: "telemetry::Meter.record", operationKind: "method", target: { form: "receiver-method", name: "record", mutatesReceiver: true }, resultCarrier: int32Carrier, parameterCarriers: [{ kind: "source-primitive", name: "float64" }], isFallible: true, errorBoundary: "source-program", isAsync: true },
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
          members: [
            { id: "logsink::Sink.path", name: "path", kind: "property", readonly: true, type: { kind: "string" } },
            { id: "logsink::Sink.write", name: "write", kind: "method", signatures: [{ id: "logsink::Sink.write(line)", parameters: [{ name: "line", type: { kind: "string" } }], returnType: { kind: "source-primitive", name: "int32" } }] },
          ],
        },
      ],
    }],
    types: [{ exportId: "logsink::Sink", targetCarrier: { kind: "target-named", id: "acme.logsink.Sink" } }],
    operations: [
      { exportId: "logsink::openSink", operationKind: "method", target: { form: "call", path: "acme_logsink::open_sink" }, resultCarrier: sinkCarrier },
      { exportId: "logsink::openSinkNamed", operationKind: "method", target: { form: "call", path: "acme_logsink::openSinkNamed", argModes: ["ref"] }, resultCarrier: sinkCarrier, parameterCarriers: [stringCarrier] },
      { exportId: "logsink::Sink", memberId: "logsink::Sink.path", operationKind: "property", target: { form: "receiver-method", name: "path" }, resultCarrier: stringCarrier, isFallible: true, errorBoundary: "source-program" },
      { exportId: "logsink::Sink", memberId: "logsink::Sink.write", operationKind: "method", target: { form: "receiver-method", name: "write", argModes: ["ref"], mutatesReceiver: true }, resultCarrier: int32Carrier, parameterCarriers: [stringCarrier] },
    ],
    carrierPaths: { "acme.logsink.Sink": "acme_logsink::Sink" },
    crates: [{ crateName: "acme_logsink", cargoPath: resolve(fixtureCratesRoot, "acme_logsink") }],
  });
}
