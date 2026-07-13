import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = join(repositoryRoot, "src");

function collectFiles(root, extension) {
  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      if (statSync(fullPath).isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (fullPath.endsWith(extension)) {
        results.push(fullPath);
      }
    }
  };
  visit(root);
  return results;
}

const sourceFiles = collectFiles(sourceRoot, ".ts").map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

function sourceSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker ${startMarker}`);
  assert.ok(end > start, `missing source marker ${endMarker} after ${startMarker}`);
  return text.slice(start, end);
}

test("no internal TSTS imports", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /from "@tsonic\/tsts\/.+"/u, `${path} imports a deep tsts path`);
    assert.doesNotMatch(text, /dist\/src\/internal/u, `${path} references tsts internals`);
  }
});

test("no source-name target guessing in the backend", () => {
  const bannedTokens = ['"node:', '"@acme', "readText", "readFileSync", '"homeDir"', '"Math"', '"console"', '"push"', '"readFile"'];
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    for (const token of bannedTokens) {
      assert.ok(!text.includes(token), `${path} contains banned source-name token ${token}`);
    }
  }
});

test("no C# target references in Rust target code", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /csharp|roslyn|dotnet/iu, `${path} references the C# target`);
  }
});

test("no embedded JS engine or runtime interpretation dependencies", () => {
  const packageJson = readFileSync(join(repositoryRoot, "package.json"), "utf8");
  const banned = /quickjs|rquickjs|boa_engine|deno_core|"v8"/iu;
  assert.doesNotMatch(packageJson, banned);
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, banned, `${path} references an embedded JS engine`);
  }
});

test("no runtime crate code inside tsonic-rust", () => {
  const rustFiles = collectFiles(sourceRoot, ".rs");
  assert.deepEqual(rustFiles, [], "tsonic-rust src must not contain Rust runtime sources");
  assert.throws(() => statSync(join(repositoryRoot, "crates")), /ENOENT/u);
});

test("no product dependency on analysis files", () => {
  for (const { path, text } of sourceFiles) {
    assert.ok(!text.includes(".analysis/") && !text.includes('".analysis"'), `${path} references .analysis`);
  }
});

test("no Node-as-surface registration", async () => {
  const { createRustTargetPack } = await import("../../dist/index.js");
  const pack = createRustTargetPack();
  for (const surface of pack.surfaces ?? []) {
    assert.notEqual(surface.id, "node");
    assert.notEqual(surface.id, "nodejs");
  }
});

test("no fallback source emission: backend diagnostics never coexist with artifacts", () => {
  // Structural rule enforced in planRustArtifacts: every early return with
  // diagnostics returns an empty artifact list. Verified behaviorally in the
  // negative-lane tests; here we pin the source pattern.
  const plannerText = readFileSync(join(sourceRoot, "backend/planner/rust-planner.ts"), "utf8");
  assert.match(plannerText, /if \(diagnostics\.length > 0\) \{\s*return \{ artifacts: \[\], diagnostics \};/u);
});

test("JS operation rows are unique per owner/member/kind/lane", async () => {
  const source = readFileSync(join(sourceRoot, "source/rust-target-semantics/js-surface-operations.ts"), "utf8");
  const rowPattern = /owner: "([^"]+)", member: "([^"]+)", operationKind: "([^"]+)", lane: "([^"]+)"/gu;
  const seen = new Set();
  let match;
  while ((match = rowPattern.exec(source)) !== null) {
    const key = match.slice(1, 5).join("|");
    assert.ok(!seen.has(key), `duplicate JS operation row: ${key}`);
    seen.add(key);
  }
  assert.ok(seen.size > 20, "row scan should see the operation table");
});

test("rust target product source has no NodeJS capability coupling", () => {
  const forbidden = [/tsonic_rust_node/u, /rust\.node\./u, /createRustNodejsProviderPackage/u, /\bnodejs\b/iu, /"node:(?:fs|os|path|url|crypto|util|buffer|process)/u];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) {
        continue;
      }
      // The compiler's own platform imports (from "node:path") are the
      // build platform, not target knowledge.
      const text = readFileSync(full, "utf8").replace(/from "node:[a-z/]+"/gu, "");
      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          offenders.push(`${full}: ${String(pattern)}`);
        }
      }
    }
  };
  walk(sourceRoot);
  assert.deepEqual(offenders, []);
});

test("provider and library identity never flows through local-name recasing", () => {
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const providerLowering = expressions.slice(
    expressions.indexOf("function refShape"),
    expressions.indexOf("function planCallExpression"),
  );
  assert.ok(providerLowering.includes("function planProviderOperationExpression"), "slice covers provider lowering");
  assert.ok(!providerLowering.includes("rustLocalBindingName"), "provider operation lowering must emit row metadata verbatim");
  for (const file of ["source/rust-target-semantics/js-surface-operations.ts", "source/provider-packages/index.ts"]) {
    const text = readFileSync(join(sourceRoot, file), "utf8");
    assert.ok(!text.includes("rustLocalBindingName"), `${file} must not recase identities`);
  }
});

test("selected source operation identity is never reconstructed through checker queries", () => {
  const semanticRoot = join(sourceRoot, "source/rust-target-semantics");
  const semanticFiles = collectFiles(semanticRoot, ".ts").map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const forbidden = [
    /getResolvedSignature\s*\(/u,
    /getPropertyOfType\s*\(/u,
    /getTypeFromTypeNode\s*\(/u,
    /\bsafeGet[A-Z][A-Za-z0-9_]*\s*\(/u,
    /\.TypeArguments\b/u,
    /\.Text\b/u,
    /\b(?:sourceUsage|sourceMemberNames|TargetSourceUsageHints)\b/u,
    /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:undefined|false)\s*;/u,
  ];
  for (const { path, text } of semanticFiles) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${path} contains forbidden selected-evidence reconstruction ${pattern}`);
    }
  }

  const allowed = new Set([
    "index.ts|stringParamOnlyBorrows|getSymbolAtLocation",
    "index.ts|resolveIdentifierCarrier|getSymbolAtLocation",
    "index.ts|resolveIdentifierCarrier|getSymbolValueDeclaration",
    "index.ts|resolveIdentifierCarrier|getPrimarySymbolDeclaration",
    "index.ts|recordBindingWrite|getResolvedSymbolOrNil",
    "index.ts|recordBindingWrite|getSymbolValueDeclaration",
    "index.ts|recordBindingWrite|getPrimarySymbolDeclaration",
    "index.ts|recordBindingWrite|getSymbolDeclarations",
    "target-type-resolution.ts|resolveRustTargetTypeRef|getTypeAtLocation",
    "target-type-resolution.ts|resolveRustTargetTypeSyntax|getSymbolAtLocation",
    "target-type-resolution.ts|resolveRustTargetTypeSyntax|getPrimarySymbolDeclaration",
    "target-type-resolution.ts|resolveReferencedDeclarationType|getSymbolAtLocation",
    "target-type-resolution.ts|resolveReferencedDeclarationType|getSymbolDeclarations",
    "target-type-resolution.ts|resolveRustTargetType|getTypeAliasSymbol",
    "target-type-resolution.ts|resolveRustTargetType|getTypeSymbol",
    "target-type-resolution.ts|resolveSourcePrimitive|getTypeAliasSymbol",
    "target-type-resolution.ts|resolveSourcePrimitive|getTypeSymbol",
    "target-type-resolution.ts|resolveSourcePrimitive|getSymbolDeclarations",
    "target-type-resolution.ts|resolveProviderTypeIdentity|getSymbolDeclarations",
    "target-type-resolution.ts|resolveOwnedSourceProfileTypeName|getSymbolDeclarations",
    "target-type-resolution.ts|resolveProjectSourceCarrier|getSymbolDeclarations",
  ]);
  const observed = new Set();
  for (const { path, text } of semanticFiles) {
    const functions = [...text.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/gu)];
    for (const match of text.matchAll(/\b(?:context\.compiler\.)?checker\.([A-Za-z0-9_]+)\s*\(/gu)) {
      const owner = functions.filter((candidate) => candidate.index < match.index).at(-1)?.[1] ?? "<module>";
      const key = `${path.slice(path.lastIndexOf("/") + 1)}|${owner}|${match[1]}`;
      assert.ok(allowed.has(key), `unclassified checker query: ${key}`);
      observed.add(key);
    }
  }
  assert.deepEqual([...observed].sort(), [...allowed].sort());
});

test("raw compiler object fields and source-use scans never become semantic input", () => {
  const productFiles = sourceFiles.filter(({ path }) =>
    path.includes("/source/") || path.includes("/backend/"));
  const forbidden = [
    /\.TypeArguments\b/u,
    /\.Text\b/u,
    /\[\s*["']TypeArguments["']\s*\]/u,
    /\[\s*["']Text["']\s*\]/u,
    /\b(?:sourceUsage|sourceMemberNames|TargetSourceUsageHints|collectProjectSourceUsageHints)\b/u,
  ];
  for (const { path, text } of productFiles) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${path} contains forbidden raw semantic input ${pattern}`);
    }
  }
});

test("provider operation selection uses exact provider identities, never names", () => {
  const text = readFileSync(join(sourceRoot, "source/rust-target-semantics/provider-operation-selection.ts"), "utf8");
  assert.match(text, /row\.exportId === identity\.exportId/u);
  assert.match(text, /row\.memberId === identity\.memberId/u);
  assert.match(text, /row\.signatureId === identity\.signatureId/u);
  assert.doesNotMatch(text, /moduleSpecifier|exportName|memberName|sourceName|targetName/u);
});

test("provider parameter passing is metadata-derived and backend-gated", () => {
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/operations-provider.ts"), "utf8");
  const selectedCall = sourceSection(
    semantics,
    "function acceptSelectedCall(",
    "function selectedCallParameterCarriers(",
  );
  assert.match(selectedCall, /rustSourceArgumentModes\(fact\.target, selectedParameterCarriers\.length\)/u);
  assert.match(selectedCall, /passingMode: rustArgumentPassingMode\(/u);
  assert.doesNotMatch(selectedCall, /passingMode:\s*["']by-value["']/u);

  const backend = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const callPlanner = sourceSection(backend, "function planCallExpression(", "function requireProviderArgumentPassingFacts(");
  assert.match(callPlanner, /requireProviderArgumentPassingFacts\(context, fact, providerArgumentNodes\)/u);
  const passingGate = sourceSection(backend, "function requireProviderArgumentPassingFacts(", "function planRegExpCreate(");
  assert.match(passingGate, /getArgumentPassingFact\(argument\)/u);
  assert.match(passingGate, /if \(actual === undefined\)/u);
  assert.match(passingGate, /if \(actual\.mode !== expected\)/u);
  assert.match(passingGate, /missingFactDiagnostic/u);
});

test("optional chains fail closed before normal member selection", () => {
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/operations-provider.ts"), "utf8");
  const property = sourceSection(
    semantics,
    "function mapRustCheckedPropertyAccess(",
    "function mapRustCheckedElementAccess(",
  );
  const element = sourceSection(
    semantics,
    "function mapRustCheckedElementAccess(",
    "function mapRustCheckedIteration(",
  );
  for (const [kind, section] of [["property", property], ["element", element]]) {
    assert.match(section, /if \(request\.optionalChain === true\) \{\s*return rejectSelectedOperation\([^;]+"RUST_OPTIONAL_CHAIN_UNSUPPORTED"/su, `${kind} optional chains must reject`);
    assert.ok(
      section.indexOf("request.optionalChain") < section.indexOf("resolveSelectedProviderDeclaration"),
      `${kind} optional chains must reject before provider selection`,
    );
  }
  for (const { path, text } of sourceFiles) {
    if (path.includes("/backend/")) {
      assert.doesNotMatch(text, /optionalChain/u, `${path} infers optional-chain semantics in the backend`);
    }
  }
});

test("plain identifier binding cannot become a provider-value identity workaround", () => {
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/index.ts"), "utf8");
  const resolver = sourceSection(semantics, "function resolveIdentifierCarrier(", "function resolveCallLikeCarrier(");
  assert.match(resolver, /declarationKind === KindParameter \|\| declarationKind === KindVariableDeclaration/u);
  assert.doesNotMatch(resolver, /providerVirtualDeclarationFactKey|ImportSpecifier|ImportClause|moduleSpecifier|exportName/u);
});

test("type-shape queries are confined to closed target type resolution", () => {
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/source/rust-target-semantics/") || path.endsWith("/target-type-resolution.ts")) {
      continue;
    }
    assert.doesNotMatch(text, /\btypeShape\./u, `${path} re-queries source type shape outside target type resolution`);
  }
});

test("compiler Type objects are never treated as source-alias fact identity", () => {
  const text = readFileSync(join(sourceRoot, "source/rust-target-semantics/target-type-resolution.ts"), "utf8");
  assert.doesNotMatch(text, /factResolver\.resolve\(type,\s*runtimeCarrierFactKey\)/u);
  assert.doesNotMatch(text, /factResolver\.resolve\(type,\s*sourcePrimitiveFactKey\)/u);
});

test("backend and provider metadata layers never query the TypeScript checker", () => {
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/") && !path.includes("/source/provider-packages/")) {
      continue;
    }
    assert.doesNotMatch(text, /\bchecker\.[A-Za-z0-9_]+\s*\(/u, `${path} queries the checker`);
  }
});

test("provider-backed backend lanes require finalized operation facts", () => {
  const text = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const lanes = [
    ["constructor", "function planNewExpression(", "function planPropertyAccess("],
    ["property", "function planPropertyAccess(", "function planElementAccess("],
    ["indexer", "function planElementAccess(", "function applyResultCast("],
  ];
  for (const [lane, start, end] of lanes) {
    const section = sourceSection(text, start, end);
    assert.match(section, /rustOperationFact\(node, context\)/u, `${lane} must read the finalized Rust operation fact`);
    assert.match(section, /missingFactDiagnostic/u, `${lane} must diagnose a missing finalized fact`);
    assert.doesNotMatch(section, /selectedTargetSignatureFactKey|providerVirtualDeclarationFactKey/u, `${lane} must not recover provider identity in the backend`);
  }
});

test("backend conversion planning never reconstructs assertion kinds from source syntax", () => {
  const text = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  assert.doesNotMatch(text, /isConstAssertion|TypeReferenceNode_TypeName/u);
  assert.match(text, /fact\.kind !== "source-conversion"/u);
});

test("backend assignment and nullish checks consume finalized fact details", () => {
  const statements = readFileSync(join(sourceRoot, "backend/planner/statements.ts"), "utf8");
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  assert.match(statements, /runtimeSet\.kind !== "operator-token" \|\| runtimeSet\.operator !== "="/u);
  assert.match(expressions, /fact\.optionOperand === "left" \? leftNode : rightNode/u);
  assert.doesNotMatch(expressions, /getRuntimeCarrierFact\(leftNode\)/u);
});

test("provider operation metadata contains only structured Rust forms", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /\btrailingArgs\b/u, `${path} uses legacy raw trailing arguments`);
    assert.doesNotMatch(text, /\breceiverTypeId\b/u, `${path} uses receiver identity guessing`);
  }
});
