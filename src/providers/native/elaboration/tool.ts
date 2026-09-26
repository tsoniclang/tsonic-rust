import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RustLexicalTokenTree } from "../../../target-model/syntax/token-tree.js";
import { decodeNativeTokenResponse } from "./tokens.js";
import { decodeNativeEvidence } from "./decode-evidence.js";
import type { RustNativeDeclarationEvidence, RustNativeEvidence, RustNativeSemanticEvidence } from "./evidence.js";
import { validateRustNativeEvidenceInputs } from "./freshness.js";
import { runRustNativeCommand } from "../protocol/bounded-command.js";
import { defaultRustNativeSourceLimits, validateRustNativeSourceLimits } from "./limits.js";
import type { RustNativeSourceLimits } from "./limits.js";

export { defaultRustNativeSourceLimits } from "./limits.js";
export type { RustNativeSourceLimits } from "./limits.js";

export interface RustNativeSourceTool {
  readonly compilerIdentity: string;
  readonly sysroot: string;
  tokens(source: string, edition: string): readonly RustLexicalTokenTree[];
  declarations(arguments_: readonly string[]): RustNativeDeclarationEvidence;
  check(arguments_: readonly string[]): RustNativeEvidence;
}

export function createRustNativeSourceTool(options: {
  readonly cacheRoot: string;
  readonly compiler?: string;
  readonly limits?: RustNativeSourceLimits;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
}): RustNativeSourceTool {
  const selection = options.limits === undefined ? defaultRustNativeSourceLimits : options.limits;
  validateRustNativeSourceLimits(selection);
  const limits = Object.freeze({ ...selection });
  const selectedEnvironment = Object.freeze({ ...(options.environment ?? process.env) });
  const compiler = options.compiler ?? selectedEnvironment.RUSTC ?? "rustc";
  const cacheRoot = resolve(options.cacheRoot);
  mkdirSync(cacheRoot, { recursive: true });
  const command = (executable: string, arguments_: readonly string[], env: NodeJS.ProcessEnv): string =>
    runRustNativeCommand({ executable, arguments: arguments_, environment: env, directory: cacheRoot,
      timeoutMilliseconds: limits.timeoutMilliseconds, maximumDiagnosticBytes: 8 * 1024 * 1024 });
  const compilerIdentity = command(compiler, ["-vV"], selectedEnvironment);
  const sysroot = command(compiler, ["--print", "sysroot"], selectedEnvironment);
  const host = compilerIdentity.split("\n").find(line => line.startsWith("host: "))?.slice(6);
  if (host === undefined || !/^[A-Za-z0-9_-]+$/u.test(host) || !existsSync(sysroot)) {
    throw new Error("Selected Rust compiler did not provide its host and sysroot identity.");
  }
  const sourceRoot = fileURLToPath(new URL("../../../../tools/rust-source-provider/src/", import.meta.url));
  const sourceFiles = ["main.rs", "request.rs", "tokens.rs", "source.rs", "definitions.rs", "inputs.rs", "evidence.rs", "effects.rs",
    "type_model.rs", "type_graph.rs", "type_regions.rs", "type_constants.rs", "type_generics.rs", "scopes.rs"];
  const hash = createHash("sha256").update(compilerIdentity).update(sysroot);
  for (const file of sourceFiles) hash.update(file).update(readFileSync(join(sourceRoot, file)));
  const binaryRoot = join(cacheRoot, "tool", hash.digest("hex"));
  const binary = join(binaryRoot, process.platform === "win32" ? "rust-source-provider.exe" : "rust-source-provider");
  let built = false;
  const ensureBuilt = (): void => {
    if (built) return;
    mkdirSync(binaryRoot, { recursive: true });
    if (!existsSync(binary)) {
      const temporary = `${binary}.${process.pid}-${randomUUID()}`;
      command(compiler, [
        "--edition=2024", "--crate-name", "tsonic_rust_source_provider", "-D", "warnings",
        "-L", `native=${join(sysroot, "lib")}`, "-C", "prefer-dynamic", "-C", "codegen-units=1",
        join(sourceRoot, "main.rs"), "-o", temporary,
      ], { ...selectedEnvironment, RUSTC_BOOTSTRAP: "1" });
      renameSync(temporary, binary);
    }
    built = true;
  };
  const executionEnvironment = (() => {
    const libraries = [join(sysroot, "lib"), join(sysroot, "lib", "rustlib", host, "lib")];
    const variable = process.platform === "win32" ? "PATH" : process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    return Object.freeze({ ...selectedEnvironment,
      [variable]: [...libraries, selectedEnvironment[variable]].filter(Boolean).join(delimiter) });
  })();
  const request = (payload: Readonly<Record<string, unknown>>): unknown => {
    ensureBuilt();
    const identity = `${process.pid}-${randomUUID()}`;
    const requestPath = join(cacheRoot, "requests", `${identity}.json`);
    const responsePath = join(cacheRoot, "responses", `${identity}.json`);
    mkdirSync(dirname(requestPath), { recursive: true });
    mkdirSync(dirname(responsePath), { recursive: true });
    const text = JSON.stringify({ protocolVersion: 1, ...payload, limits: {
      maximumRows: limits.maximumRows,
      maximumDepth: limits.maximumDepth,
      maximumOutputBytes: limits.maximumOutputBytes,
    } });
    if (Buffer.byteLength(text, "utf8") > 64 * 1024 * 1024) {
      throw new Error("Native Rust source request exceeds the byte limit.");
    }
    writeFileSync(requestPath, text, { flag: "wx" });
    command(binary, [requestPath, responsePath], executionEnvironment);
    const status = statSync(responsePath);
    if (!status.isFile() || status.size > limits.maximumOutputBytes) {
      throw new Error("Native Rust source response exceeds the byte limit or is not a file.");
    }
    const response: unknown = JSON.parse(readFileSync(responsePath, "utf8"));
    if (!isRecord(response) || response.protocolVersion !== 1) {
      throw new Error("Native Rust source response has the wrong protocol identity.");
    }
    return response;
  };
  const analyze = (phase: RustNativeSemanticEvidence["phase"], arguments_: readonly string[]): RustNativeSemanticEvidence => {
    const response = request({ kind: "analyze", phase, arguments: [compiler, "--sysroot", sysroot, ...arguments_] });
    if (!isRecord(response) || response.kind !== "evidence" || !isRecord(response.evidence)) {
      throw new Error("Native Rust source service did not return semantic evidence.");
    }
    const evidence = decodeNativeEvidence(response.evidence, limits);
    validateRustNativeEvidenceInputs(evidence);
    return evidence;
  };
  return Object.freeze({
    compilerIdentity,
    sysroot,
    tokens(source: string, edition: string): readonly RustLexicalTokenTree[] {
      return decodeNativeTokenResponse(request({ kind: "tokens", source, edition }), limits);
    },
    declarations(arguments_: readonly string[]): RustNativeDeclarationEvidence {
      const evidence = analyze("declarations", arguments_);
      if (evidence.phase !== "declarations") throw new Error("Native Rust source service did not return declaration evidence.");
      return evidence;
    },
    check(arguments_: readonly string[]): RustNativeEvidence {
      const evidence = analyze("checked", arguments_);
      if (evidence.phase !== "checked") throw new Error("Native Rust source service did not return checked evidence.");
      return evidence;
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
