import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  TargetArtifact,
  TargetCompileInput,
  TargetCompileResult,
  TargetDiagnostic,
  TargetSourceFile,
} from "@tsonic/target-api";
import {
  KindFunctionDeclaration,
  KindIdentifier,
  KindImportDeclaration,
  KindVariableStatement,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import { readRustCrateName, readRustOutputType } from "../../options/rust-target-options.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import { createRustSourceFile } from "../rust-ast/nodes.js";
import type { RustItem } from "../rust-ast/nodes.js";
import { printRustSourceFile } from "../../print/rust-printer.js";
import { printCargoManifest } from "../../print/cargo-manifest-printer.js";
import { planCargoManifest } from "./cargo-project.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic, unsupportedStatementDiagnostic } from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planFunctionDeclaration } from "./functions.js";
import { diagnosticInput, isUpperSnakeName, isValidRustIdentifier, rustReservedIdentifiers, rustRuntimeAliasImports } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { isConstLiteralInitializer } from "./statements.js";
import { rustFallibleFactKey } from "../../source/rust-facts/keys.js";
import { planClassDeclaration, planEnumDeclaration, planInterfaceDeclaration, planUnionAliasDeclaration } from "./declarations-nominal.js";

export function planRustArtifacts(input: TargetCompileInput): TargetCompileResult {
  const diagnostics: TargetDiagnostic[] = [];
  const moduleNameByFileName = planModuleNames(input, diagnostics);
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const moduleItems = new Map<string, readonly RustItem[]>();
  const moduleAliases = new Map<string, ReadonlySet<string>>();
  for (const sourceFile of input.sourceFiles) {
    const fileName = input.ast.getFileName(sourceFile);
    const moduleName = moduleNameByFileName.get(fileName);
    if (moduleName === undefined) {
      continue;
    }
    const context: RustPlanContext = {
      input,
      sourceFile,
      moduleName,
      moduleNameByFileName,
      diagnostics,
      awaitedCalls: new WeakSet(),
      usedAliases: new Set<string>(),
    };
    moduleItems.set(moduleName, planModuleItems(context));
    moduleAliases.set(moduleName, context.usedAliases ?? new Set());
  }

  // Activation: a runtime crate is a dependency only when planned code
  // references it (directly or through a declared alias). Surface-selected
  // crates without carrier/operation use stay out of the manifest.
  const manifestPlan = planCargoManifest(input.target, input.runtimeReferences);
  if (manifestPlan.manifest === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...manifestPlan.diagnostics] };
  }

  const outputType = readRustOutputType(input.target);
  const entryFunction = outputType === "bin"
    ? resolveBinaryEntry(input, moduleNameByFileName, diagnostics)
    : undefined;

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedModuleNames = [...moduleItems.keys()].sort((left, right) => left.localeCompare(right, "en"));
  const artifacts: TargetArtifact[] = [
    {
      kind: "project",
      path: "Cargo.toml",
      text: printCargoManifest(manifestPlan.manifest),
    },
  ];
  const libraryModel = createRustSourceFile(
    sortedModuleNames.map((name): RustItem => ({ kind: "mod-decl", name, pub: true })),
  );
  artifacts.push(rustSourceArtifact("src/lib.rs", printRustSourceFile(libraryModel)));
  for (const moduleName of sortedModuleNames) {
    const items = moduleItems.get(moduleName) ?? [];
    // Structured import requirements collected during planning; never
    // inferred from rendered text.
    const aliases = [...(moduleAliases.get(moduleName) ?? new Set<string>())].sort((left, right) => left.localeCompare(right, "en"));
    const useItems: RustItem[] = aliases
      .map((alias) => rustRuntimeAliasImports.get(alias))
      .filter((entry): entry is { path: string; alias: string } => entry !== undefined)
      .map((entry) => ({ kind: "use", path: entry.path, alias: entry.alias }));
    artifacts.push(rustSourceArtifact(`src/${moduleName}.rs`, printRustSourceFile(createRustSourceFile([...useItems, ...items]))));
  }
  if (outputType === "bin" && entryFunction !== undefined) {
    const crateName = readRustCrateName(input.target);
    const entryCall = {
      kind: "call" as const,
      path: `${crateName}::${entryFunction.moduleName}::${entryFunction.functionName}`,
      args: [],
    };
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      pub: false,
      params: [],
      ...(entryFunction.fallible
        ? {
            returnType: {
              kind: "named" as const,
              path: "tsonic_rust_runtime::TsonicResult",
              typeArguments: [{ kind: "unit" as const }],
            },
            body: { statements: [{ kind: "tail" as const, expr: entryCall }] },
          }
        : { body: { statements: [{ kind: "expr" as const, expr: entryCall }] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", printRustSourceFile(createRustSourceFile([mainItem]))));
  }
  return { artifacts, diagnostics: [] };
}

function rustSourceArtifact(path: string, text: string): TargetSourceFile {
  return { kind: "source", path, language: "rust", text };
}

function planModuleNames(
  input: TargetCompileInput,
  diagnostics: TargetDiagnostic[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const sourceFile of input.sourceFiles) {
    const fileName = input.ast.getFileName(sourceFile);
    if (fileName.endsWith(".d.ts")) {
      continue;
    }
    const moduleName = rustModuleNameForFile(fileName);
    if (moduleName === undefined) {
      diagnostics.push(moduleNameDiagnostic(input, sourceFile, `Source file '${fileName}' does not map to a valid Rust module name.`));
      continue;
    }
    const existing = seen.get(moduleName);
    if (existing !== undefined) {
      diagnostics.push(moduleNameDiagnostic(input, sourceFile, `Source files '${existing}' and '${fileName}' both map to Rust module '${moduleName}'.`));
      continue;
    }
    seen.set(moduleName, fileName);
    names.set(fileName, moduleName);
  }
  return names;
}

// Module-path policy (distinct from identifier naming): generated Rust
// module names derive from source FILE names, which are filesystem paths,
// not user identifiers. File stems normalize to snake_case module names so
// module paths stay valid and predictable across platforms; user-authored
// identifiers inside modules are never recased.
export function rustModuleNameForFile(fileName: string): string | undefined {
  const base = fileName.split("/").pop() ?? "";
  const stem = base.replace(/\.(ts|mts|cts|tsx)$/u, "");
  if (stem.length === 0) {
    return undefined;
  }
  const sanitized = stem
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "_");
  if (!/^[a-z_][a-z0-9_]*$/u.test(sanitized)) {
    return undefined;
  }
  if (sanitized === "main" || sanitized === "lib" || rustReservedIdentifiers.has(sanitized)) {
    return undefined;
  }
  return sanitized;
}

function moduleNameDiagnostic(input: TargetCompileInput, sourceFile: SourceFile, message: string): TargetDiagnostic {
  return {
    code: "RUST_MODULE_NAME",
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: [
      "target.capability=rust.backend.module-name",
      `source.file=${input.ast.getFileName(sourceFile)}`,
    ],
  };
}

function planModuleItems(context: RustPlanContext): readonly RustItem[] {
  const { ast } = context.input;
  const items: RustItem[] = [];
  for (const statement of ast.statements(context.sourceFile)) {
    if (statement === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, context.sourceFile),
        "rust.backend.top-level-statement",
        "Source file contains an undefined top-level statement slot.",
      ));
      continue;
    }
    const kind = ast.kindName(statement);
    if (kind === KindImportDeclaration || kind === "KindEndOfFile") {
      continue;
    }
    if (kind === KindFunctionDeclaration) {
      const diagnosticCount = context.diagnostics.length;
      const item = planFunctionDeclaration(statement, context);
      if (item !== undefined) {
        items.push(item);
      } else {
        ensureTopLevelPlanningDiagnostic(context, statement, diagnosticCount, "function");
      }
      continue;
    }
    if (kind === KindVariableStatement) {
      const diagnosticCount = context.diagnostics.length;
      const item = planTopLevelConst(statement, context);
      if (item !== undefined) {
        items.push(item);
      } else {
        ensureTopLevelPlanningDiagnostic(context, statement, diagnosticCount, "const");
      }
      continue;
    }
    if (kind === "KindClassDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planClassDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(context, statement, diagnosticCount, "class");
      }
      continue;
    }
    if (kind === "KindInterfaceDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planInterfaceDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(context, statement, diagnosticCount, "interface");
      }
      continue;
    }
    if (kind === "KindTypeAliasDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planUnionAliasDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(context, statement, diagnosticCount, "type-alias");
      }
      continue;
    }
    if (kind === "KindEnumDeclaration") {
      const diagnosticCount = context.diagnostics.length;
      const planned = planEnumDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      } else {
        ensureTopLevelPlanningDiagnostic(context, statement, diagnosticCount, "enum");
      }
      continue;
    }
    context.diagnostics.push(unsupportedStatementDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.statement",
    ));
  }
  return items;
}

function ensureTopLevelPlanningDiagnostic(
  context: RustPlanContext,
  statement: Node,
  diagnosticCount: number,
  construct: string,
): void {
  if (context.diagnostics.length !== diagnosticCount) {
    return;
  }
  context.diagnostics.push(missingFactDiagnostic(
    { ast: context.input.ast, sourceFile: context.sourceFile, node: statement },
    `rust.backend.${construct}-finalization`,
    `Top-level ${construct} planning returned no Rust AST and no specific diagnostic.`,
  ));
}

function planTopLevelConst(statement: Node, context: RustPlanContext): RustItem | undefined {
  const { ast } = context.input;
  const declarations: Node[] = [];
  const visit = (candidate: Node): void => {
    if (ast.kindName(candidate) === "KindVariableDeclaration") {
      declarations.push(candidate);
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(statement);
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  const nameNode = declaration === undefined ? undefined : Node_Name(declaration);
  const name = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const initializer = declaration === undefined ? undefined : Node_Initializer(declaration);
  const typeNode = declaration === undefined ? undefined : Node_Type(declaration);
  const carrier = typeNode === undefined ? undefined : context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  const rustType = rustTypeFromCarrierInContext(carrier, context);
  if (
    declaration === undefined ||
    ast.variableDeclarationKind(statement) !== "const" ||
    initializer === undefined ||
    typeNode === undefined ||
    rustType === undefined ||
    rustType.kind === "string" ||
    !isValidRustIdentifier(name) ||
    !isConstLiteralInitializer(initializer, context) ||
    ast.kindName(initializer) === "KindStringLiteral"
  ) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.const",
      "Top-level declarations support only annotated const bindings with numeric or boolean literals.",
    ));
    return undefined;
  }
  const value = planExpression(initializer, context);
  if (value === undefined) {
    return undefined;
  }
  return {
    kind: "const",
    name,
    pub: ast.hasModifierKind(statement, "export"),
    // Authored const names are preserved verbatim; non-UPPER names carry a
    // scoped lint allowance.
    ...(isUpperSnakeName(name) ? {} : { attrs: ["#[allow(non_upper_case_globals)]"] }),
    type: rustType,
    value,
  };
}

interface RustBinaryEntry {
  readonly moduleName: string;
  readonly functionName: string;
  readonly fallible: boolean;
}

function resolveBinaryEntry(
  input: TargetCompileInput,
  moduleNameByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): RustBinaryEntry | undefined {
  const entryPoint = input.project.entryPoint;
  const entrySourceFile = input.sourceFiles.find((sourceFile) => {
    const fileName = input.ast.getFileName(sourceFile);
    return fileName === entryPoint || fileName.endsWith(`/${entryPoint}`);
  });
  const entryFileName = entrySourceFile === undefined ? undefined : input.ast.getFileName(entrySourceFile);
  const moduleName = entryFileName === undefined ? undefined : moduleNameByFileName.get(entryFileName);
  if (entrySourceFile === undefined || moduleName === undefined) {
    diagnostics.push({
      code: "RUST_MISSING_ENTRYPOINT",
      category: "error",
      source: "tsonic-rust",
      message: `Binary output requires entry point '${entryPoint}' to be part of the compiled sources.`,
      evidence: ["target.capability=rust.backend.entrypoint"],
    });
    return undefined;
  }
  for (const statement of input.ast.statements(entrySourceFile)) {
    if (statement === undefined || input.ast.kindName(statement) !== KindFunctionDeclaration) {
      continue;
    }
    const nameNode = Node_Name(statement);
    if (nameNode === undefined || input.ast.text(nameNode) !== "main") {
      continue;
    }
    const returnTypeNode = Node_Type(statement);
    const returnCarrier = returnTypeNode === undefined
      ? undefined
      : input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
    if (!input.ast.hasModifierKind(statement, "export") || !isRustUnitCarrier(returnCarrier) || input.ast.hasModifierKind(statement, "async")) {
      // Async entry points would require an implicit executor selection.
      break;
    }
    return {
      moduleName,
      functionName: "main",
      fallible: input.facts.getFact(statement, rustFallibleFactKey) !== undefined,
    };
  }
  diagnostics.push({
    code: "RUST_MISSING_ENTRYPOINT",
    category: "error",
    source: "tsonic-rust",
    message: "Binary output requires the entry module to export a 'main' function returning void.",
    evidence: ["target.capability=rust.backend.entrypoint"],
  });
  return undefined;
}
