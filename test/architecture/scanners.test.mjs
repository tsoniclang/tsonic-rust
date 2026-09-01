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

test("clean emission has no legacy synthetic prefix or blanket lint policy", () => {
  const retiredHelper = join(sourceRoot, "backend/planner/generated-source-lints.ts");
  assert.throws(() => statSync(retiredHelper), /ENOENT/u);
  const blanketAttributes = [
    "#![allow(non_snake_case)]",
    "#![allow(private_interfaces)]",
    "#![allow(unused_assignments, unused_variables)]",
    "#![allow(clippy::blocks_in_conditions)]",
    "#![allow(clippy::collapsible_if)]",
    "#![allow(clippy::comparison_to_empty)]",
    "#![allow(clippy::format_in_format_args)]",
    "#![allow(clippy::manual_range_contains)]",
    "#![allow(clippy::needless_question_mark)]",
    "#![allow(clippy::needless_return)]",
    "#![allow(clippy::never_loop)]",
    "#![allow(clippy::nonminimal_bool)]",
    "#![allow(clippy::redundant_closure)]",
    "#![allow(clippy::too_many_arguments)]",
    "#![allow(clippy::to_string_in_format_args)]",
    "#![allow(clippy::type_complexity)]",
    "#![allow(clippy::unnecessary_to_owned)]",
  ];
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /__tsonic_/u, `${path} contains the retired synthetic prefix`);
    assert.ok(!text.includes("generated-source-lints"), `${path} references the retired lint helper`);
    for (const attribute of blanketAttributes) {
      assert.ok(!text.includes(attribute), `${path} contains retired blanket attribute ${attribute}`);
    }
  }
});

test("generated lint exceptions have one explicit policy owner", () => {
  for (const { path, text } of sourceFiles) {
    if (path.endsWith("/backend/target-ast/normalization/lint-policy.ts")) {
      continue;
    }
    assert.doesNotMatch(text, /#!?\[allow\(/u, `${path} emits an unowned Rust lint exception`);
  }
  const policy = readFileSync(join(sourceRoot, "backend/target-ast/normalization/lint-policy.ts"), "utf8");
  assert.doesNotMatch(policy, /#!?\[allow\((?![^\]\n]*reason = )[^\]\n]*\)\]/u);
  assert.match(policy, /reason = /u);
});

test("Rust compiler reflection remains isolated from semantic and backend layers", () => {
  assert.throws(
    () => statSync(join(sourceRoot, "providers/compiler/std-catalog.ts")),
    /ENOENT/u,
    "the retired hand-maintained standard-library catalog must remain deleted",
  );
  for (const { path, text } of sourceFiles) {
    if (path.includes("/providers/compiler/")) {
      continue;
    }
    assert.doesNotMatch(text, /\brustdoc\b/u, `${path} contains rustdoc-specific logic outside the compiler provider`);
  }
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    assert.doesNotMatch(
      text,
      /providers\/compiler\//u,
      `${path} reaches into compiler-provider tooling`,
    );
  }
});

test("no source-name target guessing in the backend", () => {
  const bannedTokens = ['"node:', '"@acme', "readText", "readFileSync", '"homeDir"', '"Math"', '"console"', '"push"', '"readFile"'];
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    const productText = text.replace(/from "node:[a-z/]+"/gu, "");
    for (const token of bannedTokens) {
      assert.ok(!productText.includes(token), `${path} contains banned source-name token ${token}`);
    }
  }
});

test("no C# target references in Rust target code", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /csharp|roslyn|dotnet/iu, `${path} references the C# target`);
  }
});

test("Rust target-type validation and equality have one target-model owner", () => {
  const owners = sourceFiles.filter(({ text }) =>
    /export function (?:isRustTargetTypeRef|rustTargetTypeRefEquals)\b/u.test(text));
  assert.deepEqual(
    owners.map(({ path }) => path.slice(sourceRoot.length + 1)),
    ["target-model/types/equality.ts"],
  );
  const carrierHelpers = readFileSync(join(sourceRoot, "target-model/types/index.ts"), "utf8");
  assert.doesNotMatch(carrierHelpers, /export function (?:isRustTargetTypeRef|rustTargetTypeRefEquals)\b/u);
});

test("Rust semantic-lifetime to syntax conversion has one planner owner", () => {
  const owners = sourceFiles.filter(({ text }) =>
    /export function rustLifetimeToAst\b/u.test(text));
  assert.deepEqual(
    owners.map(({ path }) => path.slice(sourceRoot.length + 1)),
    ["backend/planner/types/lifetime-syntax.ts"],
  );
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

test("project downcasts use closed generated routes without runtime type discovery", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /std::any::Any|\bTypeId\b|\binto_any\b/u, `${path} uses runtime type discovery`);
    assert.doesNotMatch(text, /method:\s*"downcast"/u, `${path} emits a runtime downcast`);
  }
  const policy = readFileSync(
    join(sourceRoot, "analysis/project-types/policy/resolution.ts"),
    "utf8",
  );
  assert.match(policy, /downcastRoutesByDefinition/u);
  assert.match(
    policy,
    /sourcePackageComponentForFile\(target\.fileName\) === sourceComponent/u,
  );
});

test("Cargo registry patches require explicit runtime-reference provenance", () => {
  const analysis = readFileSync(join(sourceRoot, "analysis/runtime/references.ts"), "utf8");
  const printer = readFileSync(join(sourceRoot, "print/project/manifest.ts"), "utf8");
  const runtimeReferences = readFileSync(
    join(sourceRoot, "compilation/runtime-references.ts"),
    "utf8",
  );
  assert.match(analysis, /registryPatch !== undefined && registryPatch !== cargoCratesIoRegistry/u);
  assert.match(printer, /dependencies\.filter\(\(dependency\) => dependency\.registryPatch === "crates-io"\)/u);
  assert.match(runtimeReferences, /\[cargoRegistryPatchAttributeName\]: cargoCratesIoRegistry/u);
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

test("bounded tests cap and report nested Cargo parallelism", () => {
  const runner = readFileSync(join(repositoryRoot, "scripts/test.sh"), "utf8");
  assert.match(runner, /cargo_build_jobs="\$\{CARGO_BUILD_JOBS:-2\}"/u);
  assert.match(runner, /export CARGO_BUILD_JOBS="\$\{cargo_build_jobs\}"/u);
  assert.match(runner, /nested Cargo jobs: %s per Cargo invocation/u);
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

test("target diagnostics remain outside the complete Rust output plan", () => {
  const outputModel = readFileSync(join(sourceRoot, "backend/artifact-model/output.ts"), "utf8");
  const materializer = readFileSync(join(sourceRoot, "backend/emission/materialize.ts"), "utf8");
  const compiler = readFileSync(join(sourceRoot, "backend/compile.ts"), "utf8");
  assert.doesNotMatch(outputModel, /diagnostic/iu);
  assert.doesNotMatch(materializer, /TargetCompileInput/u);
  assert.match(compiler, /runTargetCompilationStages/u);
  assert.match(compiler, /materialize:\s*materializeRustOutputPlan/u);
});

test("JS operation rows are unique per owner/member/kind/lane/variant", async () => {
  const source = readFileSync(join(sourceRoot, "policy/operations/js-surface/rows.ts"), "utf8");
  assert.match(source, /const jsOperationRows = defineJsOperationRows\(\[/u);
  await import("../../dist/policy/operations/js-surface.js");
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
  const expressions = readFileSync(
    join(sourceRoot, "backend/planner/expressions/conversions.ts"),
    "utf8",
  );
  const providerLowering = expressions.slice(
    expressions.indexOf("export function planProviderOperationExpression"),
    expressions.indexOf("export function finishProviderOperationExpression"),
  );
  assert.ok(providerLowering.includes("function planProviderOperationExpression"), "slice covers provider lowering");
  assert.ok(!providerLowering.includes("rustLocalBindingName"), "provider operation lowering must emit row metadata verbatim");
  const identitySources = [
    join(sourceRoot, "policy/operations/js-surface/rows.ts"),
    ...collectFiles(join(sourceRoot, "providers/packages"), ".ts"),
  ];
  for (const path of identitySources) {
    const text = readFileSync(path, "utf8");
    assert.ok(!text.includes("rustLocalBindingName"), `${path} must not recase identities`);
  }
});

test("source profile identity comes from the registered compiler SourceFile, never a path substring", () => {
  const identitySources = [
    join(sourceRoot, "policy/evidence/selected-source.ts"),
    ...collectFiles(join(sourceRoot, "policy/types/resolution"), ".ts"),
  ];
  for (const path of identitySources) {
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(text, /source-profiles|tsonicSourceProfileVirtualDirectory|normalizeTargetSourceProfileSegment/u, `${path} reconstructs source-profile ownership from a path`);
  }
  const registry = readFileSync(join(sourceRoot, "analysis/facts/source-profile-registry.ts"), "utf8");
  assert.doesNotMatch(registry, /\.includes\s*\(/u);
  assert.match(registry, /sourceFileByProfile\.get\(profile\) === sourceFile/u);
  assert.match(registry, /ambiguousProfiles\.add\(profile\)/u);
});

test("selected source operation identity is never reconstructed through checker queries", () => {
  const semanticFiles = sourceFiles.filter(({ path }) =>
    path.includes("/analysis/") || path.includes("/policy/") ||
    path.includes("/target-model/"));
  const forbidden = [
    /getResolvedSignature\s*\(/u,
    /getPropertyOfType\s*\(/u,
    /getTypeFromTypeNode\s*\(/u,
    /\bsafeGet[A-Z][A-Za-z0-9_]*\s*\(/u,
    /\.TypeArguments\b/u,
    /\.Text\b/u,
    /\b(?:sourceUsage|sourceMemberNames|TargetSourceUsageHints)\b/u,
  ];
  for (const { path, text } of semanticFiles) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${path} contains forbidden selected-evidence reconstruction ${pattern}`);
    }
  }

  const broadCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:undefined|false)\s*;/gu;
  const broadCatchOwners = [];
  for (const { path, text } of semanticFiles) {
    const functions = [...text.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/gu)];
    for (const match of text.matchAll(broadCatch)) {
      const owner = functions.filter((candidate) => candidate.index < match.index).at(-1)?.[1] ?? "<module>";
      broadCatchOwners.push(`${path.slice(sourceRoot.length + 1)}|${owner}`);
    }
  }
  assert.deepEqual(broadCatchOwners, [
    "target-model/metadata/closed-data.ts|isClosedMetadata",
    "target-model/types/equality.ts|isRustTargetTypeRef",
    "target-model/types/equality.ts|isRustTargetGenericArgument",
  ]);

  for (const { path, text } of semanticFiles) {
    assert.doesNotMatch(text, /\.checker\b/u, `${path} retains a raw checker container`);
    assert.doesNotMatch(text, /\b(?:TypeCheckerQueries|TypeShapeQueries)\b/u, `${path} retains a broad source query interface`);
  }
});

test("runtime source classification uses compiler declaration-file facts", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(
      text,
      /endsWith\(["']\.d\.ts["']\)/u,
      `${path} infers declaration-file status from a suffix`,
    );
  }
  const context = readFileSync(join(sourceRoot, "analysis/program/context.ts"), "utf8");
  assert.match(context, /ast\.isDeclarationFile\(sourceFile\)/u);
});

test("project-source calls trust the exact TSTS-selected declaration rather than reconstructing alias identity", () => {
  const semantics = readFileSync(
    join(sourceRoot, "analysis/operations/provider/calls/selection.ts"),
    "utf8",
  );
  assert.match(semantics, /if \(sourceDeclaration === undefined && calleeDeclaration !== undefined\)/u);
  assert.match(semantics, /acceptProjectSourceCall\(request, sourceDeclaration/u);
  assert.doesNotMatch(semantics, /projectCallDeclarationsCorroborate|RUST_SELECTED_PROJECT_EVIDENCE_CONFLICT/u);
});

test("raw compiler object fields and source-use scans never become semantic input", () => {
  const productFiles = sourceFiles.filter(({ path }) =>
    path.includes("/source/") || path.includes("/policy/") ||
    path.includes("/analysis/") || path.includes("/backend/"));
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

test("provider operation selection uses canonical provider identities, never import spellings or names", () => {
  const text = readFileSync(join(sourceRoot, "policy/operations/provider-selection.ts"), "utf8");
  assert.match(text, /row\.exportId === identity\.exportId/u);
  assert.match(text, /row\.memberId === identity\.memberId/u);
  assert.match(text, /row\.signatureId === identity\.signatureId/u);
  assert.match(text, /row\.providerId === identity\.providerId/u);
  assert.match(text, /row\.providerVersion === identity\.providerVersion/u);
  assert.match(text, /row\.providerModuleId === identity\.providerModuleId/u);
  assert.doesNotMatch(text, /row\.moduleSpecifier|identity\.moduleSpecifier/u);
  assert.doesNotMatch(text, /exportName|memberName|sourceName|targetName/u);
});

test("provider parameter passing is metadata-derived and backend-gated", () => {
  const semantics = readFileSync(
    join(sourceRoot, "analysis/operations/provider/calls/instantiation.ts"),
    "utf8",
  );
  const selectedCall = sourceSection(
    semantics,
    "function acceptSelectedCall(",
    "function selectedCallSourceCarriers(",
  );
  assert.match(selectedCall, /fact\.abi\.sourceArguments\.map/u);
  assert.match(selectedCall, /passingMode: rustArgumentPassingMode\(argument\.mode\)/u);
  assert.doesNotMatch(selectedCall, /passingMode:\s*["']by-value["']/u);
  assert.doesNotMatch(semantics, /rustSourceArgumentModes/u);

  const backend = readFileSync(
    join(sourceRoot, "backend/planner/expressions/calls/basic.ts"),
    "utf8",
  );
  const callPlanner = sourceSection(
    backend,
    "function planCallExpressionInner(",
    "function planRustDefaultValueCall(",
  );
  assert.match(callPlanner, /requireProviderArgumentPassingFacts\(context, fact, providerArgumentNodes\)/u);
  const argumentPlanning = readFileSync(
    join(sourceRoot, "backend/planner/expressions/calls/arguments.ts"),
    "utf8",
  );
  const passingGate = argumentPlanning.slice(
    argumentPlanning.indexOf("export function requireProviderArgumentPassingFacts("),
  );
  assert.match(passingGate, /getArgumentPassingFact\(argument\)/u);
  assert.match(passingGate, /if \(actual === undefined\)/u);
  assert.match(passingGate, /if \(actual\.mode !== expected\)/u);
  assert.match(passingGate, /missingFactDiagnostic/u);
});

test("optional chains consume exact TSTS evidence through one finalized Option fact", () => {
  const contracts = readFileSync(join(sourceRoot, "policy/operations/contracts.ts"), "utf8");
  assert.match(contracts, /readonly source: ResolvedSourceCallInfo/u);
  assert.doesNotMatch(contracts, /readonly optionalChain: ResolvedSourceCallInfo/u);
  assert.doesNotMatch(contracts, /readonly sourceReceiver\?: ResolvedSourceCallInfo/u);
  assert.match(contracts, /readonly sourceReceiverType\?: Type/u);

  const semantics = readFileSync(
    join(sourceRoot, "analysis/operations/provider/result.ts"),
    "utf8",
  );
  assert.match(semantics, /selectedMemberReceiverCarrier\(request, context, options\)/u);
  assert.match(semantics, /selectRustOptionalChain\(\{/u);
  assert.match(semantics, /sourceGuardCarrier = resolveRustTargetTypeRef\(\s*request\.receiver,/u);
  assert.doesNotMatch(semantics, /sourceReceiverDeclaration/u);
  assert.match(semantics, /request\.optionalChain/u);
  assert.match(semantics, /selectedMemberReceiverCarrier\(request, context, options\)/u);
  assert.match(semantics, /rustOptionalChainFactKey/u);

  const selector = readFileSync(join(sourceRoot, "policy/operations/optional-chains.ts"), "utf8");
  assert.match(selector, /rustOptionElementCarrier\(sourceGuardCarrier\)/u);
  assert.match(selector, /rustTargetTypeRefEquals\(sourceElement, selectedGuardCarrier\)/u);
  assert.doesNotMatch(selector, /getResolved|getSymbolAtLocation|getTypeAtLocation|getPropertyOfType/u);
  assert.doesNotMatch(selector, /memberName|propertyName|sourceName|targetName/u);

  const backend = readFileSync(join(sourceRoot, "backend/planner/expressions/special.ts"), "utf8");
  const planner = sourceSection(
    backend,
    "export function planOptionalChainExpression(",
    "function exactOptionalStructuralMethodGuard(",
  );
  assert.match(planner, /getFact\(node, rustOptionalChainFactKey\)/u);
  assert.match(planner, /planRawExpression\(fact\.guard, context, "value"\)/u);
  assert.match(planner, /planRustNonConsumingValue\(fact\.guard, plannedGuard, context\)/u);
  assert.match(planner, /overrides\.set\(fact\.guard/u);
  assert.doesNotMatch(planner, /getResolved|getSymbolAtLocation|getTypeAtLocation|getPropertyOfType/u);
});

test("plain identifier binding cannot become a provider-value identity workaround", () => {
  const semantics = readFileSync(join(sourceRoot, "analysis/expressions/references.ts"), "utf8");
  const resolver = sourceSection(semantics, "export function resolveIdentifierCarrier(", "export function recordProjectSourceBinding(");
  assert.match(resolver, /declarationKind === KindParameter \|\| declarationKind === KindVariableDeclaration/u);
  assert.doesNotMatch(resolver, /providerVirtualDeclarationFactKey|moduleSpecifier|exportName|resolveRustTargetTypeRef/u);
});

test("type-shape queries are confined to closed target type resolution", () => {
  for (const { path, text } of sourceFiles) {
    if (path.includes("/policy/types/resolution/")) {
      continue;
    }
    assert.doesNotMatch(text, /\btypeShape\./u, `${path} re-queries source type shape outside target type resolution`);
  }
});

test("compiler Type objects are never treated as source-alias fact identity", () => {
  const text = readFileSync(join(sourceRoot, "policy/types/resolution/target.ts"), "utf8");
  assert.doesNotMatch(text, /factResolver\.resolve\(type,\s*runtimeCarrierFactKey\)/u);
  assert.doesNotMatch(text, /factResolver\.resolve\(type,\s*sourcePrimitiveFactKey\)/u);
});

test("backend and provider metadata layers never query the TypeScript checker", () => {
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/") && !path.includes("/providers/packages/")) {
      continue;
    }
    assert.doesNotMatch(text, /\bchecker\.[A-Za-z0-9_]+\s*\(/u, `${path} queries the checker`);
  }
});

test("native module-function eligibility is finalized before backend planning", () => {
  const semantics = readFileSync(
    join(sourceRoot, "analysis/program/module-bindings.ts"),
    "utf8",
  );
  assert.match(semantics, /runtimeValueUses\.hasFirstClassUse\(declaration\)/u);
  assert.match(semantics, /storage: "module-cell"/u);
  const runtimeUses = readFileSync(
    join(sourceRoot, "analysis/program/runtime-value-uses.ts"),
    "utf8",
  );
  assert.match(runtimeUses, /navigation\.declarationUses\(declaration\)/u);
  assert.match(runtimeUses, /use\.kind === "first-class"/u);
  assert.match(runtimeUses, /isCompileTimeApplicationReference/u);
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    assert.doesNotMatch(
      text,
      /referencesToDeclaration|referenceAllowsNativeFunction/u,
      `${path} reconstructs native module-function eligibility`,
    );
  }
});

test("provider-backed backend lanes require finalized operation facts", () => {
  const lanes = [
    [
      "constructor",
      readFileSync(join(sourceRoot, "backend/planner/expressions/special.ts"), "utf8"),
      "export function planNewExpression(",
      "export function effectiveMemberResultCarrier(",
    ],
    [
      "property",
      readFileSync(join(sourceRoot, "backend/planner/expressions/properties.ts"), "utf8"),
      "export function planPropertyAccess(",
      "function planRustSourceMethodPropertyRead(",
    ],
    [
      "indexer",
      readFileSync(join(sourceRoot, "backend/planner/expressions/elements.ts"), "utf8"),
      "export function planElementAccess(",
      "export function planArrayLiteral(",
    ],
  ];
  for (const [lane, text, start, end] of lanes) {
    const section = sourceSection(text, start, end);
    assert.match(section, /rustOperationFact\(node, context\)/u, `${lane} must read the finalized Rust operation fact`);
    assert.match(section, /missingFactDiagnostic/u, `${lane} must diagnose a missing finalized fact`);
    assert.doesNotMatch(section, /selectedTargetSignatureFactKey|providerVirtualDeclarationFactKey/u, `${lane} must not recover provider identity in the backend`);
  }
});

test("backend provider lowering consumes only total finalized operation ABI", () => {
  const expressions = readFileSync(
    join(sourceRoot, "backend/planner/expressions/conversions.ts"),
    "utf8",
  );
  const expressionFacts = readFileSync(
    join(sourceRoot, "backend/planner/expressions/fundamentals.ts"),
    "utf8",
  );
  const statements = readFileSync(
    join(sourceRoot, "backend/planner/statements/iteration.ts"),
    "utf8",
  );
  const providerLowering = sourceSection(
    expressions,
    "export function planProviderOperationExpression(",
    "export function finishProviderOperationExpression(",
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
  assert.match(expressionFacts, /function providerSelectedCallMatches\(/u);
  assert.match(expressionFacts, /getSelectedTargetCall\(node\)/u);
  assert.match(runtimeSet, /fact\.abi\.operationKind !== expectedOperationKind/u);
  assert.match(runtimeSet, /fact\.abi\.effects\.invocation !== "infallible"/u);
  assert.match(runtimeSet, /getRuntimeCarrierFact\(right\)/u);
  assert.match(runtimeSet, /selectedOperatorIdentityMatches/u);
});

test("operation target shape and source-call effects have one finalized owner", () => {
  const keys = readFileSync(join(sourceRoot, "analysis/facts/operations/facts.ts"), "utf8");
  const abi = readFileSync(join(sourceRoot, "analysis/facts/finalized-operation/model.ts"), "utf8");
  const expressions = collectFiles(join(sourceRoot, "backend/planner/expressions"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const statements = collectFiles(join(sourceRoot, "backend/planner/statements"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const sourceCallFacts = readFileSync(join(sourceRoot, "analysis/facts/keys.ts"), "utf8");
  const factUnion = keys.slice(keys.indexOf("export type RustTargetOperationFact ="));
  const providerFact = sourceSection(factUnion, 'readonly kind: "provider-operation";', 'readonly kind: "array-literal";');
  const runtimeSetFact = sourceSection(factUnion, 'readonly kind: "runtime-set";', 'readonly kind: "iteration";');

  assert.match(abi, /readonly operationKind: RustFinalizedOperationKind/u);
  assert.match(abi, /readonly target: RustProviderOperationForm/u);
  assert.match(keys, /RustFinalizedOperationAbiFor<RustProviderFactOperationKind>/u);
  assert.match(keys, /RustFinalizedOperationAbiFor<RustRuntimeSetOperationKind>/u);
  assert.doesNotMatch(providerFact, /readonly target:|readonly operationKind:/u);
  assert.doesNotMatch(runtimeSetFact, /readonly target:/u);
  assert.doesNotMatch(`${keys}\n${expressions}`, /rustFallibleCallFactKey|fallibleOnAwait/u);
  assert.match(sourceCallFacts, /rustSourceCallEffectsFactKey/u);
  assert.match(expressions, /rustSourceCallEffectsFactKey/u);
  assert.doesNotMatch(expressions, /convertedCarrier\s*\?\?\s*sourceCarrier/u);
  assert.doesNotMatch(expressions, /rust\.core\.Future/u);
  assert.doesNotMatch(statements, /assign_op_pattern|compoundAssignmentOperator/u);
});

test("backend conversion planning never reconstructs assertion kinds from source syntax", () => {
  const text = readFileSync(join(sourceRoot, "backend/planner/expressions/fundamentals.ts"), "utf8");
  assert.doesNotMatch(text, /isConstAssertion|TypeReferenceNode_TypeName/u);
  assert.match(text, /fact\.kind !== "source-conversion"/u);
});

test("call-argument conversion consumes the checked expression carrier, not a semantic-type reconstruction", () => {
  const semantics = readFileSync(
    join(sourceRoot, "analysis/operations/provider/conversions.ts"),
    "utf8",
  );
  const conversion = sourceSection(
    semantics,
    "export function selectRustCheckedConversion(",
    "function selectProjectDowncast(",
  );
  const callArgument = conversion.slice(0, conversion.indexOf("const targetCarrier = resolveRustTargetTypeRef(request.explicitTargetTypeNode"));
  assert.match(callArgument, /resolveRustTargetTypeRef\(request\.expression, context, options\)/u);
  assert.doesNotMatch(callArgument, /resolveRustTargetTypeRef\(request\.source, context, options\)/u);
  assert.doesNotMatch(callArgument, /asNode\(request\.source, context\)/u);
});

test("backend assignment and nullish checks consume finalized fact details", () => {
  const statements = readFileSync(
    join(sourceRoot, "backend/planner/statements/expression-statements.ts"),
    "utf8",
  );
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions/binary.ts"), "utf8");
  const semantics = readFileSync(join(sourceRoot, "analysis/operations/operators.ts"), "utf8");
  const operators = readFileSync(join(sourceRoot, "policy/operations/operator-rules.ts"), "utf8");
  assert.match(statements, /assignment === undefined \|\| assignment\.kind !== "operator-token"/u);
  assert.match(statements, /selectedOperatorMatches\(expression, assignment, context\)/u);
  assert.doesNotMatch(statements, /sourceReferenceFor|selectRustEquivalentAssignment/u);
  assert.match(statements, /fact\.writeStrategy === "in-place-string-append-parts"/u);
  assert.match(statements, /fact\.writeStrategy === "in-place-string-append-value"/u);
  assert.match(semantics, /targetReference\.symbol !== valueReference\.symbol/u);
  assert.match(semantics, /targetReference\.declaration !== valueReference\.declaration/u);
  assert.match(semantics, /"in-place-string-append-parts"/u);
  assert.match(semantics, /"in-place-string-append-value"/u);
  assert.match(operators, /export function selectRustEquivalentAssignment\(/u);
  assert.match(expressions, /fact\.optionOperand === "left" \? leftNode : rightNode/u);
  assert.doesNotMatch(expressions, /getRuntimeCarrierFact\(leftNode\)/u);
});

test("counted-loop planning consumes one sealed Rust representation plan", () => {
  const analysis = readFileSync(
    join(sourceRoot, "analysis/control-flow/counted-loop-representations.ts"),
    "utf8",
  );
  const targetProgram = readFileSync(
    join(sourceRoot, "analysis/program/target-program.ts"),
    "utf8",
  );
  const planning = readFileSync(
    join(sourceRoot, "backend/planner/statements/control-flow.ts"),
    "utf8",
  );
  assert.match(targetProgram, /countedLoops: analyzeRustCountedLoopRepresentations\(/u);
  assert.match(analysis, /input\.navigation\.countedLoop\(statement\)/u);
  assert.match(analysis, /fact\.abi\.effects\.evaluation === "pure"/u);
  assert.match(analysis, /carrierHasIndependentScalarValue/u);
  assert.doesNotMatch(analysis, /isRustCopyCarrier/u);
  assert.match(planning, /program\.countedLoops\.representationFor\(node\)/u);
  assert.doesNotMatch(planning, /sourceNavigation\.countedLoop|expressionEffects|declarationUseSummary/u);
  assert.doesNotMatch(analysis, /\.text\([^)]*bound|memberName|propertyName|sourceName|targetName/u);
});

test("provider purity uses one generic operation-form writability policy", () => {
  const forms = readFileSync(
    join(sourceRoot, "policy/operations/forms.ts"),
    "utf8",
  );
  const providerValidation = readFileSync(
    join(sourceRoot, "providers/packages/validation/operations.ts"),
    "utf8",
  );
  const jsRows = readFileSync(
    join(sourceRoot, "policy/operations/js-surface/model.ts"),
    "utf8",
  );
  const finalization = readFileSync(
    join(sourceRoot, "analysis/facts/finalized-operation/finalize.ts"),
    "utf8",
  );
  assert.match(forms, /export function rustProviderOperationFormDeclaresWritableInput\(/u);
  assert.match(providerValidation, /rustProviderOperationFormDeclaresWritableInput\(row\.target\)/u);
  assert.match(jsRows, /rustProviderOperationFormDeclaresWritableInput\(row\.shape\.target\)/u);
  assert.match(finalization, /rustFinalizedTargetInputMayMutateSource/u);
  assert.doesNotMatch(providerValidation, /function operationFormDeclaresMutableInput/u);
});

test("backend operation facts cannot override runtime carriers or selected source identity", () => {
  const expressions = collectFiles(join(sourceRoot, "backend/planner/expressions"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
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
  const expressions = collectFiles(join(sourceRoot, "backend/planner/expressions"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const declarations = collectFiles(join(sourceRoot, "backend/planner/declarations"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const statements = collectFiles(join(sourceRoot, "backend/planner/statements"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const semantics = collectFiles(join(sourceRoot, "analysis"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.match(expressions, /Fixed-array literal contains a missing or omitted element slot/u);
  assert.match(expressions, /Callable expression contains an undefined parameter slot/u);
  assert.match(declarations, /planStatementSequence\(bodyStatements, body, bodyContext\)/u);
  assert.match(statements, /Source block contains an undefined statement slot/u);
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
  const expressions = readFileSync(
    join(sourceRoot, "backend/planner/expressions/calls/arguments.ts"),
    "utf8",
  );
  const selectedGate = sourceSection(
    expressions,
    "export function sourceCallSelectedMemberMatches(",
    "export function requireProviderArgumentPassingFacts(",
  );
  assert.match(selectedGate, /member\.id === fact\.operationId/u);
  assert.match(selectedGate, /member\.kind === expectedKind/u);
  assert.match(selectedGate, /member\.targetName === expectedTargetName/u);
  assert.match(selectedGate, /member\.parameters\.length === fact\.parameters\.length/u);
  assert.match(selectedGate, /sourceSelectedMethodTypeArguments/u);
  assert.match(selectedGate, /substituteRustTargetGenerics/u);
  assert.match(selectedGate, /fact\.targetGenericArguments/u);
  assert.match(selectedGate, /fact\.parameters\[index\]\?\.parameterCarrier/u);
  assert.match(selectedGate, /mode === fact\.parameters\[index\]\?\.mode/u);
  assert.doesNotMatch(selectedGate, /sourceName ===|memberName|includes\(|toLowerCase/u);
});

test("provider operation metadata contains only structured Rust forms", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /\btrailingArgs\b/u, `${path} uses legacy raw trailing arguments`);
    assert.doesNotMatch(text, /\bargCasts\b|\bcastResult\b/u, `${path} uses unchecked provider cast metadata`);
    assert.doesNotMatch(text, /\breceiverTypeId\b/u, `${path} uses receiver identity guessing`);
  }
});

test("backend Rust AST exposes only fact-backed primitive numeric casts", () => {
  const nodes = readFileSync(join(sourceRoot, "backend/target-ast/nodes.ts"), "utf8");
  const printer = readFileSync(join(sourceRoot, "print/source/expressions/core.ts"), "utf8");
  assert.doesNotMatch(nodes, /readonly kind: "cast"/u);
  assert.match(nodes, /readonly kind: "numeric-cast"; readonly expression: RustExpr; readonly target: RustPrimitiveTypeName/u);
  assert.match(printer, /case "numeric-cast"/u);
  assert.doesNotMatch(nodes, /numeric-cast[^\n]+target: string/u);
});

test("value conversions use target-owned semantic ids, never arbitrary helper paths", () => {
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /rustHelperCallValueConversion|kind:\s*["']helper-call["']/u, `${path} exposes arbitrary conversion helpers`);
  }
  const conversions = readFileSync(join(sourceRoot, "target-model/conversions/contracts.ts"), "utf8");
  assert.match(conversions, /function rustValueConversionContract/u);
  assert.match(conversions, /case "checked-i32-to-usize"/u);
  assert.match(conversions, /case "js-number-from-usize"/u);
});

test("source-package semantics are sealed before physical Rust planning", () => {
  const facadeAnalysis = readFileSync(
    join(sourceRoot, "analysis/program/source-package-facades.ts"),
    "utf8",
  );
  const facadePlanner = readFileSync(
    join(sourceRoot, "backend/planner/program/source-package-facades.ts"),
    "utf8",
  );
  assert.match(facadeAnalysis, /source\.navigation\.moduleExports/u);
  assert.match(facadeAnalysis, /exportsForComponent/u);
  assert.doesNotMatch(facadePlanner, /moduleExports\s*\(/u);
  assert.match(facadePlanner, /program\.sourcePackageFacades/u);

  const componentAnalysis = readFileSync(
    join(sourceRoot, "analysis/program/source-package-components.ts"),
    "utf8",
  );
  const componentPlanner = readFileSync(
    join(sourceRoot, "backend/planner/program/source-package-components.ts"),
    "utf8",
  );
  assert.match(componentAnalysis, /publishesImplementationAbi/u);
  assert.match(componentAnalysis, /componentReachesError/u);
  assert.match(componentPlanner, /program\.sourcePackageComponents/u);
  assert.doesNotMatch(
    componentPlanner,
    /programErrorDefinitions|componentReachesError|configuration\.outputType/u,
  );
});

test("Rust dead-code obligations are planner-local and normalized before output sealing", () => {
  const livenessPlan = readFileSync(
    join(sourceRoot, "backend/planner/liveness/plan.ts"),
    "utf8",
  );
  const generatedUsage = readFileSync(
    join(sourceRoot, "backend/planner/liveness/generated-item-usage.ts"),
    "utf8",
  );
  const targetProgram = readFileSync(
    join(sourceRoot, "analysis/program/model.ts"),
    "utf8",
  );
  const planningContext = readFileSync(
    join(sourceRoot, "backend/planner/context.ts"),
    "utf8",
  );
  const directives = readFileSync(
    join(sourceRoot, "backend/planner/liveness/directives.ts"),
    "utf8",
  );
  const normalization = readFileSync(
    join(sourceRoot, "backend/target-ast/normalization/dead-code.ts"),
    "utf8",
  );
  const outputPlanning = readFileSync(
    join(sourceRoot, "backend/planner/program/planning.ts"),
    "utf8",
  );
  const lintPolicy = readFileSync(
    join(sourceRoot, "backend/target-ast/normalization/lint-policy.ts"),
    "utf8",
  );

  assert.match(livenessPlan, /sourceNavigation\.declarationUseSummary\(declaration\)/u);
  assert.match(livenessPlan, /runtimeInitializationRoots/u);
  assert.match(livenessPlan, /transitivelyReachable\(roots, edges\)/u);
  assert.match(livenessPlan, /deadComponentRoots\(/u);
  assert.match(livenessPlan, /analyzeRustGeneratedItemUsage\(/u);
  assert.match(generatedUsage, /rustTargetOperationFactKey/u);
  assert.match(generatedUsage, /isStructuralFieldRead/u);
  assert.match(generatedUsage, /isStructuralFieldWritten/u);
  assert.match(generatedUsage, /isProjectTypeConstructed/u);
  assert.match(generatedUsage, /isProjectGeneratedFieldUsed/u);
  assert.match(generatedUsage, /isStructuralShapeConstructed/u);
  assert.match(generatedUsage, /isVariantConstructed/u);
  assert.doesNotMatch(targetProgram, /deadCode|liveness/u);
  assert.match(planningContext, /liveness: createRustPlannerLiveness\(program\)/u);
  assert.match(directives, /context\.input\.liveness\.requiresSuppression/u);
  assert.match(directives, /isStructuralFieldRead/u);
  assert.match(directives, /isStructuralFieldWritten/u);
  assert.match(directives, /isProjectTypeConstructed/u);
  assert.match(directives, /isProjectGeneratedFieldUsed/u);
  assert.match(directives, /isStructuralShapeConstructed/u);
  assert.doesNotMatch(
    directives,
    /sourceNavigation|declarationUseSummary|referencesToDeclaration/u,
  );
  assert.match(normalization, /rustDeadCodeAttribute\(deadCode\)/u);
  assert.match(normalization, /const \{ deadCode, \.\.\.withoutDeadCode \} = owner/u);
  assert.match(outputPlanning, /finalizeRustDeadCode\(/u);
  assert.match(lintPolicy, /allow\(dead_code, reason = "retains an unused authored declaration"\)/u);
  assert.match(lintPolicy, /allow\(dead_code, reason = "retains an unread authored field"\)/u);
  assert.match(lintPolicy, /expect\(dead_code, reason = "retains unused generated storage"\)/u);
  assert.doesNotMatch(lintPolicy, /preserves the checked source contract/u);
});

test("sealed Rust project-type queries never re-enter source navigation", () => {
  const text = readFileSync(
    join(sourceRoot, "analysis/project-types/policy/resolution.ts"),
    "utf8",
  );
  const sealedPolicy = sourceSection(
    text,
    "const policy: RustProjectTypePolicy = {",
    "return Object.freeze(policy);",
  );
  assert.doesNotMatch(sealedPolicy, /\bhost\.navigation\b/u);
  assert.match(text, /memberImplementationByClass/u);
  assert.match(text, /relatedDefinitions/u);
  assert.doesNotMatch(
    text,
    /definitions\.filter\([\s\S]*\.length\s*\*\s*contractMembers\.size/u,
  );
  assert.match(text, /RUST_PROJECT_MEMBER_IMPLEMENTATION_BUDGET_EXCEEDED/u);
});
