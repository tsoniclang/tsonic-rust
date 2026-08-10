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

test("Rust target-type validation and equality have one policy owner", () => {
  const owners = sourceFiles.filter(({ text }) =>
    /export function (?:isRustTargetTypeRef|rustTargetTypeRefEquals)\b/u.test(text));
  assert.deepEqual(
    owners.map(({ path }) => path.slice(sourceRoot.length + 1)),
    ["policy/equality.ts"],
  );
  const carrierHelpers = readFileSync(join(sourceRoot, "source/rust-target-types.ts"), "utf8");
  assert.doesNotMatch(carrierHelpers, /export function (?:isRustTargetTypeRef|rustTargetTypeRefEquals)\b/u);
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

test("Cargo registry patches require explicit runtime-reference provenance", () => {
  const planner = readFileSync(join(sourceRoot, "backend/planner/cargo-project.ts"), "utf8");
  const printer = readFileSync(join(sourceRoot, "print/cargo-manifest-printer.ts"), "utf8");
  const descriptor = readFileSync(join(sourceRoot, "descriptor/rust-target-pack.ts"), "utf8");
  assert.match(planner, /registryPatch !== undefined && registryPatch !== cargoCratesIoRegistry/u);
  assert.match(printer, /dependencies\.filter\(\(dependency\) => dependency\.registryPatch === "crates-io"\)/u);
  assert.match(descriptor, /\[cargoRegistryPatchAttributeName\]: cargoCratesIoRegistry/u);
  const patchSection = printer.slice(printer.indexOf('"[patch.crates-io]"'));
  assert.doesNotMatch(patchSection, /for \(const dependency of manifest\.dependencies\)/u);
});

test("target builds delete stale dist artifacts before compilation", () => {
  const build = readFileSync(join(repositoryRoot, "scripts/build.sh"), "utf8");
  const cleaner = readFileSync(join(repositoryRoot, "scripts/clean-dist.mjs"), "utf8");
  assert.match(build, /node "\$REPO_ROOT\/scripts\/clean-dist\.mjs"/u);
  assert.match(cleaner, /manifest\.name !== "@tsonic\/target-rust"/u);
  assert.match(cleaner, /rmSync\(resolve\(repositoryRoot, "dist"\), \{ recursive: true, force: true \}\)/u);
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

test("JS operation rows are unique per owner/member/kind/lane/variant", async () => {
  const source = readFileSync(join(sourceRoot, "source/rust-target-semantics/js-surface-operations.ts"), "utf8");
  const rowPattern = /owner: "([^"]+)", member: "([^"]+)", operationKind: "([^"]+)", lane: "([^"]+)"(?:, variant: "([^"]+)")?/gu;
  const baseCounts = new Map();
  const seen = new Set();
  let match;
  while ((match = rowPattern.exec(source)) !== null) {
    const baseKey = match.slice(1, 5).join("|");
    const variant = match[5] ?? "";
    const key = `${baseKey}|${variant}`;
    assert.ok(!seen.has(key), `duplicate JS operation row: ${key}`);
    seen.add(key);
    baseCounts.set(baseKey, (baseCounts.get(baseKey) ?? 0) + 1);
  }
  for (const [baseKey, count] of baseCounts) {
    if (count <= 1) {
      continue;
    }
    const variants = [...seen]
      .filter((key) => key.startsWith(`${baseKey}|`))
      .map((key) => key.slice(baseKey.length + 1));
    assert.ok(variants.every((variant) => variant.length > 0), `multi-row JS operation lacks a variant: ${baseKey}`);
    assert.equal(new Set(variants).size, count, `duplicate JS operation variant: ${baseKey}`);
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

test("source profile identity comes from the registered compiler SourceFile, never a path substring", () => {
  for (const file of [
    "source/rust-target-semantics/selected-evidence.ts",
    "source/rust-target-semantics/target-type-resolution.ts",
  ]) {
    const text = readFileSync(join(sourceRoot, file), "utf8");
    assert.doesNotMatch(text, /source-profiles|tsonicSourceProfileVirtualDirectory|normalizeTargetSourceProfileSegment/u, `${file} reconstructs source-profile ownership from a path`);
  }
  const registry = readFileSync(join(sourceRoot, "source/rust-target-semantics/source-profile-registry.ts"), "utf8");
  assert.doesNotMatch(registry, /\.includes\s*\(/u);
  assert.match(registry, /sourceFileByProfile\.get\(profile\) === sourceFile/u);
  assert.match(registry, /ambiguousProfiles\.add\(profile\)/u);
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
    "target-type-resolution.ts|resolveRustTargetTypeSyntax|getAuthoredTypeFactSubjects",
    "target-type-resolution.ts|resolveRustTargetTypeSyntax|getSymbolAtLocation",
    "target-type-resolution.ts|resolveRustTargetTypeSyntax|getPrimarySymbolDeclaration",
    "target-type-resolution.ts|resolveReferencedDeclarationType|getSymbolAtLocation",
    "target-type-resolution.ts|resolveReferencedDeclarationType|getSymbolDeclarations",
    "target-type-resolution.ts|sourceParameterTypeIsReadonlyArray|getSymbolAtLocation",
    "target-type-resolution.ts|resolveRustTargetType|getTypeAliasSymbol",
    "target-type-resolution.ts|resolveRustTargetType|getTypeSymbol",
    "target-type-resolution.ts|resolveSourcePrimitive|getTypeAliasSymbol",
    "target-type-resolution.ts|resolveSourcePrimitive|getTypeSymbol",
    "target-type-resolution.ts|resolveSourcePrimitive|getSymbolDeclarations",
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

test("runtime source classification uses compiler declaration-file facts", () => {
  for (const file of [
    "translate/context.ts",
    "backend/planner/rust-planner.ts",
    "source/rust-target-semantics/index.ts",
    "source/rust-target-semantics/operations-provider.ts",
    "source/rust-target-semantics/selected-evidence.ts",
    "source/rust-target-semantics/source-type-registry.ts",
  ]) {
    const text = readFileSync(join(sourceRoot, file), "utf8");
    assert.doesNotMatch(text, /endsWith\(["']\.d\.ts["']\)/u, `${file} infers declaration-file status from a suffix`);
  }
  const context = readFileSync(join(sourceRoot, "translate/context.ts"), "utf8");
  assert.match(context, /ast\.isDeclarationFile\(sourceFile\)/u);
});

test("project-source calls trust the exact TSTS-selected declaration rather than reconstructing alias identity", () => {
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/operations-provider.ts"), "utf8");
  assert.match(semantics, /if \(sourceDeclaration === undefined && calleeDeclaration !== undefined\)/u);
  assert.match(semantics, /acceptProjectSourceCall\(request, sourceDeclaration/u);
  assert.doesNotMatch(semantics, /projectCallDeclarationsCorroborate|RUST_SELECTED_PROJECT_EVIDENCE_CONFLICT/u);
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
  assert.match(text, /row\.providerId === identity\.providerId/u);
  assert.match(text, /row\.providerVersion === identity\.providerVersion/u);
  assert.match(text, /row\.providerModuleId === identity\.providerModuleId/u);
  assert.match(text, /row\.moduleSpecifier === identity\.moduleSpecifier/u);
  assert.doesNotMatch(text, /exportName|memberName|sourceName|targetName/u);
});

test("provider parameter passing is metadata-derived and backend-gated", () => {
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/operations-provider.ts"), "utf8");
  const selectedCall = sourceSection(
    semantics,
    "function acceptSelectedCall(",
    "function selectedCallSourceCarriers(",
  );
  assert.match(selectedCall, /fact\.abi\.sourceArguments\.map/u);
  assert.match(selectedCall, /passingMode: rustArgumentPassingMode\(argument\.mode\)/u);
  assert.doesNotMatch(selectedCall, /passingMode:\s*["']by-value["']/u);
  assert.doesNotMatch(semantics, /rustSourceArgumentModes/u);

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
    "export function selectRustCheckedPropertyAccess(",
    "export function selectRustCheckedElementAccess(",
  );
  const element = sourceSection(
    semantics,
    "export function selectRustCheckedElementAccess(",
    "export function selectRustCheckedIteration(",
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
  const resolver = sourceSection(semantics, "function resolveIdentifierCarrier(", "function isImportBindingDeclarationKind(");
  assert.match(resolver, /declarationKind === KindParameter \|\| declarationKind === KindVariableDeclaration/u);
  assert.doesNotMatch(resolver, /providerVirtualDeclarationFactKey|moduleSpecifier|exportName|resolveRustTargetTypeRef/u);
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
    ["indexer", "function planElementAccess(", "export function planArrayLiteral("],
  ];
  for (const [lane, start, end] of lanes) {
    const section = sourceSection(text, start, end);
    assert.match(section, /rustOperationFact\(node, context\)/u, `${lane} must read the finalized Rust operation fact`);
    assert.match(section, /missingFactDiagnostic/u, `${lane} must diagnose a missing finalized fact`);
    assert.doesNotMatch(section, /selectedTargetSignatureFactKey|providerVirtualDeclarationFactKey/u, `${lane} must not recover provider identity in the backend`);
  }
});

test("backend provider lowering consumes only total finalized operation ABI", () => {
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const statements = readFileSync(join(sourceRoot, "backend/planner/statements.ts"), "utf8");
  const providerLowering = sourceSection(
    expressions,
    "function planProviderOperationExpression(",
    "function planCallExpression(",
  );
  const runtimeSet = sourceSection(
    statements,
    "function planRuntimeSetStatement(",
    "function planForOfStatement(",
  );
  for (const [name, section] of [["provider expression", providerLowering], ["runtime setter", runtimeSet]]) {
    assert.match(section, /validateRustFinalizedOperationAbi/u, `${name} must validate the total ABI`);
    assert.match(section, /\.abi\.(?:targetReceiver|targetArguments|result|sourceArguments)/u, `${name} must consume finalized ABI fields`);
    assert.doesNotMatch(section, /\.argModes|\.argOrder|\.argConversions|\.receiverMode|\.indexConversion|\.resultConversion|\.parameterCarriers|\.sourceArgumentCount/u, `${name} must not interpret sparse authoring metadata`);
  }
  assert.match(expressions, /function providerSelectedCallMatches\(/u);
  assert.match(expressions, /getSelectedTargetCall\(node\)/u);
  assert.match(runtimeSet, /fact\.abi\.operationKind !== expectedOperationKind/u);
  assert.match(runtimeSet, /fact\.abi\.effects\.invocation !== "infallible"/u);
  assert.match(runtimeSet, /getRuntimeCarrierFact\(right\)/u);
  assert.match(runtimeSet, /selectedOperatorIdentityMatches/u);
});

test("operation target shape and source-call effects have one finalized owner", () => {
  const keys = readFileSync(join(sourceRoot, "source/rust-facts/keys.ts"), "utf8");
  const abi = readFileSync(join(sourceRoot, "source/rust-facts/finalized-operation-abi.ts"), "utf8");
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const statements = readFileSync(join(sourceRoot, "backend/planner/statements.ts"), "utf8");
  const factUnion = sourceSection(keys, "export type RustTargetOperationFact =", "export const rustTargetOperationFactKey");
  const providerFact = sourceSection(factUnion, 'readonly kind: "provider-operation";', 'readonly kind: "array-literal";');
  const runtimeSetFact = sourceSection(factUnion, 'readonly kind: "runtime-set";', 'readonly kind: "for-of";');

  assert.match(abi, /readonly operationKind: RustFinalizedOperationKind/u);
  assert.match(abi, /readonly target: RustProviderOperationForm/u);
  assert.match(keys, /RustFinalizedOperationAbiFor<RustProviderFactOperationKind>/u);
  assert.match(keys, /RustFinalizedOperationAbiFor<RustRuntimeSetOperationKind>/u);
  assert.doesNotMatch(providerFact, /readonly target:|readonly operationKind:/u);
  assert.doesNotMatch(runtimeSetFact, /readonly target:/u);
  assert.doesNotMatch(`${keys}\n${expressions}`, /rustFallibleCallFactKey|fallibleOnAwait/u);
  assert.match(keys, /rustSourceCallEffectsFactKey/u);
  assert.match(expressions, /rustSourceCallEffectsFactKey/u);
  assert.doesNotMatch(expressions, /convertedCarrier\s*\?\?\s*sourceCarrier/u);
  assert.doesNotMatch(expressions, /rust\.core\.Future/u);
  assert.doesNotMatch(statements, /assign_op_pattern|compoundAssignmentOperator/u);
});

test("backend conversion planning never reconstructs assertion kinds from source syntax", () => {
  const text = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  assert.doesNotMatch(text, /isConstAssertion|TypeReferenceNode_TypeName/u);
  assert.match(text, /fact\.kind !== "source-conversion"/u);
});

test("call-argument conversion consumes the checked expression carrier, not a semantic-type reconstruction", () => {
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/operations-provider.ts"), "utf8");
  const conversion = sourceSection(
    semantics,
    "export function selectRustCheckedConversion(",
    "function targetTypeContainsSelectedParameter(",
  );
  const callArgument = conversion.slice(0, conversion.indexOf("const targetCarrier = resolveRustTargetTypeRef(request.explicitTargetTypeNode"));
  assert.match(callArgument, /resolveRustTargetTypeRef\(request\.expression, context, options\)/u);
  assert.doesNotMatch(callArgument, /resolveRustTargetTypeRef\(request\.source, context, options\)/u);
  assert.doesNotMatch(callArgument, /asNode\(request\.source, context\)/u);
});

test("backend assignment and nullish checks consume finalized fact details", () => {
  const statements = readFileSync(join(sourceRoot, "backend/planner/statements.ts"), "utf8");
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/index.ts"), "utf8");
  const operators = readFileSync(join(sourceRoot, "source/rust-target-semantics/operator-rules.ts"), "utf8");
  assert.match(statements, /assignment === undefined \|\| assignment\.kind !== "operator-token"/u);
  assert.match(statements, /selectedOperatorMatches\(expression, assignment, context\)/u);
  assert.doesNotMatch(statements, /sourceReferenceFor|selectRustEquivalentAssignment/u);
  assert.match(semantics, /targetReference\.symbol !== valueReference\.symbol/u);
  assert.match(semantics, /targetReference\.declaration !== valueReference\.declaration/u);
  assert.match(operators, /export function selectRustEquivalentAssignment\(/u);
  assert.match(expressions, /fact\.optionOperand === "left" \? leftNode : rightNode/u);
  assert.doesNotMatch(expressions, /getRuntimeCarrierFact\(leftNode\)/u);
});

test("backend operation facts cannot override runtime carriers or selected source identity", () => {
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const requiredLanes = [
    "rust.backend.conversion-carrier",
    "rust.backend.operator-carrier",
    "rust.backend.source-constructor-carrier",
    "rust.backend.provider-constructor-carrier",
    "rust.backend.source-field-carrier",
    "rust.backend.enum-member-carrier",
    "rust.backend.provider-property-carrier",
    "rust.backend.tuple-index-carrier",
    "rust.backend.provider-indexer-carrier",
    "rust.backend.tuple-literal-carrier",
    "rust.backend.array-literal-carrier",
    "rust.backend.record-literal-carrier",
    "rust.backend.closure-carrier",
    "rust.backend.await-carrier",
  ];
  assert.match(expressions, /function requireExpressionCarrier\(/u);
  for (const lane of requiredLanes) {
    assert.match(expressions, new RegExp(lane.replaceAll(".", "\\."), "u"));
  }
  assert.match(expressions, /sourceCallEffectsMatch\(fact, sourceCallEffects\)/u);
  assert.match(expressions, /providerSelectedCallMatches\(node, fact, context\)/u);
  assert.doesNotMatch(expressions, /convertedCarrier === undefined\s*\?\s*rustTargetTypeRefEquals\(sourceCarrier/u);
});

test("malformed compiler collection slots fail closed instead of disappearing", () => {
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const declarations = readFileSync(join(sourceRoot, "backend/planner/declarations-nominal.ts"), "utf8");
  const semantics = readFileSync(join(sourceRoot, "source/rust-target-semantics/index.ts"), "utf8");
  assert.match(expressions, /Fixed-array literal contains a missing or omitted element slot/u);
  assert.match(expressions, /Arrow function contains an undefined parameter slot/u);
  assert.match(declarations, /Constructor body contains an undefined statement slot/u);
  assert.match(declarations, /Enum declaration contains an undefined member slot/u);
  assert.match(declarations, /Interface declaration contains an undefined member slot/u);
  assert.match(semantics, /RUST_SOURCE_AST_INCOMPLETE/u);
  assert.match(semantics, /function requireDenseSourceNodes\(/u);
  assert.match(semantics, /isDenseDataArray\(rawSourceFiles\)/u);
  assert.doesNotMatch(semantics, /getSourceFiles\(\)\s*\.filter\([^;]+sourceFile !== undefined/su);
  assert.doesNotMatch(semantics, /if \((?:statement|member|parameter) === undefined\) \{\s*continue;\s*\}/u);
  assert.doesNotMatch(expressions, /ast\.arguments\(node\)\.filter\([^;]+!== undefined/su);
  assert.doesNotMatch(semantics, /ast\.elements\(expression\)\.filter\(\(element\): element is Node => element !== undefined\)/u);
});

test("project-source backend calls require the exact finalized selected member ABI", () => {
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions.ts"), "utf8");
  const selectedGate = sourceSection(
    expressions,
    "export function sourceCallSelectedMemberMatches(",
    "export function requireProviderArgumentPassingFacts(",
  );
  assert.match(selectedGate, /member\.id === fact\.operationId/u);
  assert.match(selectedGate, /member\.kind === expectedKind/u);
  assert.match(selectedGate, /member\.targetName === expectedTargetName/u);
  assert.match(selectedGate, /member\.parameters\.length === fact\.parameterCarriers\.length/u);
  assert.match(selectedGate, /sourceSelectedMethodTypeArguments/u);
  assert.match(selectedGate, /substituteRustTargetTypeParameters\(parameter\.type, substitutions\)/u);
  assert.match(selectedGate, /fact\.targetTypeArguments/u);
  assert.match(selectedGate, /fact\.parameterCarriers\[index\]/u);
  assert.match(selectedGate, /mode === fact\.argumentModes\[index\]/u);
  assert.doesNotMatch(selectedGate, /sourceName ===|memberName|includes\(|toLowerCase/u);
});

test("provider operation metadata contains only structured Rust forms", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /\btrailingArgs\b/u, `${path} uses legacy raw trailing arguments`);
    assert.doesNotMatch(text, /\bargCasts\b|\bcastResult\b/u, `${path} uses unchecked provider cast metadata`);
    assert.doesNotMatch(text, /\breceiverTypeId\b/u, `${path} uses receiver identity guessing`);
  }
});

test("backend Rust AST has no unchecked cast expression lane", () => {
  const nodes = readFileSync(join(sourceRoot, "backend/rust-ast/nodes.ts"), "utf8");
  const printer = readFileSync(join(sourceRoot, "print/rust-printer.ts"), "utf8");
  assert.doesNotMatch(nodes, /readonly kind: "cast"/u);
  assert.doesNotMatch(printer, /\sas\s\$\{target\}/u);
});

test("value conversions use target-owned semantic ids, never arbitrary helper paths", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /rustHelperCallValueConversion|kind:\s*["']helper-call["']/u, `${path} exposes arbitrary conversion helpers`);
  }
  const conversions = readFileSync(join(sourceRoot, "source/rust-facts/value-conversions.ts"), "utf8");
  assert.match(conversions, /function rustValueConversionContract/u);
  assert.match(conversions, /case "checked-i32-to-usize"/u);
  assert.match(conversions, /case "js-number-from-usize"/u);
});
