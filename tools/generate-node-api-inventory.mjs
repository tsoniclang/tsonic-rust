#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const candidateRoots = [
  process.env.TSONIC_NODE_TYPES_ROOT,
  "/home/jeswin/repos/tsoniclang/tsonic/node_modules/@types/node",
  "/home/jeswin/repos/tsoniclang/tsts/node_modules/@types/node",
].filter(Boolean);

const typesRoot = candidateRoots.find((root) => existsSync(join(root, "package.json")));
if (!typesRoot) {
  throw new Error(`Unable to find @types/node. Tried: ${candidateRoots.join(", ")}`);
}

const packageJson = JSON.parse(readFileSync(join(typesRoot, "package.json"), "utf8"));
const outPath = process.argv[2] ?? "tests/capabilities/node_api_full_inventory.csv";
const files = collectFiles(typesRoot)
  .filter((file) => file.endsWith(".d.ts"))
  .filter((file) => !file.includes("/compatibility/"))
  .filter((file) => !file.includes("/ts5."))
  .sort();

const rows = [];
for (const file of files) {
  const sourceFile = relative(typesRoot, file).replaceAll("\\", "/");
  const moduleName = moduleNameFromFile(sourceFile);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const stack = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) {
      updateStack(stack, rawLine);
      continue;
    }

    const container = currentContainer(stack);
    const exportMatch = line.match(/^export\s+(?:declare\s+)?(function|class|interface|const|let|var|namespace|enum|type)\s+([A-Za-z_$][\w$]*)/);
    if (exportMatch) {
      const kind = exportMatch[1] === "let" || exportMatch[1] === "var" ? "const" : exportMatch[1];
      const name = exportMatch[2];
      rows.push(row({ moduleName, kind: `export-${kind}`, name, memberOf: "", sourceFile, lineNumber, signature: compact(line) }));
    }

    const declareModuleMatch = line.match(/^declare\s+module\s+["']([^"']+)["']/);
    if (declareModuleMatch) {
      rows.push(row({ moduleName: declareModuleMatch[1], kind: "module", name: declareModuleMatch[1], memberOf: "", sourceFile, lineNumber, signature: compact(line) }));
    }

    if (isPublicMemberLine(line)) {
      const memberOf = container?.name ?? "inline-type-literal";
      const method = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*\([^;{}]*\)\s*[:;]/);
      const property = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/);
      const indexer = line.match(/^\[([^\]]+)\]\s*:/);
      const constructor = line.match(/^constructor\s*\(/);
      if (method) {
        rows.push(row({ moduleName, kind: container ? "method" : "inline-method", name: method[1], memberOf, sourceFile, lineNumber, signature: compact(line) }));
      } else if (property) {
        rows.push(row({ moduleName, kind: container ? "property" : "inline-property", name: property[1], memberOf, sourceFile, lineNumber, signature: compact(line) }));
      } else if (indexer) {
        rows.push(row({ moduleName, kind: container ? "indexer" : "inline-indexer", name: `[${indexer[1]}]`, memberOf, sourceFile, lineNumber, signature: compact(line) }));
      } else if (constructor) {
        rows.push(row({ moduleName, kind: "constructor", name: "constructor", memberOf, sourceFile, lineNumber, signature: compact(line) }));
      }
    }

    const containerMatch = line.match(/^(?:export\s+)?(?:declare\s+)?(class|interface|namespace)\s+([A-Za-z_$][\w$]*)/);
    updateStack(stack, rawLine, containerMatch ? { kind: containerMatch[1], name: containerMatch[2] } : undefined);
  }
}

const unique = new Map();
for (const item of rows) {
  const key = [item.module, item.kind, item.memberOf, item.name, item.signature, item.sourceFile, item.line].join("\u0000");
  unique.set(key, item);
}
const finalRows = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, toCsv(finalRows));
console.log(JSON.stringify({ typesRoot, typesVersion: packageJson.version, rows: finalRows.length, outPath }, null, 2));

function collectFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else result.push(path);
    }
  }
  return result;
}

function moduleNameFromFile(file) {
  const name = basename(file, ".d.ts");
  if (name === "index") return "node";
  if (name === "globals" || name === "globals.typedarray") return "globals";
  if (name.startsWith("buffer.")) return "buffer";
  if (name.includes(".")) return name.split(".")[0];
  return name;
}

function updateStack(stack, rawLine, opened) {
  if (opened && rawLine.includes("{")) {
    stack.push({ ...opened, depth: 1 });
  }
  if (stack.length === 0) return;
  let opens = count(rawLine, "{");
  let closes = count(rawLine, "}");
  if (opened && rawLine.includes("{")) opens -= 1;
  for (const item of stack) item.depth += opens - closes;
  while (stack.length > 0 && stack[stack.length - 1].depth <= 0) stack.pop();
}

function currentContainer(stack) {
  return stack.length ? stack[stack.length - 1] : undefined;
}

function count(text, needle) {
  return [...text].filter((ch) => ch === needle).length;
}

function isPublicMemberLine(line) {
  return !line.startsWith("private ")
    && !line.startsWith("protected ")
    && !line.startsWith("export ")
    && !line.startsWith("declare ")
    && !line.startsWith("type ")
    && !line.startsWith("interface ")
    && !line.startsWith("class ")
    && !line.startsWith("namespace ")
    && !line.startsWith("}");
}

function compact(line) {
  return line.replace(/\s+/g, " ").replace(/,$/, "").trim();
}

function row({ moduleName, kind, name, memberOf, sourceFile, lineNumber, signature }) {
  const phase = classifyPhase(moduleName, kind, name, memberOf, signature);
  const id = stableId(moduleName, kind, memberOf, name, sourceFile, lineNumber);
  return { id, module: moduleName, kind, memberOf, name, phase: phase.phase, reason: phase.reason, sourceFile, line: String(lineNumber), signature };
}

function classifyPhase(moduleName, kind, name, memberOf, signature) {
  const module = moduleName.replace(/^node:/, "");
  const lowerSig = signature.toLowerCase();
  const fullName = memberOf ? `${memberOf}.${name}` : name;

  const hardRejectModules = new Set(["vm", "inspector", "inspector.generated", "test", "repl", "wasi", "v8", "trace_events", "module", "sea", "quic"]);
  if (hardRejectModules.has(module)) return { phase: "hard-reject", reason: "runtime loader, VM, inspector, test runner, or host-specific machinery" };
  if (["child_process", "cluster", "worker_threads"].includes(module)) return { phase: "hard-reject", reason: "process/thread spawning is outside closed generated runtime" };

  const laterModules = new Set(["http", "http2", "https", "net", "tls", "dgram", "dns", "stream", "events", "readline", "sqlite", "zlib", "async_hooks", "async_context", "diagnostics_channel", "domain", "timers"]);
  if (laterModules.has(module)) return { phase: "later", reason: "important Node subsystem requiring event loop, networking, async runtime, or approved dependency design" };

  if (module === "fs" || module === "fs/promises") {
    if (module === "fs/promises" || lowerSig.includes("promise") || lowerSig.includes("callback") || name.endsWith("Stream") || name === "watch" || name === "watchFile" || name === "unwatchFile") {
      return { phase: "later", reason: "async, promise, stream, or watcher fs API" };
    }
    if (name.endsWith("Sync") || ["Stats", "Dirent", "ReadStream", "WriteStream", "PathLike", "NoParamCallback"].includes(name)) {
      return { phase: "phase1", reason: "high-use synchronous filesystem API or supporting shape" };
    }
    return { phase: "later", reason: "non-sync fs API" };
  }

  if (module === "crypto") {
    if (/cipher|decipher|key|certificate|x509|sign|verify|diffie|ecdh|secure|webcrypto|subtle|hkdf|pbkdf|scrypt|rsa|dsa|ed25519/i.test(fullName + " " + signature)) {
      return { phase: "later", reason: "broad crypto/key/cipher API needs dependency and security design" };
    }
    return { phase: "phase1", reason: "common hash, hmac, random, uuid, or digest API" };
  }

  const phase1Modules = new Set(["assert", "buffer", "console", "os", "path", "perf_hooks", "process", "punycode", "querystring", "string_decoder", "tty", "url", "util"]);
  if (phase1Modules.has(module)) {
    if (module === "process" && /stdin|stdout|stderr|on\(|emit\(|nexttick|channel|permission/i.test(fullName + " " + signature)) {
      return { phase: "later", reason: "process stream, event, or permission API" };
    }
    if (module === "util" && /promisify|callbackify|debuglog|parseargs|mime|transferable|aborted/i.test(fullName + " " + signature)) {
      return { phase: "later", reason: "utility API requiring callback, debug, MIME, abort, or transfer design" };
    }
    return { phase: "phase1", reason: "common closed Node runtime API" };
  }

  if (module === "globals") return { phase: "later", reason: "ambient global declaration, not direct node module runtime API" };
  if (module === "node") return { phase: "later", reason: "package-level typing helper" };
  return { phase: "later", reason: "not selected for Phase 1 until usage-driven implementation" };
}

function stableId(moduleName, kind, memberOf, name, sourceFile, lineNumber) {
  const raw = `${moduleName}:${kind}:${memberOf}:${name}:${sourceFile}:${lineNumber}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `NODEAPI-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toCsv(items) {
  const header = ["id", "module", "kind", "memberOf", "name", "phase", "reason", "sourceFile", "line", "signature"];
  return [header, ...items.map((item) => header.map((key) => item[key]))]
    .map((fields) => fields.map(csv).join(","))
    .join("\n") + "\n";
}

function csv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
