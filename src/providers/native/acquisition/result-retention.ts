import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RustFoundation } from "../../../target-model/foundation/model.js";
import type {
  RustCompilerNativeRetentionBatch, RustCompilerNativeRetentionEvidence, RustCompilerNativeRetentionFact,
  RustCompilerNativeRetentionQuestion, RustCompilerProjectSnapshot,
} from "../model/model.js";
import { rustCompilerProviderProtocolVersion } from "../model/model.js";
import { verifyRustCompilerDependencySource, verifyRustCompilerStandardLibraryMetadata } from "./cargo-snapshot.js";
import { validateDependencyBelongsToSnapshot } from "./rustdoc-artifact.js";
import { renderRustNativeResultRetentionSource, type RustNativeRetentionSource } from "./result-retention-source.js";

const expectedCodes = Object.freeze({ use: new Set(["E0499", "E0502", "E0505"]), cleanup: new Set(["E0597"]) });
const commandTimeout = 540_000;
const commandBuffer = 64 * 1024 * 1024;

export function loadRustNativeResultRetentionBatch(input: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly questions: readonly RustCompilerNativeRetentionQuestion[];
  readonly targetDirectory: string;
  readonly foundation: RustFoundation;
}): RustCompilerNativeRetentionBatch {
  const { snapshot } = input;
  const workingDirectory = dirname(snapshot.manifestPath);
  const questionDigest = digest(JSON.stringify({ questions: input.questions, foundation: input.foundation }));
  const identity: Pick<RustCompilerNativeRetentionBatch, "protocolVersion" | "snapshotDigest" | "compilerIdentity" | "questionDigest"> =
    { protocolVersion: rustCompilerProviderProtocolVersion, snapshotDigest: snapshot.digest,
    compilerIdentity: snapshot.compiler.rustcVerboseVersion, questionDigest };
  if (input.questions.length === 0) return Object.freeze({ ...identity, facts: Object.freeze([]), evidence: Object.freeze([]) });
  const dependencies = new Map(input.questions.map(question => [question.dependency.alias, question.dependency]));
  const originalIds = new Set<string>();
  for (const question of input.questions) {
    if (!question.id || originalIds.has(question.id) || !question.declaration.itemId || !question.applicationIdentity)
      throw new Error("Native retention requires unique original questions and exact native declaration/application identities.");
    originalIds.add(question.id);
    validateDependencyBelongsToSnapshot(snapshot, question.dependency);
  }
  function verify(): void {
    const compiler = run("rustc", ["-vV"], workingDirectory);
    if (compiler.status !== 0 || compiler.stdout.trim() !== snapshot.compiler.rustcVerboseVersion.trim())
      throw new Error("Native retention compiler changed after the original provider snapshot.");
    if (snapshot.kind === "standard-library") verifyRustCompilerStandardLibraryMetadata(snapshot);
    else for (const dependency of dependencies.values()) verifyRustCompilerDependencySource(snapshot, dependency);
  }
  verify();
  const contextDigest = nativeContextDigest(workingDirectory);
  const root = join(input.targetDirectory, "result-retention", digest(JSON.stringify({ ...identity, contextDigest })));
  const artifact = join(root, "result.json");
  const marker = `${artifact}.sha256`;
  if (existsSync(artifact) && existsSync(marker)) {
    const text = readFileSync(artifact, "utf8");
    if (digest(text) !== readFileSync(marker, "utf8").trim()) throw new Error("Native retention cache artifact digest is invalid.");
    const cached: unknown = JSON.parse(text);
    if (!isBatch(cached, identity, input.questions)) throw new Error("Native retention cache has foreign or incomplete native question evidence.");
    verify();
    return cached;
  }
  mkdirSync(root, { recursive: true });
  const facts: RustCompilerNativeRetentionFact[] = [];
  const evidence: RustCompilerNativeRetentionEvidence[] = [];
  const questions: RustCompilerNativeRetentionQuestion[] = [];
  for (const question of input.questions) {
    try {
      renderRustNativeResultRetentionSource({ questions: [question], phase: "challenge" });
      questions.push(question);
    } catch (error) {
      facts.push(unavailable(question, error instanceof Error ? error.message : String(error)));
    }
  }
  if (questions.length > 0) {
    const manifest = renderManifest(snapshot);
    const challenge = renderRustNativeResultRetentionSource({ questions, phase: "challenge" });
    const challengeEvidence = check("challenge", challenge, manifest);
    evidence.push(challengeEvidence);
    const retained = new Set<string>();
    const unexpected = challengeEvidence.diagnostics.filter(diagnostic => {
      const matches = challenge.originalQuestionSpans.filter(span => expectedCodes[span.phase].has(diagnostic.code ?? "") &&
        diagnostic.spans.some(position => position.primary && position.startLine >= span.startLine && position.endLine <= span.endLine));
      if (matches.length !== 1) return true;
      retained.add(`${matches[0]!.questionId}:${matches[0]!.phase}`);
      return false;
    });
    const permitted = new Set(questions.flatMap(question => ["use", "cleanup"].map(phase => `${question.id}:${phase}`))
      .filter(key => !retained.has(key)));
    if (unexpected.length > 0 || challengeEvidence.exitCode !== 0 && retained.size === 0) {
      const reasons = unexpected.map(diagnostic => `${diagnostic.code ?? "cargo"}: ${diagnostic.message}`);
      for (const question of questions) facts.push(unavailable(question,
        ...(reasons.length > 0 ? reasons : ["The native challenge failed without an exact expected original-question diagnostic."])));
    } else {
      const certification = renderRustNativeResultRetentionSource({ questions, phase: "certify-permitted", permitted });
      const certificate = check("certify-permitted", certification, manifest);
      evidence.push(certificate);
      for (const question of questions) facts.push(certificate.exitCode === 0 && certificate.diagnostics.length === 0
        ? Object.freeze({ questionId: question.id, applicationIdentity: question.applicationIdentity, kind: "resolved" as const,
          use: retained.has(`${question.id}:use`) ? "retained" as const : "released" as const,
          cleanup: retained.has(`${question.id}:cleanup`) ? "retained" as const : "released" as const })
        : unavailable(question, "The complete permitted native question batch did not compile successfully.",
          ...certificate.diagnostics.map(diagnostic => `${diagnostic.code ?? "cargo"}: ${diagnostic.message}`)));
    }
  }
  verify();
  if (nativeContextDigest(workingDirectory) !== contextDigest) throw new Error("Native retention compiler configuration changed during the query.");
  const byId = new Map(facts.map(fact => [fact.questionId, fact]));
  const batch: RustCompilerNativeRetentionBatch = Object.freeze({ ...identity,
    facts: Object.freeze(input.questions.map(question => byId.get(question.id)!)), evidence: Object.freeze(evidence) });
  const text = JSON.stringify(batch);
  writeAtomic(artifact, text);
  writeAtomic(marker, digest(text));
  return batch;

  function check(phase: string, source: RustNativeRetentionSource, manifest: string): RustCompilerNativeRetentionEvidence {
    const project = join(root, phase);
    mkdirSync(join(project, "src"), { recursive: true });
    writeAtomic(join(project, "Cargo.toml"), manifest);
    writeAtomic(join(project, "src", "lib.rs"), source.sourceText);
    const originalLock = join(workingDirectory, "Cargo.lock");
    if (existsSync(originalLock)) writeAtomic(join(project, "Cargo.lock"), readFileSync(originalLock, "utf8"));
    if (snapshot.kind === "cargo-project") {
      const actual = metadata(join(project, "Cargo.toml"));
      const original = metadata(snapshot.manifestPath);
      if (JSON.stringify(actual) !== JSON.stringify(original)) {
        throw new Error("Native retention query dependency sources, feature environments or dependency edges differ from the original Cargo project.");
      }
    }
    const args = ["check", "--offline", "--manifest-path", join(project, "Cargo.toml"), "--lib", "--message-format=json",
      "--target-dir", join(input.targetDirectory, "result-retention-target")];
    const result = run("cargo", args, workingDirectory);
    writeAtomic(join(project, "stdout.jsonl"), result.stdout);
    writeAtomic(join(project, "stderr.log"), result.stderr);
    const diagnostics = diagnosticsFrom(result.stdout, join(project, "src", "lib.rs"), project);
    if (result.status === null || result.error !== undefined) throw new Error(`Native retention cargo did not finish: ${result.error?.message ?? result.signal}`);
    return Object.freeze({ sourceDigest: digest(source.sourceText), command: Object.freeze(["cargo", ...args]),
      exitCode: result.status, diagnosticsDigest: digest(JSON.stringify(diagnostics)), diagnostics: Object.freeze(diagnostics) });
  }
}

function renderManifest(snapshot: RustCompilerProjectSnapshot): string {
  const dependencies = snapshot.dependencies.filter(dependency => !["std", "core", "alloc"].includes(dependency.alias));
  return `[package]\nname = "tsonic_native_result_retention"\nversion = "0.0.0"\nedition = "2021"\n[workspace]\n[dependencies]\n${dependencies.map(dependency =>
    `${JSON.stringify(dependency.targetCrateName)} = { package = ${JSON.stringify(dependency.packageName)}, path = ${JSON.stringify(dirname(dependency.manifestPath))}, default-features = false, features = ${JSON.stringify(dependency.features.filter(feature => feature !== "default"))} }`).join("\n")}\n`;
}

function metadata(manifest: string): readonly unknown[] {
  const result = run("cargo", ["metadata", "--offline", "--manifest-path", manifest, "--format-version", "1"], dirname(manifest));
  if (result.status !== 0) throw new Error(`Native retention dependency closure cannot be verified: ${result.stderr}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!record(parsed) || !Array.isArray(parsed.packages) || !record(parsed.resolve) || !Array.isArray(parsed.resolve.nodes))
    throw new Error("Native retention Cargo metadata has no resolved dependency closure.");
  const packages = new Map<string, string>();
  for (const item of parsed.packages) {
    if (!record(item) || typeof item.id !== "string" || typeof item.manifest_path !== "string") throw new Error("Native retention Cargo metadata contains an invalid package identity.");
    packages.set(item.id, realpathSync(item.manifest_path));
  }
  const root = parsed.resolve.root;
  const nodes = parsed.resolve.nodes;
  return nodes.filter(node => record(node) && node.id !== root).map((node: unknown) => {
    if (!record(node) || typeof node.id !== "string" || !Array.isArray(node.features) || !node.features.every(value => typeof value === "string") || !Array.isArray(node.deps))
      throw new Error("Native retention Cargo metadata contains an invalid feature environment.");
    const path = packages.get(node.id);
    if (path === undefined) throw new Error("Native retention dependency has no actual manifest identity.");
    const edges = node.deps.map((edge: unknown) => {
      if (!record(edge) || typeof edge.name !== "string" || typeof edge.pkg !== "string" || !packages.has(edge.pkg))
        throw new Error("Native retention dependency edge has no original package identity.");
      return [edge.name, packages.get(edge.pkg)];
    }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { path, features: [...node.features].sort(), edges };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function diagnosticsFrom(text: string, source: string, workingDirectory: string): RustCompilerNativeRetentionEvidence["diagnostics"][number][] {
  const result: RustCompilerNativeRetentionEvidence["diagnostics"][number][] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const value: unknown = JSON.parse(line);
    if (!record(value) || value.reason !== "compiler-message" || !record(value.message) || value.message.level !== "error") continue;
    const message = value.message;
    const originalTarget = record(value.target) && typeof value.target.src_path === "string" &&
      resolve(value.target.src_path) === resolve(source);
    if (typeof message.message !== "string" || !Array.isArray(message.spans)) throw new Error("Native retention compiler diagnostic has an invalid shape.");
    const spans = message.spans.flatMap((span: unknown) => {
      if (!record(span) || typeof span.file_name !== "string" || typeof span.line_start !== "number" || typeof span.line_end !== "number" || typeof span.is_primary !== "boolean")
        throw new Error("Native retention compiler diagnostic contains an invalid source span.");
      return !originalTarget || resolve(workingDirectory, span.file_name) !== resolve(source) ? [] :
        [{ startLine: span.line_start, endLine: span.line_end, primary: span.is_primary }];
    });
    result.push(Object.freeze({ code: record(message.code) && typeof message.code.code === "string" ? message.code.code : null,
      message: message.message, spans: Object.freeze(spans) }));
  }
  return result;
}

function nativeContextDigest(root: string): string {
  const paths = new Set<string>();
  for (let directory = root;; directory = dirname(directory)) {
    for (const name of [".cargo/config", ".cargo/config.toml", "rust-toolchain", "rust-toolchain.toml"]) paths.add(join(directory, name));
    if (dirname(directory) === directory) break;
  }
  if (process.env.CARGO_HOME !== undefined) for (const name of ["config", "config.toml"]) paths.add(join(process.env.CARGO_HOME, name));
  const configuration = [...paths].filter(existsSync).map(path => [path, digest(readFileSync(path))]);
  const environment = Object.entries(process.env).filter(([name]) => /^(?:RUST|CARGO|CC|CXX|AR|LD|TARGET|HOST)/u.test(name)).sort();
  return digest(JSON.stringify({ configuration, environment }));
}

function unavailable(question: RustCompilerNativeRetentionQuestion, ...reasons: readonly string[]): RustCompilerNativeRetentionFact {
  return Object.freeze({ questionId: question.id, applicationIdentity: question.applicationIdentity,
    kind: "unavailable", reasons: Object.freeze(reasons) });
}

function isBatch(value: unknown, identity: { readonly snapshotDigest: string; readonly compilerIdentity: string; readonly questionDigest: string },
  questions: readonly RustCompilerNativeRetentionQuestion[]): value is RustCompilerNativeRetentionBatch {
  if (!record(value) || value.protocolVersion !== rustCompilerProviderProtocolVersion ||
    value.snapshotDigest !== identity.snapshotDigest || value.compilerIdentity !== identity.compilerIdentity || value.questionDigest !== identity.questionDigest ||
    !Array.isArray(value.facts) || value.facts.length !== questions.length || !Array.isArray(value.evidence)) return false;
  if (!value.evidence.every((evidence: unknown) => record(evidence) && typeof evidence.sourceDigest === "string" &&
    /^[a-f0-9]{64}$/u.test(evidence.sourceDigest) && Array.isArray(evidence.command) &&
    evidence.command.length > 0 && evidence.command.every(part => typeof part === "string") &&
    Number.isSafeInteger(evidence.exitCode) && typeof evidence.diagnosticsDigest === "string" &&
    Array.isArray(evidence.diagnostics) && digest(JSON.stringify(evidence.diagnostics)) === evidence.diagnosticsDigest &&
    evidence.diagnostics.every((diagnostic: unknown) => record(diagnostic) &&
      (diagnostic.code === null || typeof diagnostic.code === "string") && typeof diagnostic.message === "string" &&
      Array.isArray(diagnostic.spans) && diagnostic.spans.every((span: unknown) => record(span) &&
        typeof span.startLine === "number" && Number.isSafeInteger(span.startLine) && span.startLine > 0 &&
        typeof span.endLine === "number" && Number.isSafeInteger(span.endLine) && span.endLine >= span.startLine &&
        typeof span.primary === "boolean")))) return false;
  if (value.facts.some((fact: unknown) => record(fact) && fact.kind === "resolved") &&
    (value.evidence.length !== 2 || !record(value.evidence[1]) || value.evidence[1].exitCode !== 0 ||
      !Array.isArray(value.evidence[1].diagnostics) || value.evidence[1].diagnostics.length !== 0)) return false;
  return value.facts.every((fact: unknown, index: number) => record(fact) && fact.questionId === questions[index]!.id &&
    fact.applicationIdentity === questions[index]!.applicationIdentity && (fact.kind === "resolved" &&
      (fact.use === "retained" || fact.use === "released") && (fact.cleanup === "retained" || fact.cleanup === "released") ||
      fact.kind === "unavailable" && Array.isArray(fact.reasons) && fact.reasons.length > 0 && fact.reasons.every(reason => typeof reason === "string")));
}

function run(command: string, args: readonly string[], cwd: string) {
  const env = { ...process.env };
  delete env.RUSTC_BOOTSTRAP;
  return spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: commandTimeout, maxBuffer: commandBuffer, windowsHide: true });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeAtomic(path: string, contents: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}
