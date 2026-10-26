import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { rustLintAttributes } from "../../dist/backend/target-ast/normalization/lint-policy.js";
import { maskNativeMethodLiterals } from "./native-method-syntax.mjs";

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

test("project layouts are published by analysis, never reconstructed by planners", () => {
  const planners = sourceFiles.filter(file => file.path.startsWith(join(sourceRoot, "backend/planner") + sep));
  assert.equal(planners.length > 0, true, "the layout-owner gate must inspect actual planner files on every platform");
  for (const file of planners) {
    assert.doesNotMatch(file.text, /\brustProjectObjectLayout\b/u, file.path);
  }
});

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
    assert.doesNotMatch(text, /rustListAttribute\("(?:allow|expect)"/u, `${path} constructs an unowned Rust lint exception`);
  }
  for (const [name, attribute] of Object.entries(rustLintAttributes)) {
    assert.equal(attribute.kind, "list", name);
    assert.ok(attribute.path === "allow" || attribute.path === "expect", name);
    assert.equal(attribute.arguments.length, 2, name);
    assert.equal(attribute.arguments[0].kind, "word", name);
    assert.equal(attribute.arguments[1].kind, "value", name);
    assert.equal(attribute.arguments[1].path, "reason", name);
    assert.equal(attribute.arguments[1].value.kind, "string", name);
    assert.ok(attribute.arguments[1].value.value.length > 0, name);
  }
});

test("Rust compiler reflection remains isolated from semantic and backend layers", () => {
  assert.throws(
    () => statSync(join(sourceRoot, "providers/native/std-catalog.ts")),
    /ENOENT/u,
    "the retired hand-maintained standard-library catalog must remain deleted",
  );
  for (const { path, text } of sourceFiles) {
    if (path.includes("/providers/native/")) {
      continue;
    }
    const semanticText = path.endsWith("/descriptor/starter-project.ts")
      ? text.replace('command: "rustdoc"', "")
      : text;
    assert.doesNotMatch(
      semanticText,
      /\brustdoc\b/u,
      `${path} contains rustdoc-specific logic outside the compiler provider`,
    );
  }
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    assert.doesNotMatch(
      text,
      /providers\/native\//u,
      `${path} reaches into compiler-provider tooling`,
    );
  }
});

test("no source-name target guessing in the backend", () => {
  const bannedTokens = ['"node:', '"@acme', "readText", '"homeDir"', '"Math"', '"console"', '"push"', '"readFile"'];
  const nativeSyntax = maskNativeMethodLiterals(new Map(sourceFiles.filter(({ path }) =>
    path.includes("/backend/")).map(({ path, text }) => [path, text])));
  for (const { path, text } of sourceFiles) {
    if (!path.includes("/backend/")) {
      continue;
    }
    const productText = nativeSyntax.get(path).replace(/from "node:[a-z_/-]+"/gu, "");
    const tokens = [...bannedTokens, "readFileSync"];
    for (const token of tokens) {
      assert.ok(!productText.includes(token), `${path} contains banned source-name token ${token}`);
    }
  }
});

function sourceSelectionText(text) {
  return maskNativeMethodLiterals(new Map([["probe.ts", text]])).get("probe.ts")
    .replace(/from "node:[a-z_/-]+"/gu, "");
}

test("source-name guard permits native AST methods but rejects source-name dispatch", () => {
  assert.ok(!sourceSelectionText('({ kind: "method-call", receiver, method: "push", args: [value] })').includes('"push"'));
  for (const source of ['if (sourceName === "push") select();', 'if (member === "push") lower();',
    'const names = ["push"];', '({ name: "push", selected: true })',
    '({ method: "push" })', '({ kind: "selection", receiver, method: "push", args: [] })',
    '({ kind: "method-call", method: "push" })', '({ [key]: "push" })', `const source = 'method: "push"';`]) {
    assert.ok(sourceSelectionText(source).includes('"push"'), source);
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

test("project downcasts use closed routes and restrict checked Any to native output slots", () => {
  const checkedProjectionOwner = join(sourceRoot, "backend/planner/objects/checked-project-projections.ts");
  const checkedOwners = [];
  for (const { path, text } of sourceFiles) {
    assert.doesNotMatch(text, /std::any::Any|\bTypeId\b|\binto_any\b/u, `${path} uses runtime type discovery`);
    assert.doesNotMatch(text, /method:\s*"downcast"/u, `${path} emits a runtime downcast`);
    assert.doesNotMatch(text, /\b(?:downcast_ref|downcast_unchecked)\b/u, `${path} bypasses the checked output-slot contract`);
    if (/core::any::Any|\bdowncast_mut\b/u.test(text)) checkedOwners.push(path);
  }
  assert.deepEqual(checkedOwners, [checkedProjectionOwner]);
  const checkedProjection = readFileSync(checkedProjectionOwner, "utf8");
  assert.match(checkedProjection, /selfParam: rustSelfParameter\("rc"\)/u);
  assert.match(checkedProjection, /name: "output", type: \{ kind: "reference", mutable: true/u);
  assert.match(checkedProjection, /path: "Option", genericArguments/u);
  assert.match(checkedProjection, /path: "alloc::rc::Rc", genericArguments/u);
  assert.match(checkedProjection, /kind: "lifetime", lifetime: \{ kind: "static" \}/u);
  const policy = readFileSync(
    join(sourceRoot, "analysis/project-types/catalog/resolution.ts"),
    "utf8",
  );
  assert.match(policy, /downcastRoutesByDefinition/u);
  assert.match(
    policy,
    /sourcePackageComponentForFile\(target\.fileName\) === sourceComponent/u,
  );
});

test("Cargo registry patches require explicit runtime-reference provenance", () => {
  const analysis = readFileSync(join(sourceRoot, "analysis/project/classification.ts"), "utf8");
  const printer = readFileSync(join(sourceRoot, "print/project/manifest.ts"), "utf8");
  const runtimeReferences = readFileSync(
    join(sourceRoot, "providers/runtime/source-crates.ts"),
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
  const hostRoot = resolve(repositoryRoot, process.env.TSONIC_ROOT ?? "../tsonic");
  const launcher = readFileSync(join(hostRoot, "test/scripts/bounded-run.sh"), "utf8");
  const snapshot = readFileSync(join(hostRoot, "test/scripts/guard-snapshot.mjs"), "utf8");
  const guard = readFileSync(join(hostRoot, "test/scripts/bounded-test-scope.sh"), "utf8");
  const worker = readFileSync(join(repositoryRoot, "scripts/test-worker.sh"), "utf8");
  assert.match(runner, /\$\{TSONIC_ROOT:-\.\.\/tsonic\}\/test\/scripts\/bounded-run\.sh" rust/u);
  assert.match(launcher, /node "\$script_root\/guard-snapshot\.mjs"/u);
  assert.match(launcher, /exec bash "\$snapshot\/bounded-test-scope\.sh" "\$@"/u);
  assert.match(snapshot, /"bounded-test-scope\.sh", "test-resource-budget\.mjs"/u);
  assert.match(guard, /test-resource-budget\.mjs" "\$profile"/u);
  assert.match(guard, /export CARGO_BUILD_JOBS="\$\{cargo_build_jobs\}"/u);
  assert.match(guard, /nested Cargo jobs: %s per Cargo invocation/u);
  assert.match(worker, /test\/scripts\/run-parallel\.mjs/u);
  assert.match(worker, /--scope tsonic-rust/u);
  const queue = readFileSync(join(hostRoot, "test/scripts/parallel-scheduler.mjs"), "utf8");
  const resources = readFileSync(join(hostRoot, "test/scripts/parallel-task-resources.mjs"), "utf8");
  const budget = readFileSync(join(hostRoot, "test/scripts/test-resource-budget.mjs"), "utf8");
  assert.match(queue, /running\.size >= options\.workers/u);
  assert.match(queue, /!Number\.isSafeInteger\(value\) \|\| value <= 0/u);
  assert.doesNotMatch(queue, /\bmemoryMiB\b/u);
  assert.match(queue, /groupCount >= groupLimit/u);
  assert.match(queue, /task\.exclusive === true && running\.size > 0/u);
  assert.match(resources, /memoryAdmission: "outer-job-cgroup-only"/u);
  assert.match(budget, /TSONIC_TEST_WORKERS, "TSONIC_TEST_WORKERS"\) \?\? availableCpus/u);
  assert.match(guard, /MemoryMax=\$\{memory_max\}/u);
  assert.match(guard, /MemorySwapMax=0/u);
  assert.match(guard, /if \[\[ "\$scope_drained" != true \]\]; then drain_test_scope; fi/u);
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

test("Rust emission delegates canonical layout exclusively to bounded rustfmt", () => {
  const materializer = readFileSync(join(sourceRoot, "backend/emission/materialize.ts"), "utf8");
  const formatter = readFileSync(join(sourceRoot, "toolchain/rustfmt.ts"), "utf8");
  const compiler = readFileSync(join(sourceRoot, "backend/compile.ts"), "utf8");
  const session = readFileSync(join(sourceRoot, "compilation/session.ts"), "utf8");
  const pack = readFileSync(join(sourceRoot, "descriptor/target-pack.ts"), "utf8");
  assert.doesNotMatch(materializer, /rustfmt|formatRust/u);
  assert.doesNotMatch(compiler, /rustfmt|RustFormattingError|RUST_SOURCE_FORMATTING_FAILED/u);
  assert.match(session, /return formatResult\(compileRequest\(/u);
  assert.match(pack, /createRustCompilationSession\(context, formatRustCompileResult\)/u);
  assert.match(formatter, /spawnSync/u);
  assert.match(formatter, /rustfmtBatchSize/u);
  assert.match(formatter, /"--edition"/u);
  assert.match(formatter, /"--style-edition"/u);
  assert.match(formatter, /skip_children=true/u);
  assert.match(formatter, /rustfmtTimeoutMilliseconds/u);
  assert.match(formatter, /"--",\n\s+\.\.\.sourcePaths/u);
  assert.match(formatter, /RUST_SOURCE_FORMATTING_FAILED/u);
  assert.doesNotMatch(formatter, /fallback|best.?effort/iu);

  const layoutOnlyFiles = [
    "formatting.ts",
    "expressions/binary-calls.ts",
    "expressions/blocks.ts",
    "expressions/calls.ts",
    "expressions/chains.ts",
    "expressions/fitted.ts",
    "expressions/format-arguments.ts",
    "expressions/initializer-layout.ts",
    "expressions/inspection.ts",
    "expressions/literals.ts",
    "expressions/nested-calls.ts",
  ];
  for (const relativePath of layoutOnlyFiles) {
    assert.equal(existsSync(join(sourceRoot, "print/source", relativePath)), false, relativePath);
  }
  for (const { path, text } of sourceFiles.filter(({ path }) => path.includes("/print/"))) {
    assert.doesNotMatch(text, /node:(?:child_process|fs|os|path)/u, path);
    assert.doesNotMatch(text, /rustFormatWidth|renderedFits|printRustExprFitted/u, path);
  }
});

test("JS operation rows are unique per owner/member/kind/lane/variant", async () => {
  const source = readFileSync(join(sourceRoot, "policy/operations/source-profiles/js/rows.ts"), "utf8");
  assert.match(source, /const jsOperationRows = defineJsOperationRows\(\[/u);
  await import("../../dist/policy/operations/source-profiles/js/index.js");
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
    join(sourceRoot, "policy/operations/source-profiles/js/rows.ts"),
    ...collectFiles(join(sourceRoot, "providers/packages"), ".ts"),
  ];
  for (const path of identitySources) {
    const text = readFileSync(path, "utf8");
    assert.ok(!text.includes("rustLocalBindingName"), `${path} must not recase identities`);
  }
});

test("source profile identity comes from the registered compiler SourceFile, never a path substring", () => {
  const identitySources = [
    join(sourceRoot, "policy/identities/selected-source.ts"),
    ...collectFiles(join(sourceRoot, "analysis/source-evidence/types/resolution"), ".ts"),
  ];
  for (const path of identitySources) {
    const text = readFileSync(path, "utf8");
    const implementation = text.replace(/^import[\s\S]*?from "[^"]+";/gmu, "");
    assert.doesNotMatch(implementation, /source-profiles|tsonicSourceProfileVirtualDirectory|normalizeTargetSourceProfileSegment/u, `${path} reconstructs source-profile ownership from a path`);
  }
  const registry = readFileSync(join(sourceRoot, "analysis/project/source-profiles.ts"), "utf8");
  assert.doesNotMatch(registry, /\.includes\s*\(/u);
  assert.match(registry, /sourceFileByProfile\.get\(profile\)/u);
  assert.match(registry, /existing !== undefined && existing !== sourceFile/u);
  assert.match(registry, /profiles\.get\(sourceFile\)/u);
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
    join(sourceRoot, "analysis/operations/members/calls/selection.ts"),
    "utf8",
  );
  assert.match(semantics, /if \(sourceDeclaration === undefined && calleeDeclaration !== undefined\)/u);
  assert.match(semantics, /binding\.callableDeclaration === sourceDeclaration/u);
  assert.match(semantics, /acceptProjectSourceCall\(request, nativeCallable \? binding\.callableDeclaration : sourceDeclaration/u);
  assert.match(semantics, /const calleeKind = calleeDeclaration === undefined \? undefined : context\.ast\.kindName\(calleeDeclaration\)/u);
  assert.equal(/const callableType = !nativeCallable && !directLexical && \(storedCallable/u.test(semantics), true,
    "source callable admission excludes selected native and direct lexical declarations");
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
    join(sourceRoot, "analysis/operations/members/calls/instantiation.ts"),
    "utf8",
  );
  const selectedCall = sourceSection(
    semantics,
    "function acceptSelectedCall(",
    "function selectedCallReceiverCarrier(",
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
    "function planObjectShapeProjectionCall(",
  );
  assert.match(callPlanner, /requireProviderArgumentPassingFacts\(context, fact, args\)/u);
  const argumentPlanning = readFileSync(
    join(sourceRoot, "backend/planner/expressions/calls/arguments.ts"),
    "utf8",
  );
  const passingGate = argumentPlanning.slice(
    argumentPlanning.indexOf("export function requireProviderArgumentPassingFacts("),
  );
  assert.match(passingGate, /records\.providerArguments\.get\(fact\.abi\) !== true/u);
  assert.match(passingGate, /arguments_\.length !== fact\.abi\.sourceArguments\.length/u);
  assert.match(passingGate, /arguments_\.some\(argument => argument === undefined\)/u);
  assert.match(passingGate, /failRustPlannerInvariant/u);
  const admission = readFileSync(join(sourceRoot, "analysis/operations/call-admission.ts"), "utf8");
  assert.match(admission, /argumentPassing\.get\(argument\)/u);
});

test("optional chains consume exact TSTS evidence through one finalized Option fact", () => {
  const contracts = readFileSync(join(sourceRoot, "policy/model/contracts.ts"), "utf8");
  assert.match(contracts, /readonly source: ResolvedSourceCallInfo/u);
  assert.doesNotMatch(contracts, /readonly optionalChain: ResolvedSourceCallInfo/u);
  assert.doesNotMatch(contracts, /readonly sourceReceiver\?: ResolvedSourceCallInfo/u);
  assert.match(contracts, /readonly sourceReceiverType\?: Type/u);

  const semantics = readFileSync(
    join(sourceRoot, "analysis/operations/members/result.ts"),
    "utf8",
  );
  assert.match(semantics, /selectedMemberReceiverCarrier\(request, context, options\)/u);
  assert.match(semantics, /selectRustOptionalChain\(\{/u);
  const receiverOwner = semantics.slice(semantics.indexOf("function memberReceiverSourceCarrier("),
    semantics.indexOf("export function selectedMemberReceiverCarrier("));
  assert.match(receiverOwner, /records\.selectedOperation\.get\(receiver\)/u);
  assert.match(receiverOwner, /return \{ carrier: selected\.resultType, physical: true \}/u);
  assert.match(receiverOwner, /records\.preparedOperationResult\.get\(receiver\)/u);
  assert.match(receiverOwner, /return \{ carrier: prepared\.resultCarrier, physical: true \}/u);
  assert.match(receiverOwner, /return \{ carrier: resolveRustTargetTypeRef\(request\.receiver, context, options\), physical: false \}/u);
  assert.doesNotMatch(receiverOwner, /rustOption(?:Element|Value)Carrier|rustTargetOperationResultCarrier/u);
  assert.match(semantics, /sourceReceiverCarrier = receiver === undefined \? undefined\s*: memberReceiverSourceCarrier\(request, receiver, context, options\)\.carrier/u);
  assert.match(semantics, /sourceGuardCarrier = sourceReceiverCarrier/u);
  assert.match(semantics, /selectedGuardCarrier = operationReceiverCarrier/u);
  assert.doesNotMatch(semantics, /sourceReceiverDeclaration/u);
  assert.match(semantics, /request\.optionalChain/u);
  assert.match(semantics, /selectedMemberReceiverCarrier\(request, context, options\)/u);
  assert.match(semantics, /requireRustRecord\(context\.requiredRecords, "optionalChain", request\.expression, selection\.fact\.operationKind/u);
  assert.match(semantics, /records\.optionalChains\.guard\(request\.expression, selection\.fact\.guard, selection\.fact\.operationKind, selection\.fact\)/u);
  assert.doesNotMatch(semantics, /records\.optionalChain\.set\(/u);
  assert.doesNotMatch(semantics, /rustOptionalChainFactKey/u);
  const producer = readFileSync(join(sourceRoot, "analysis/program/records/optional-chain.ts"), "utf8");
  assert.match(producer, /id: "tsonic\.rust\.optionalChain"/u);
  assert.match(producer, /family\.writer\.set\(expression, Object\.freeze\(\{ expression, guard, operationKind,/u);

  const selector = readFileSync(join(sourceRoot, "policy/operations/flow/optional-chains.ts"), "utf8");
  assert.match(selector, /rustOptionNestingDepth\(sourceGuardCarrier, selectedGuardCarrier\)/u);
  assert.match(selector, /guardDepth === undefined \|\| guardDepth === 0/u);
  assert.doesNotMatch(selector, /getResolved|getSymbolAtLocation|getTypeAtLocation|getPropertyOfType/u);
  assert.doesNotMatch(selector, /memberName|propertyName|sourceName|targetName/u);

  const planner = readFileSync(join(sourceRoot, "backend/planner/expressions/optional-chains.ts"), "utf8");
  assert.match(planner, /optionalChainEmission\.get\(node\)/u);
  assert.match(planner, /planRawExpression\(fact\.guard, context, "value"\)/u);
  assert.doesNotMatch(planner, /planRustNonConsumingValue|rustReadRequiresClone/u);
  const ownershipUses = readFileSync(join(sourceRoot, "analysis/ownership/uses.ts"), "utf8");
  assert.match(ownershipUses, /records\.optionalChain\.get\(node\)\?\.guard/u);
  assert.match(planner, /overrides\.set\(fact\.guard/u);
  const emission = readFileSync(join(sourceRoot, "analysis/operations/optional-chains.ts"), "utf8");
  assert.match(emission, /guardDepth/u);
  assert.doesNotMatch(planner, /rustOptionNestingDepth|resolveRustTargetTypeRef/u);
  assert.doesNotMatch(planner, /getResolved|getSymbolAtLocation|getTypeAtLocation|getPropertyOfType/u);
});

test("plain identifier binding cannot become a provider-value identity workaround", () => {
  const semantics = readFileSync(join(sourceRoot, "analysis/source-evidence/types/resolution/references.ts"), "utf8");
  const resolver = sourceSection(semantics, "export function resolveIdentifierCarrier(", "export function resolveCallLikeCarrier(");
  const variable = sourceSection(resolver, "if (declarationKind === KindVariableDeclaration) {",
    "if (declarationKind === KindParameter) {");
  assert.match(variable, /selectRustDeclaredBinding\(walk, declaration, sourceFile\)/u);
  assert.match(variable, /selected\.kind === "unresolved" \? undefined : setCarrierFact\(walk, identifier, selected\.carrier\)/u);
  const parameter = sourceSection(resolver, "if (declarationKind === KindParameter) {\n      const parameter =",
    "if (declarationKind === KindBindingElement) {");
  assert.match(parameter, /records\.sourceParameterAbi\.get\(declaration\)/u);
  assert.match(parameter, /if \(parameter === undefined\) return undefined/u);
  assert.match(parameter, /setCarrierFact\(walk, identifier, parameter\.valueCarrier\)/u);
  assert.match(resolver, /records\.bindingProjection\.get\(declaration\)/u);
  assert.doesNotMatch(resolver, /resolveRustDeclaredBindingStorage/u);
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
  const text = readFileSync(join(sourceRoot, "analysis/source-evidence/types/resolution/target.ts"), "utf8");
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
  assert.match(semantics, /selectRustModuleValueStorage\(/u);
  const storage = readFileSync(join(sourceRoot, "policy/types/storage/module-bindings.ts"), "utf8");
  assert.match(semantics, /hasFirstClassUse\(declaration\)/u);
  assert.match(storage, /storage: "module-cell"/u);
  const runtimeUses = readFileSync(
    join(sourceRoot, "analysis/program/runtime-value-uses.ts"),
    "utf8",
  );
  assert.match(runtimeUses, /navigation\.declarationUses\(declaration\)/u);
  assert.match(runtimeUses, /use\.kind !== "first-class"/u);
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
      readFileSync(join(sourceRoot, "backend/planner/expressions/constructions.ts"), "utf8"),
      "export function planNewExpression(",
      undefined,
    ],
    [
      "property",
      readFileSync(join(sourceRoot, "backend/planner/expressions/properties.ts"), "utf8"),
      "export function planPropertyAccess(",
      "function planSourceFieldRead(",
    ],
    [
      "indexer",
      readFileSync(join(sourceRoot, "backend/planner/expressions/elements.ts"), "utf8"),
      "export function planElementAccess(",
      "function planIndexedProjection(",
    ],
  ];
  for (const [lane, text, start, end] of lanes) {
    const section = end === undefined ? text.slice(text.indexOf(start)) : sourceSection(text, start, end);
    assert.match(text, /(?:rustOperationFact\(node, context\)|records\.targetOperation\.get\(node\))/u, `${lane} must read the finalized Rust operation fact`);
    assert.match(text, /failRustPlannerInvariant/u, `${lane} must reject a missing admitted fact through the invariant owner`);
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
    join(sourceRoot, "backend/planner/statements/statement-loops.ts"),
    "utf8",
  );
  const admission = readFileSync(
    join(sourceRoot, "analysis/control-flow/statement-completion.ts"),
    "utf8",
  );
  const providerLowering = sourceSection(
    expressions,
    "export function planProviderOperationExpression(",
    "export function finishProviderOperationExpression(",
  );
  const runtimeSet = sourceSection(
    statements,
    "export function planRuntimeSetStatement(",
    "export function planForOfStatement(",
  );
  const setterAdmission = sourceSection(admission, "  const setter = (", "  const assignment = (");
  const setterInputs = sourceSection(admission, "export function rustRuntimeSetSourceInputs(",
    "export function analyzeRustStatementCompletions(");
  const finalization = readFileSync(join(sourceRoot, "policy/operations/members/abi/finalize.ts"), "utf8");
  assert.match(finalization, /validateRustFinalizedOperationAbi\(abi, definitions\)/u);
  assert.doesNotMatch(providerLowering, /validateRustFinalizedOperationAbi|rustTargetTypeRefEquals/u);
  for (const [name, section] of [["provider expression", providerLowering], ["runtime setter admission", setterInputs]]) {
    assert.match(section, /\.abi\.(?:targetReceiver|targetArguments|result|sourceArguments)/u, `${name} must consume finalized ABI fields`);
    assert.doesNotMatch(section, /\.argModes|\.argOrder|\.argConversions|\.receiverMode|\.indexConversion|\.resultConversion|\.parameterCarriers|\.sourceArgumentCount/u, `${name} must not interpret sparse authoring metadata`);
  }
  const runtimeExpression = readFileSync(join(sourceRoot, "backend/planner/expressions/runtime-setters.ts"), "utf8");
  assert.match(runtimeSet, /planRustRuntimeSetExpression\(expression, fact, context\)/u);
  assert.match(runtimeExpression, /records\.runtimeSetter\.get\(expression\)/u);
  assert.equal(/planProviderOperationExpression\(context, fact, admitted\.receiver, admitted\.sourceArguments, expression/u.test(runtimeExpression), true,
    "runtime setters use the same total-ABI guard and renderer as provider expressions");
  assert.equal(/planRustFinalizedOperationForm\(context, fact\.abi, receiver, args, operationNode/u.test(providerLowering), true,
    "both finalized operation kinds use the canonical operation-form renderer");
  assert.match(expressionFacts, /records\.targetOperation\.get\(node\)/u);
  assert.doesNotMatch(expressionFacts, /providerSelectedCallMatches|selectedCall\.get/u);
  assert.match(setterInputs, /operation\.abi\.operationKind !== expectedKind/u);
  assert.match(setterAdmission, /const inputs = rustRuntimeSetSourceInputs\(ast, node, operation\)/u);
  assert.match(setterAdmission, /if \(inputs === undefined\) \{\s*reject\(node, "RUST_SETTER_ABI_NOT_PROVEN"/u);
  assert.match(setterAdmission, /publish\(setters, node, inputs\)/u);
  assert.match(runtimeExpression, /finishProviderOperationExpression\(context, fact, native, expression\)/u);
  assert.match(setterAdmission, /runtimeCarrier\.get\(value\)/u);
  assert.equal(/selected\?\.operationKind === "operator"/u.test(setterAdmission), true,
    "setter admission requires the selected operator kind");
  assert.equal(/selected\.operationId === operation\.operationId/u.test(setterAdmission), true,
    "setter admission retains the exact selected operation identity");
  assert.equal(/selected\.targetOperation === operation\.operationId/u.test(setterAdmission), true,
    "setter admission retains the exact selected target operation");
  assert.equal(/rustTargetTypeRefEquals\(selected\.resultType, records\.runtimeCarrier\.get\(value\)\?\.carrier\)/u.test(setterAdmission), true,
    "setter admission retains the exact checked result carrier");
});

test("operation target shape and source-call effects have one finalized owner", () => {
  const keys = readFileSync(join(sourceRoot, "target-model/records/operations.ts"), "utf8");
  const abi = readFileSync(join(sourceRoot, "target-model/records/finalized-operation.ts"), "utf8");
  const expressions = collectFiles(join(sourceRoot, "backend/planner/expressions"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const statements = collectFiles(join(sourceRoot, "backend/planner/statements"), ".ts")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const sourceCallFacts = readFileSync(join(sourceRoot, "target-model/records/program.ts"), "utf8");
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
  assert.match(sourceCallFacts, /readonly sourceCallEffects: RustRecordFamily<RustSourceCallEffectsFact>/u);
  assert.match(expressions, /sourceCallEffects\.get\(/u);
  assert.doesNotMatch(expressions, /convertedCarrier\s*\?\?\s*sourceCarrier/u);
  assert.doesNotMatch(expressions, /rust\.core\.Future/u);
  assert.doesNotMatch(statements, /assign_op_pattern|compoundAssignmentOperator/u);
});

test("backend conversion planning never reconstructs assertion kinds from source syntax", () => {
  const text = readFileSync(join(sourceRoot, "backend/planner/expressions/source-conversions.ts"), "utf8");
  assert.doesNotMatch(text, /isConstAssertion|TypeReferenceNode_TypeName/u);
  assert.match(text, /records\.sourceAssertion\.get\(node\)/u);
});

test("call-argument conversion consumes the checked expression carrier, not a semantic-type reconstruction", () => {
  const semantics = readFileSync(
    join(sourceRoot, "analysis/operations/members/conversions.ts"),
    "utf8",
  );
  const callArgument = sourceSection(
    semantics,
    'if (request.conversionKind === "call-argument") {',
    "  const sourceCarrier = rustEffectiveValueCarrier(context.records, request.sourceExpression)",
  );
  assert.match(callArgument, /rustEffectiveValueCarrier\(context\.records, request\.expression\)/u);
  assert.match(callArgument, /resolveRustTargetTypeRef\(request\.expression, context, options\)/u);
  assert.doesNotMatch(callArgument, /resolveRustTargetTypeRef\(request\.source, context, options\)/u);
  assert.doesNotMatch(callArgument, /asNode\(request\.source, context\)/u);
});

test("backend assignment and nullish checks consume finalized fact details", () => {
  const statements = readFileSync(
    join(sourceRoot, "backend/planner/statements/statement-simple.ts"),
    "utf8",
  );
  const expressions = readFileSync(join(sourceRoot, "backend/planner/expressions/binary.ts"), "utf8");
  const semantics = readFileSync(join(sourceRoot, "analysis/operations/operators.ts"), "utf8");
  const operators = readFileSync(join(sourceRoot, "policy/operations/operators/rules.ts"), "utf8");
  assert.match(statements, /records\.assignmentCompletion\.get\(expression\)/u);
  assert.match(statements, /records\.assignmentWrite\.get\(expression\)/u);
  assert.match(statements, /if \(completion === undefined\) failRustPlannerInvariant/u);
  assert.doesNotMatch(statements, /sourceReferenceFor|selectRustEquivalentAssignment/u);
  const writes = readFileSync(join(sourceRoot, "analysis/storage/assignment-writes.ts"), "utf8");
  assert.match(writes, /"in-place-string-append-parts"/u);
  assert.match(writes, /"in-place-string-append-value"/u);
  assert.match(semantics, /targetReference\.symbol !== valueReference\.symbol/u);
  assert.match(semantics, /targetReference\.declaration !== valueReference\.declaration/u);
  assert.match(semantics, /"in-place-string-append-parts"/u);
  assert.match(semantics, /"in-place-string-append-value"/u);
  assert.match(operators, /export function selectRustEquivalentAssignment\(/u);
  assert.match(expressions, /fact\.optionOperand === "left" \? leftNode : rightNode/u);
  assert.doesNotMatch(expressions, /runtimeCarrier\.get\(leftNode\)/u);
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
    join(sourceRoot, "backend/planner/statements/statement-for.ts"),
    "utf8",
  );
  assert.match(targetProgram, /analyzeRustCountedLoopRepresentations\(/u);
  assert.match(analysis, /input\.navigation\.countedLoop\(statement\)/u);
  assert.match(analysis, /fact\.abi\.effects\.evaluation === "pure"/u);
  assert.match(analysis, /carrierHasIndependentScalarValue/u);
  assert.doesNotMatch(analysis, /isRustCopyCarrier/u);
  assert.match(planning, /program\.records\.countedLoop\.get\(node\)/u);
  assert.doesNotMatch(planning, /sourceNavigation\.countedLoop|expressionEffects|declarationUseSummary/u);
  assert.doesNotMatch(analysis, /\.text\([^)]*bound|memberName|propertyName|sourceName|targetName/u);
});

test("provider purity uses one generic operation-form writability policy", () => {
  const forms = readFileSync(
    join(sourceRoot, "target-model/operations/form-inputs.ts"),
    "utf8",
  );
  const providerValidation = readFileSync(
    join(sourceRoot, "providers/packages/validation/operations.ts"),
    "utf8",
  );
  const jsRows = readFileSync(
    join(sourceRoot, "policy/operations/source-profiles/js/model.ts"),
    "utf8",
  );
  const finalization = readFileSync(
    join(sourceRoot, "policy/operations/members/abi/finalize.ts"),
    "utf8",
  );
  assert.match(forms, /export function rustProviderOperationFormDeclaresWritableInput\(/u);
  assert.match(providerValidation, /rustProviderOperationFormDeclaresWritableInput\(row\.target\)/u);
  assert.match(jsRows, /rustProviderOperationFormDeclaresWritableInput\(row\.shape\.target\)/u);
  assert.match(finalization, /rustFinalizedTargetInputMayMutateSource/u);
  assert.doesNotMatch(providerValidation, /function operationFormDeclaresMutableInput/u);
});

test("operation carriers and selected identities are admitted before native rendering", () => {
  const calls = readFileSync(join(sourceRoot, "analysis/callables/source-calls.ts"), "utf8");
  const arguments_ = readFileSync(join(sourceRoot, "analysis/callables/source-call-arguments.ts"), "utf8");
  const binary = readFileSync(join(sourceRoot, "analysis/operations/binary-emission.ts"), "utf8");
  const unary = readFileSync(join(sourceRoot, "analysis/operations/expression-unary.ts"), "utf8");
  const closure = readFileSync(join(sourceRoot, "analysis/callables/lambda-emission.ts"), "utf8");
  const provider = readFileSync(join(sourceRoot, "analysis/operations/provider-inputs.ts"), "utf8");
  assert.match(calls, /sourceCallEffectsMatch\(fact, effects, program\.typeDefinitions, native, method\)/u);
  assert.match(arguments_, /sourceCallSelectedMemberMatches\(fact, selectedCall/u);
  for (const source of [binary, unary]) {
    assert.match(source, /records\.selectedOperation\.get\(node\)/u);
    assert.match(source, /rustTargetTypeRefEquals\(selected\.resultType, (?:fact\.resultCarrier|carrier)\)/u);
  }
  assert.match(closure, /rustTargetTypeRefEquals\(protocol\.result, resultCarrier\)/u);
  assert.match(provider, /rustFinalizedCarrierTransitionMatches\(carrier, converted, input\.sourceCarrier\)/u);
  const expressions = collectFiles(join(sourceRoot, "backend/planner/expressions"), ".ts")
    .map(path => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(expressions, /requireExpressionCarrier|sourceCallEffectsMatch|providerSelectedCallMatches|sourceCallSelectedMemberMatches/u);
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
  const sourceArrays = readFileSync(join(sourceRoot, "analysis/operations/array-literals.ts"), "utf8");
  const sourceCallables = readFileSync(join(sourceRoot, "analysis/callables/lambda-emission.ts"), "utf8");
  assert.match(sourceArrays, /presentElements\.length/u);
  assert.match(sourceArrays, /Fixed-array literal has/u);
  assert.match(sourceCallables, /parameters\.length - leading\.length !== sourceParameters\.length/u);
  assert.match(sourceCallables, /sourceParameters\.map\(\(parameter, index\) =>/u);
  assert.match(sourceCallables, /if \(parameter === undefined\) failTargetAnalysisInvariant/u);
  assert.match(declarations, /planBlockLike\(bodyNode, bodyContext\)/u);
  assert.match(statements, /planStatementSequence\(children, node, construction\?\.context \?\? context\)/u);
  assert.equal(/const child = children\[index\];\s*if \(child === undefined\) \{\s*failRustPlannerInvariant\("Statement sequence requires its dense checked source nodes\.", diagnosticNode\)/u.test(statements), true,
    "an undefined checked source slot fails the dense-sequence invariant instead of disappearing");
  const enumAdmission = readFileSync(join(sourceRoot, "analysis/declarations/enum-facts.ts"), "utf8");
  const interfaceAdmission = readFileSync(join(sourceRoot, "analysis/declarations/native-value-declarations.ts"), "utf8");
  assert.match(enumAdmission, /if \(!isDenseDataArray\(members\) \|\| members\.some\(member => member === undefined\)\) \{\s*appendRustDiagnostic\(walk, "RUST_SOURCE_AST_INCOMPLETE",\s*"Enum declaration contains an undefined member slot\."/u);
  assert.match(interfaceAdmission, /if \(!isDenseDataArray\(members\) \|\| members\.some\(member => member === undefined\)\) \{\s*return reject\(declaration, "RUST_SOURCE_AST_INCOMPLETE", "Interface declaration contains an undefined member slot\."/u);
  assert.match(semantics, /RUST_SOURCE_AST_INCOMPLETE/u);
  assert.match(semantics, /function requireDenseSourceNodes\(/u);
  assert.match(semantics, /isDenseDataArray\(rawSourceFiles\)/u);
  assert.doesNotMatch(semantics, /getSourceFiles\(\)\s*\.filter\([^;]+sourceFile !== undefined/su);
  assert.doesNotMatch(semantics, /if \((?:statement|member|parameter) === undefined\) \{\s*continue;\s*\}/u);
  assert.doesNotMatch(expressions, /ast\.arguments\(node\)\.filter\([^;]+!== undefined/su);
  assert.doesNotMatch(semantics, /ast\.elements\(expression\)\.filter\(\(element\): element is Node => element !== undefined\)/u);
});

test("project-source admission requires the exact finalized selected member ABI", () => {
  const expressions = readFileSync(
    join(sourceRoot, "analysis/callables/source-call-evidence.ts"),
    "utf8",
  );
  const selectedGate = expressions.slice(expressions.indexOf("export function sourceCallSelectedMemberMatches("));
  assert.match(selectedGate, /member\.id !== fact\.operationId/u);
  assert.match(selectedGate, /member\.kind !== expectedKind/u);
  assert.match(selectedGate, /member\.targetName !== expectedName/u);
  assert.match(selectedGate, /member\.parameters\.length === fact\.parameters\.length/u);
  assert.match(selectedGate, /selected\.sourceSelectedMethodTypeArguments/u);
  assert.match(selectedGate, /substituteRustTargetGenerics/u);
  assert.match(selectedGate, /fact\.targetGenericArguments/u);
  assert.match(selectedGate, /const selectedParameter = fact\.parameters\[index\];/u);
  assert.match(selectedGate, /if \(selectedParameter === undefined\) return false;/u);
  assert.match(selectedGate, /mapRustTargetTypes\(selectedParameter\.parameterCarrier, normalize\)/u);
  assert.match(selectedGate, /mapRustTargetTypes\(fact\.asyncBody\?\.logicalResultCarrier \?\? resultProjection\?\.sourceCarrier \?\? fact\.resultCarrier, normalize\)/u);
  assert.match(selectedGate, /rustTargetTypeRefEquals\(resultProjection\.selectedCarrier, fact\.resultCarrier\)/u);
  assert.match(selectedGate, /rustSourceCallResultProjectionMatches\(sourceProjection, resultProjection, instantiateResult/u);
  assert.match(selectedGate, /\(sourceProjection === undefined\) !== \(resultProjection === undefined\)/u);
  assert.match(selectedGate, /mode === selectedParameter\.mode/u);
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
  const nodes = readFileSync(join(sourceRoot, "backend/target-ast/syntax/nodes.ts"), "utf8");
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
  const conversions = readFileSync(join(sourceRoot, "policy/conversions/contracts.ts"), "utf8");
  assert.match(conversions, /function rustValueConversionContract/u);
  assert.match(conversions, /selectRustIntrinsicConversionContract\(value\.id\)/u);
  const intrinsic = readFileSync(join(sourceRoot, "policy/conversions/intrinsic-contracts.ts"), "utf8");
  assert.match(intrinsic, /case "checked-i32-to-usize"/u);
  assert.match(intrinsic, /case "js-number-from-usize"/u);
});

test("source-package semantics are sealed before physical Rust planning", () => {
  const facadeAnalysis = readFileSync(
    join(sourceRoot, "analysis/source-modules/facade-contracts.ts"),
    "utf8",
  );
  const facadePlanner = readFileSync(
    join(sourceRoot, "backend/planner/program/source-package-facades.ts"),
    "utf8",
  );
  assert.match(facadeAnalysis, /source\.navigation\.moduleExports/u);
  assert.match(facadeAnalysis, /exportsForComponent/u);
  assert.doesNotMatch(facadePlanner, /moduleExports\s*\(/u);
  assert.match(facadePlanner, /program\.records\.sourcePackageFacades\.get/u);

  const componentAnalysis = readFileSync(
    join(sourceRoot, "analysis/source-modules/component-semantics.ts"),
    "utf8",
  );
  const componentPlanner = readFileSync(
    join(sourceRoot, "backend/planner/program/source-package-components.ts"),
    "utf8",
  );
  assert.match(componentAnalysis, /publishesImplementationAbi/u);
  assert.match(componentAnalysis, /errorOwnerComponentId/u);
  assert.match(componentAnalysis, /errorOwners\.get/u);
  assert.match(componentPlanner, /program\.records\.sourcePackageComponents\.get/u);
  assert.doesNotMatch(
    componentPlanner,
    /programErrorDefinitions|componentReachesError|errorOwners\.|configuration\.outputType/u,
  );
});

test("Rust dead-code obligations consume sealed reachability and normalize before output sealing", () => {
  const livenessPlan = readFileSync(
    join(sourceRoot, "analysis/reachability/plan.ts"),
    "utf8",
  );
  const generatedUsage = readFileSync(
    join(sourceRoot, "analysis/reachability/generated-item-usage.ts"),
    "utf8",
  );
  const generatedState = readFileSync(
    join(sourceRoot, "analysis/reachability/generated-item-usage-state.ts"),
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
    join(sourceRoot, "backend/planner/program/reachability-directives.ts"),
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
  const initializationAnalysis = readFileSync(
    join(sourceRoot, "analysis/errors/initialization.ts"),
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
  assert.match(livenessPlan, /publishesImplementationAbi/u);
  assert.match(livenessPlan, /program\.moduleInitialization\.requirementFor\(sourceFile\)\.kind === "required"/u);
  assert.doesNotMatch(livenessPlan, /rustBinaryEntryDeclaration/u);
  assert.match(generatedUsage, /input\.records\.targetOperation\.get\(node\)/u);
  assert.doesNotMatch(generatedUsage, /rustTargetOperationFactKey/u);
  assert.equal(generatedUsage.match(/createRustGeneratedItemUsageState\(input\)/gu)?.length, 1);
  for (const query of ["structuralCarriers", "constructedProjectTypes", "usedProjectFields", "declarationVariants"]) {
    const declaration = new RegExp(`\\b${query}\\s*[:,]`, "u");
    assert.match(generatedState, declaration);
    assert.doesNotMatch(generatedUsage, declaration);
  }
  assert.doesNotMatch(generatedState, /sourceNavigation|declarationUseSummary|referencesToDeclaration|forEachChild/u);
  assert.match(targetProgram, /readonly reachability:.*RustReachability/u);
  assert.doesNotMatch(planningContext, /createRustPlannerLiveness|analyzeRustReachability|liveness:/u);
  const declarations = readFileSync(join(sourceRoot, "analysis/reachability/declaration-emission.ts"), "utf8");
  const structures = readFileSync(join(sourceRoot, "analysis/reachability/structural-emission.ts"), "utf8");
  assert.match(declarations, /reachability\.suppressedDeclarations\.has/u);
  assert.match(declarations, /reachability\.readAuthoredFields\.has/u);
  assert.match(declarations, /reachability\.constructedProjectTypes\.has/u);
  assert.match(declarations, /reachability\.usedProjectFields\.get/u);
  assert.match(structures, /reachability\.structuralCarriers\.get/u);
  assert.match(directives, /records\.authoredLiveness\.get/u);
  assert.match(directives, /records\.structuralLiveness\.get/u);
  assert.doesNotMatch(directives, /program\.reachability|fieldsRead|fieldsWritten|constructedProjectTypes/u);
  assert.doesNotMatch(directives, /structuralCarriers\.get\([^)]*\)\?\.constructed/u);
  assert.equal(existsSync(join(sourceRoot, "backend/planner/liveness")), false,
    "the superseded planner reachability implementation is removed");
  for (const source of sourceFiles.filter(file => file.path.startsWith(join(sourceRoot, "analysis/reachability") + sep))) {
    assert.doesNotMatch(source.text, /from\s+["'][^"']*backend\//u, source.path);
  }
  const reachabilityModel = readFileSync(join(sourceRoot, "analysis/reachability/model.ts"), "utf8");
  const generatedModel = readFileSync(join(sourceRoot, "analysis/reachability/generated-item-usage-model.ts"), "utf8");
  const recordModel = readFileSync(join(sourceRoot, "target-model/records/reachability.ts"), "utf8");
  assert.doesNotMatch(reachabilityModel, /readonly\s+\w+\s*:\s*\([^)]*\)\s*=>|\n\s+\w+\([^)]*\)\s*:/u);
  assert.doesNotMatch(recordModel, /readonly\s+\w+\s*:\s*\([^)]*\)\s*=>|\n\s+\w+\([^)]*\)\s*:/u);
  assert.doesNotMatch(
    directives,
    /sourceNavigation|declarationUseSummary|referencesToDeclaration/u,
  );
  assert.match(normalization, /rustDeadCodeAttribute\(deadCode\)/u);
  assert.match(normalization, /const \{ deadCode, \.\.\.withoutDeadCode \} = owner/u);
  assert.match(outputPlanning, /finalizeRustDeadCode\(/u);
  assert.equal(/const entrySourceFile = initialization\.entrySourceFile/u.test(outputPlanning), true,
    "binary startup consumes the sealed authored entry module");
  assert.equal(/roots\.set\(input\.ast\.getFileName\(file\), file\)/u.test(initializationAnalysis), true,
    "initialization analysis retains the exact selected source identity");
  assert.equal(/resolveProjectEntrySourceFile|resolveLibraryInitializationRoots/u.test(outputPlanning), false,
    "native planning never independently reselects semantic initialization roots");
  assert.equal(/resolveBinaryEntry/u.test(outputPlanning), false, "binary startup never selects an implicit callable");
  assert.equal(existsSync(join(sourceRoot, "backend/planner/program/entry-point.ts")), false,
    "the superseded planner entry selector is removed");
  assert.equal(/byFileName = new Map\(input\.sourceFiles\.map/u.test(initializationAnalysis), true,
    "entry selection uses the exact checked source collection");
  assert.equal(/const file = byFileName\.get\(path\)/u.test(initializationAnalysis), true,
    "the selected entry retains the checked source object");
  assert.equal(/rustBinaryEntryDeclaration|hasModifierKind|returnCarrier|parameters\(statement\)|typeParameters\(statement\)/u.test(initializationAnalysis), false,
    "entry source selection does not reconstruct a main declaration contract");
  for (const [attribute, level, reason] of [
    [rustLintAttributes.authoredDeadCode, "allow", "retains an unused authored declaration"],
    [rustLintAttributes.authoredUnreadField, "allow", "retains an unread authored field"],
    [rustLintAttributes.generatedUnusedStorage, "expect", "retains unused generated storage"],
  ]) {
    assert.deepEqual(attribute, { kind: "list", path: level, arguments: [
      { kind: "word", path: "dead_code" }, { kind: "value", path: "reason", value: { kind: "string", value: reason } },
    ] });
  }
  assert.doesNotMatch(lintPolicy, /preserves the checked source contract/u);
});

test("Rust build and test entrypoints honor one explicit Tsonic checkout root", () => {
  const buildScript = readFileSync(join(repositoryRoot, "scripts/build.sh"), "utf8");
  const testWorker = readFileSync(join(repositoryRoot, "scripts/test-worker.sh"), "utf8");
  const rootRegistration = readFileSync(
    join(repositoryRoot, "scripts/register-tsonic-root-loader.mjs"),
    "utf8",
  );

  assert.match(buildScript, /configured_tsonic_root="\$\{TSONIC_ROOT:-/u);
  assert.match(buildScript, /export TSONIC_ROOT/u);
  assert.match(buildScript, /"typeRoots": \["\$TSONIC_ROOT\/node_modules\/@types"\]/u);
  assert.doesNotMatch(
    buildScript,
    /TSONIC_ROOT="\$\(cd "\$REPO_ROOT\/\.\.\/tsonic"/u,
  );
  assert.equal(testWorker.match(/--import "\$loader_registration"/gu)?.length, 1);
  assert.match(testWorker, /--repository-root "\$PWD"/u);
  assert.match(testWorker, /--with-preruns/u);
  const suites = readFileSync(join(process.env.TSONIC_ROOT ?? resolve(repositoryRoot, "../tsonic"),
    "test/scripts/suite-definition.mjs"), "utf8");
  assert.match(suites, /nodeArguments: \["--import", resolve\(repos\.tsonicRust, "scripts\/register-tsonic-root-loader\.mjs"\)\]/u);
  assert.match(suites, /args: \["--import", resolve\(repos\.tsonicRust, "scripts\/register-tsonic-root-loader\.mjs"\), "-e"/u);
  assert.match(rootRegistration, /registerHooks\(\{ resolve: resolveFromConfiguredTsonic \}\)/u);
  assert.match(rootRegistration, /process\.env\.TSONIC_ROOT \?\? defaultRoot/u);
  assert.match(rootRegistration, /configuredEntrypoints\.get\(specifier\)/u);
  assert.match(rootRegistration, /configuredTsonicSpecifier\(specifier, context\.parentURL\)/u);
  assert.match(rootRegistration, /nextResolve\(configuredSpecifier \?\? specifier, context\)/u);
  assert.match(rootRegistration, /requestedUrl\.startsWith\(defaultPrefix\)/u);
  assert.match(rootRegistration, /result\.url\.startsWith\(defaultPrefix\)/u);
  assert.match(rootRegistration, /url: `\$\{configuredPrefix\}/u);
});

test("sealed Rust project-type queries never re-enter source navigation", () => {
  const text = readFileSync(
    join(sourceRoot, "analysis/project-types/catalog/resolution.ts"),
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
