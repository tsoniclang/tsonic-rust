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
      const namespaceFunction = line.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
      const namespaceValue = line.match(/^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/);
      const method = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*\([^;{}]*\)\s*[:;]/);
      const property = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/);
      const indexer = line.match(/^\[([^\]]+)\]\s*:/);
      const constructor = line.match(/^constructor\s*\(/);
      if (container && namespaceFunction) {
        rows.push(row({ moduleName, kind: "namespace-function", name: namespaceFunction[1], memberOf, sourceFile, lineNumber, signature: compact(line) }));
      } else if (container && namespaceValue) {
        const valueKind = namespaceValue[1] === "let" || namespaceValue[1] === "var" ? "namespace-const" : "namespace-const";
        rows.push(row({ moduleName, kind: valueKind, name: namespaceValue[2], memberOf, sourceFile, lineNumber, signature: compact(line) }));
      } else if (method) {
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
  const normalized = file.replace(/\.d\.ts$/, "");
  if (normalized.includes("/")) return normalized.replace(/\/index$/, "");
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
  const searchText = `${module} ${fullName} ${signature}`;
  const lowerSearchText = searchText.toLowerCase();

  const hardRejectModules = new Set(["vm", "inspector", "inspector.generated", "test", "repl", "wasi", "v8", "trace_events", "sea"]);
  if (hardRejectModules.has(module)) return { phase: "hard-reject", reason: "dynamic evaluator, inspector, test runner, V8 internals, or host introspection surface" };
  if (module === "quic") return { phase: "hard-reject", reason: "experimental specialized transport outside approved framework-ready Phase 1" };

  if (module === "module") {
    if (/createrequire|builtinmodules|findpackagejson|registerhooks|striptypescript|sourcemap|module\.syncbuiltin|module\.findpackage|module\.registerhooks/i.test(searchText)) {
      return { phase: "phase1", reason: "safe package/tooling helper without dynamic JS evaluation" };
    }
    return { phase: "hard-reject", reason: "dynamic module loader or evaluation hook outside closed runtime architecture" };
  }

  if (module === "cluster") return { phase: "phase1", reason: "closed primary/worker process orchestration over approved file-spawn model" };
  if (module === "dgram") return { phase: "phase1", reason: "UDP datagram socket runtime over std net" };
  if (module === "sqlite") return { phase: "phase1", reason: "closed node:sqlite DatabaseSync subset over approved bundled SQLite dependency" };
  if (module === "domain") return { phase: "hard-reject", reason: "deprecated async domain model excluded; AsyncLocalStorage is the supported substrate" };
  if (module === "async_context") return { phase: "hard-reject", reason: "emerging async context surface beyond selected AsyncLocalStorage contract" };

  if (module === "child_process") {
    if (/spawn|execfile|exec|fork|childprocess|subprocess|stdio|send|kill|disconnect|pid|exitcode|signalcode/i.test(searchText)) {
      return { phase: "phase1", reason: "capability-gated process contract required by common CLI and build tooling" };
    }
    return { phase: "hard-reject", reason: "less common child_process declaration outside closed file-spawn process contract" };
  }

  if (module === "worker_threads") {
    if (/worker|messagechannel|messageport|broadcastchannel|parentport|workerdata|threadid|markasuntransferable|istransferable|receiveMessageOnPort/i.test(searchText)) {
      return { phase: "phase1", reason: "capability-gated worker/message channel substrate required by common tooling" };
    }
    return { phase: "hard-reject", reason: "advanced worker_threads declaration outside closed worker/message-channel contract" };
  }

  const frameworkReadyModules = new Set([
    "assert",
    "async_hooks",
    "buffer",
    "console",
    "crypto",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "timers",
    "timers/promises",
    "tls",
    "tty",
    "url",
    "util",
    "util/types",
    "zlib",
  ]);

  if (module === "fs" || module === "fs/promises") {
    if (/watch|watchfile|unwatchfile|fswatcher|statfs|opendir|dirent|filehandle|readstream|writestream|createReadStream|createWriteStream/i.test(searchText)) {
      return { phase: "phase1", reason: "common filesystem object, watcher, directory, stream, or file-handle surface" };
    }
    return { phase: "phase1", reason: "framework-ready filesystem sync, callback, or promise API" };
  }

  if (module === "crypto") {
    if (/x509|certificate|diffie|ecdh|cipher|decipher|hkdf|pbkdf|scrypt|rsa|dsa|ed25519|ed448|x25519|x448|subtle|cryptokey|jwk|keypair|secureheap/i.test(searchText)) {
      return { phase: "phase1", reason: "approved dependency-backed crypto operation group or explicit closed crypto type surface" };
    }
    return { phase: "phase1", reason: "common hash, HMAC, random, UUID, timing-safe, sign/verify, or practical WebCrypto surface" };
  }

  if (module === "globals") {
    if (/fetch|request|response|headers|formdata|blob|file|abortcontroller|abortsignal|textencoder|textdecoder|readablestream|writablestream|transformstream|url|urlsearchparams|domexception/i.test(searchText)) {
      return { phase: "phase1", reason: "Web runtime global required by modern Node frameworks and SDKs" };
    }
    return { phase: "hard-reject", reason: "ambient global declaration outside selected Web/Node runtime substrate" };
  }

  if (module === "node") return { phase: "hard-reject", reason: "package-level typing helper, not a user-facing runtime operation group" };
  if (frameworkReadyModules.has(module)) {
    if (module === "process" && /permission|report|binding|_debug|dlopen|setSourceMapsEnabled/i.test(searchText)) {
      return { phase: "hard-reject", reason: "process host introspection or dynamic native loading surface" };
    }
    if (module === "fs" && /glob/i.test(lowerSearchText)) {
      return { phase: "hard-reject", reason: "filesystem glob engine excluded from runtime externals" };
    }
    if (module === "fs" && /cp\(|cpsync/i.test(lowerSearchText)) {
      return { phase: "phase1", reason: "framework-ready filesystem recursive copy API" };
    }
    if (module === "zlib" && /brotli/i.test(searchText)) {
      return { phase: "phase1", reason: "approved Brotli compression dependency-backed operation group" };
    }
    return { phase: "phase1", reason: "framework-ready documented Node runtime operation group" };
  }

  if (/^web-globals|^web$|abort|domexception|fetch|undici/i.test(module)) {
    return { phase: "phase1", reason: "modern Web global substrate used by Node frameworks and SDKs" };
  }

  return { phase: "hard-reject", reason: "not selected for framework-ready Phase 1 runtime surface" };
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
