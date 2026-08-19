import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  rustCompilerProviderProtocolVersion,
  supportedRustdocFormatVersion,
} from "../model/model.js";
import type {
  RustCompilerCargoProjectSnapshot,
  RustCompilerDependency,
  RustCompilerMetadataArtifact,
  RustCompilerPackageSource,
  RustCompilerProjectSnapshot,
  RustCompilerStandardLibrarySnapshot,
} from "../model/model.js";

const sourcePackageFileLimit = 100_000;
const sourcePackageByteLimit = 1_073_741_824;
const snapshotSourceFileLimit = 1_000_000;
const snapshotSourceByteLimit = 4_294_967_296;
const sourcePackageLimit = 4_096;
const commandBufferLimit = 256 * 1024 * 1024;
const metadataTimeoutMilliseconds = 120_000;
const excludedDirectories = new Set([".git", ".temp", "node_modules", "target"]);
const standardLibraryCrates = Object.freeze(["alloc", "core", "std"]);
const standardMetadataArtifactLimit = 256;

interface CargoMetadata {
  readonly packages: readonly CargoPackage[];
  readonly resolve: {
    readonly root: string | null;
    readonly nodes: readonly CargoResolveNode[];
  } | null;
}

interface CargoPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly manifest_path: string;
  readonly targets: readonly {
    readonly name: string;
    readonly kind: readonly string[];
  }[];
}

interface CargoResolveNode {
  readonly id: string;
  readonly deps: readonly { readonly name: string; readonly pkg: string }[];
  readonly features: readonly string[];
}

export function createRustCompilerProjectSnapshot(manifestPath: string): RustCompilerCargoProjectSnapshot {
  const canonicalManifestPath = realpathSync(resolve(manifestPath));
  const metadata = readCargoMetadata(canonicalManifestPath);
  if (metadata.resolve === null) {
    throw new Error(`Cargo did not resolve a dependency graph for '${canonicalManifestPath}'.`);
  }
  const rootPackage = selectRootPackage(metadata, canonicalManifestPath);
  const rootNode = metadata.resolve.nodes.find((node) => node.id === rootPackage.id);
  if (rootNode === undefined) {
    throw new Error(`Cargo metadata omitted the resolved root package '${rootPackage.id}'.`);
  }
  const packageById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodeById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const closureIdsByDirectPackage = new Map(rootNode.deps.map((edge) => [
    edge.pkg,
    dependencyClosure(edge.pkg, nodeById),
  ]));
  const sourcePackageIds = new Set([...closureIdsByDirectPackage.values()].flat());
  if (sourcePackageIds.size > sourcePackageLimit) {
    throw new Error(`Cargo dependency source snapshot exceeds ${sourcePackageLimit} resolved packages.`);
  }
  const packageSources = snapshotPackageSources(sourcePackageIds, packageById);
  const packageSourceById = new Map(packageSources.map((source) => [source.packageId, source]));
  const dependencies = rootNode.deps.map((edge): RustCompilerDependency => {
    const pkg = packageById.get(edge.pkg);
    const node = nodeById.get(edge.pkg);
    if (pkg === undefined || node === undefined) {
      throw new Error(`Cargo metadata dependency '${edge.name}' points to missing package '${edge.pkg}'.`);
    }
    const libraryTargets = pkg.targets.filter((target) => target.kind.includes("lib"));
    if (libraryTargets.length !== 1) {
      throw new Error(`Cargo dependency '${edge.name}' must resolve to exactly one library target; found ${libraryTargets.length}.`);
    }
    const dependencyManifest = realpathSync(resolve(pkg.manifest_path));
    const source = packageSourceById.get(pkg.id);
    if (source === undefined) {
      throw new Error(`Cargo dependency '${edge.name}' has no immutable source snapshot.`);
    }
    const targetCrateName = edge.name.replace(/-/gu, "_");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(targetCrateName)) {
      throw new Error(`Cargo dependency alias '${edge.name}' does not map to one Rust crate identifier.`);
    }
    return Object.freeze({
      alias: edge.name,
      packageId: pkg.id,
      packageName: pkg.name,
      packageVersion: pkg.version,
      crateName: libraryTargets[0]!.name,
      targetCrateName,
      manifestPath: dependencyManifest,
      sourceRoot: source.sourceRoot,
      sourceDigest: source.sourceDigest,
      closurePackageIds: closureIdsByDirectPackage.get(pkg.id)!,
      features: Object.freeze([...node.features].sort(compareText)),
    });
  }).sort((left, right) => compareText(left.alias, right.alias));
  const duplicateAlias = dependencies.find((dependency, index) =>
    index > 0 && dependencies[index - 1]!.alias === dependency.alias);
  if (duplicateAlias !== undefined) {
    throw new Error(`Cargo root package exposes duplicate direct dependency alias '${duplicateAlias.alias}'.`);
  }
  const rustcVerboseVersion = runCommand("rustc", ["-vV"], dirname(canonicalManifestPath));
  const compiler = Object.freeze({
    rustcVerboseVersion,
    rustdocFormatVersion: supportedRustdocFormatVersion,
  });
  const digest = createHash("sha256").update(JSON.stringify({
    manifestPath: canonicalManifestPath,
    rootPackageId: rootPackage.id,
    compiler,
    dependencies,
    packageSources,
  })).digest("hex");
  return Object.freeze({
    kind: "cargo-project",
    protocolVersion: rustCompilerProviderProtocolVersion,
    manifestPath: canonicalManifestPath,
    rootPackageId: rootPackage.id,
    compiler,
    dependencies: Object.freeze(dependencies),
    packageSources,
    digest,
  });
}

export function createRustCompilerStandardLibrarySnapshot(): RustCompilerStandardLibrarySnapshot {
  const rustcVerboseVersion = runCommand("rustc", ["-vV"], process.cwd());
  const sysroot = realpathSync(runCommand("rustc", ["--print", "sysroot"], process.cwd()).trim());
  const targetTriple = runCommand("rustc", ["--print", "host-tuple"], process.cwd()).trim();
  const targetLibraryDirectory = realpathSync(
    runCommand("rustc", ["--print", "target-libdir"], process.cwd()).trim(),
  );
  const metadataArtifacts = snapshotStandardMetadataArtifacts(targetLibraryDirectory);
  const manifestPath = realpathSync(join(sysroot, "lib", "rustlib", "src", "rust", "library", "std", "Cargo.toml"));
  const metadata = readCargoMetadata(manifestPath, {
    locked: true,
    offline: true,
    rustcBootstrap: true,
    noDependencies: true,
  });
  const rootPackage = selectRootPackage(metadata, manifestPath);
  if (rootPackage.name !== "std") {
    throw new Error(`Installed Rust standard-library manifest resolves root package '${rootPackage.name}', expected 'std'.`);
  }
  const packageById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const selectedPackages = standardLibraryCrates.map((name) => {
    const candidates = metadata.packages.filter((pkg) => pkg.name === name);
    if (candidates.length !== 1) {
      throw new Error(`Installed Rust standard-library graph must contain exactly one '${name}' package; found ${candidates.length}.`);
    }
    return candidates[0]!;
  });
  const closureIdsByPackage = new Map(selectedPackages.map((pkg) => [
    pkg.id,
    Object.freeze([pkg.id]),
  ]));
  const sourcePackageIds = new Set([...closureIdsByPackage.values()].flat());
  if (sourcePackageIds.size > sourcePackageLimit) {
    throw new Error(`Rust standard-library source snapshot exceeds ${sourcePackageLimit} resolved packages.`);
  }
  const packageSources = snapshotPackageSources(sourcePackageIds, packageById);
  const packageSourceById = new Map(packageSources.map((source) => [source.packageId, source]));
  const dependencies = selectedPackages.map((pkg): RustCompilerDependency => {
    const source = packageSourceById.get(pkg.id);
    if (source === undefined) {
      throw new Error(`Rust standard-library package '${pkg.name}' has no exact source snapshot.`);
    }
    const libraryTarget = selectLibraryTarget(pkg, pkg.name);
    return Object.freeze({
      alias: pkg.name,
      packageId: pkg.id,
      packageName: pkg.name,
      packageVersion: pkg.version,
      crateName: libraryTarget.name,
      targetCrateName: libraryTarget.name,
      manifestPath: realpathSync(resolve(pkg.manifest_path)),
      sourceRoot: source.sourceRoot,
      sourceDigest: source.sourceDigest,
      closurePackageIds: closureIdsByPackage.get(pkg.id)!,
      features: Object.freeze([]),
    });
  }).sort((left, right) => compareText(left.alias, right.alias));
  const compiler = Object.freeze({
    rustcVerboseVersion,
    rustdocFormatVersion: supportedRustdocFormatVersion,
  });
  const digest = createHash("sha256").update(JSON.stringify({
    kind: "standard-library",
    manifestPath,
    rootPackageId: rootPackage.id,
    compiler,
    dependencies,
    packageSources,
    targetTriple,
    targetLibraryDirectory,
    metadataArtifacts,
  })).digest("hex");
  return Object.freeze({
    kind: "standard-library",
    protocolVersion: rustCompilerProviderProtocolVersion,
    manifestPath,
    rootPackageId: rootPackage.id,
    compiler,
    dependencies: Object.freeze(dependencies),
    packageSources,
    targetTriple,
    targetLibraryDirectory,
    metadataArtifacts,
    digest,
  });
}

export function verifyRustCompilerStandardLibraryMetadata(
  snapshot: RustCompilerStandardLibrarySnapshot,
): void {
  for (const artifact of snapshot.metadataArtifacts) {
    const stat = statSync(artifact.path);
    if (stat.size !== artifact.byteLength || stat.mtimeMs !== artifact.modifiedMilliseconds) {
      throw new Error(
        `Rust standard-library metadata artifact '${artifact.path}' changed after the compiler-provider snapshot was created.`,
      );
    }
  }
}

function snapshotStandardMetadataArtifacts(
  targetLibraryDirectory: string,
): readonly RustCompilerMetadataArtifact[] {
  const files = readdirSync(targetLibraryDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^lib[A-Za-z0-9_]+-[0-9a-f]+\.rmeta$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareText);
  if (files.length === 0 || files.length > standardMetadataArtifactLimit) {
    throw new Error(
      `Installed Rust target library exposes ${files.length} metadata artifacts; expected 1-${standardMetadataArtifactLimit}.`,
    );
  }
  const names = new Set<string>();
  return Object.freeze(files.map((name): RustCompilerMetadataArtifact => {
    const match = /^lib([A-Za-z0-9_]+)-[0-9a-f]+\.rmeta$/u.exec(name);
    const crateName = match?.[1];
    if (crateName === undefined || names.has(crateName)) {
      throw new Error(
        `Installed Rust target library has no unique metadata artifact identity for '${name}'.`,
      );
    }
    names.add(crateName);
    const path = realpathSync(join(targetLibraryDirectory, name));
    const stat = statSync(path);
    return Object.freeze({
      crateName,
      path,
      byteLength: stat.size,
      modifiedMilliseconds: stat.mtimeMs,
      digest: createHash("sha256").update(readFileSync(path)).digest("hex"),
    });
  }));
}

export function verifyRustCompilerDependencySource(
  snapshot: RustCompilerProjectSnapshot,
  dependency: RustCompilerDependency,
): void {
  const sourcesById = new Map(snapshot.packageSources.map((source) => [source.packageId, source]));
  const budget = sourceSnapshotBudget();
  const digestsByRoot = new Map<string, string>();
  for (const packageId of dependency.closurePackageIds) {
    const source = sourcesById.get(packageId);
    if (source === undefined) {
      throw new Error(`Cargo dependency '${dependency.alias}' closure has no source snapshot for '${packageId}'.`);
    }
    const actual = digestsByRoot.get(source.sourceRoot) ?? digestSourceTree(source.sourceRoot, budget);
    digestsByRoot.set(source.sourceRoot, actual);
    if (actual !== source.sourceDigest) {
      throw new Error(`Cargo dependency '${dependency.alias}' closure package '${packageId}' changed after the compiler-provider snapshot was created.`);
    }
  }
}

function readCargoMetadata(
  manifestPath: string,
  options: {
    readonly locked?: boolean;
    readonly offline?: boolean;
    readonly rustcBootstrap?: boolean;
    readonly noDependencies?: boolean;
  } = {},
): CargoMetadata {
  const args = [
    "metadata",
    "--manifest-path",
    manifestPath,
    "--format-version",
    "1",
    ...(options.locked === true ? ["--locked"] : []),
    ...(options.offline === true ? ["--offline"] : []),
    ...(options.noDependencies === true ? ["--no-deps"] : []),
  ];
  const stdout = runCommand("cargo", args, dirname(manifestPath), options.rustcBootstrap === true
    ? { RUSTC_BOOTSTRAP: "1" }
    : undefined);
  const value = JSON.parse(stdout) as unknown;
  const validResolve = isRecord(value) && (value.resolve === null ||
    isRecord(value.resolve) && Array.isArray(value.resolve.nodes));
  if (!isRecord(value) || !Array.isArray(value.packages) || !validResolve ||
    (options.noDependencies !== true && value.resolve === null)) {
    throw new Error(`Cargo emitted an invalid metadata document for '${manifestPath}'.`);
  }
  return value as unknown as CargoMetadata;
}

function selectLibraryTarget(
  pkg: CargoPackage,
  dependencyName: string,
): CargoPackage["targets"][number] {
  const libraryTargets = pkg.targets.filter((target) =>
    target.kind.some((kind) => kind === "lib" || kind === "rlib" || kind === "dylib"));
  if (libraryTargets.length !== 1) {
    throw new Error(`Cargo dependency '${dependencyName}' must resolve to exactly one library target; found ${libraryTargets.length}.`);
  }
  return libraryTargets[0]!;
}

function selectRootPackage(metadata: CargoMetadata, manifestPath: string): CargoPackage {
  const candidates = metadata.packages.filter((pkg) => {
    try {
      return realpathSync(resolve(pkg.manifest_path)) === manifestPath;
    } catch {
      return false;
    }
  });
  if (candidates.length !== 1) {
    throw new Error(`Rust target option 'projectFile' must identify one Cargo package manifest; found ${candidates.length} matching packages.`);
  }
  return candidates[0]!;
}

function dependencyClosure(
  packageId: string,
  nodeById: ReadonlyMap<string, CargoResolveNode>,
): readonly string[] {
  const pending = [packageId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const node = nodeById.get(current);
    if (node === undefined) {
      throw new Error(`Cargo dependency closure references missing resolve node '${current}'.`);
    }
    for (const edge of node.deps) {
      pending.push(edge.pkg);
    }
  }
  return Object.freeze([...visited].sort(compareText));
}

function snapshotPackageSources(
  packageIds: ReadonlySet<string>,
  packageById: ReadonlyMap<string, CargoPackage>,
): readonly RustCompilerPackageSource[] {
  const budget = sourceSnapshotBudget();
  const digestsByRoot = new Map<string, string>();
  return Object.freeze([...packageIds].sort(compareText).map((packageId) => {
    const pkg = packageById.get(packageId);
    if (pkg === undefined) {
      throw new Error(`Cargo dependency source snapshot references missing package '${packageId}'.`);
    }
    const sourceRoot = realpathSync(dirname(realpathSync(resolve(pkg.manifest_path))));
    const sourceDigest = digestsByRoot.get(sourceRoot) ?? digestSourceTree(sourceRoot, budget);
    digestsByRoot.set(sourceRoot, sourceDigest);
    return Object.freeze({ packageId, sourceRoot, sourceDigest });
  }));
}

interface SourceSnapshotBudget {
  files: number;
  bytes: number;
}

function sourceSnapshotBudget(): SourceSnapshotBudget {
  return { files: 0, bytes: 0 };
}

function digestSourceTree(root: string, budget: SourceSnapshotBudget): string {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  visit("");
  return hash.digest("hex");

  function visit(relativeDirectory: string): void {
    const directory = relativeDirectory.length === 0 ? root : join(root, relativeDirectory);
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Cargo package source snapshot rejects symbolic link '${join(directory, entry.name)}'.`);
      }
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          visit(relativeDirectory.length === 0 ? entry.name : join(relativeDirectory, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files += 1;
      budget.files += 1;
      if (files > sourcePackageFileLimit || budget.files > snapshotSourceFileLimit) {
        throw new Error(`Cargo package source snapshot exceeds its finite file budget.`);
      }
      const relativePath = relativeDirectory.length === 0 ? entry.name : join(relativeDirectory, entry.name);
      const path = join(root, relativePath);
      const size = statSync(path).size;
      bytes += size;
      budget.bytes += size;
      if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(budget.bytes) ||
        bytes > sourcePackageByteLimit || budget.bytes > snapshotSourceByteLimit) {
        throw new Error(`Cargo package source snapshot exceeds its finite byte budget.`);
      }
      hash.update(relativePath.split("\\").join("/"));
      hash.update("\0");
      hash.update(readFileSync(path));
      hash.update("\0");
    }
  }
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  environment?: Readonly<Record<string, string>>,
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment === undefined ? process.env : { ...process.env, ...environment },
    maxBuffer: commandBufferLimit,
    timeout: metadataTimeoutMilliseconds,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${String(result.status)}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
