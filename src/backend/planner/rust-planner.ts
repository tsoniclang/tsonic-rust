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
import { createRustSourceFile, rustGeneratedHeaderComment } from "../rust-ast/nodes.js";
import type { RustItem } from "../rust-ast/nodes.js";
import { printRustSourceFile } from "../../print/rust-printer.js";
import { printCargoManifest } from "../../print/cargo-manifest-printer.js";
import { planCargoManifest } from "./cargo-project.js";
import { unsupportedConstructDiagnostic, unsupportedStatementDiagnostic } from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planFunctionDeclaration } from "./functions.js";
import { isUpperSnakeName, isValidRustIdentifier, rustReservedIdentifiers } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { isConstLiteralInitializer } from "./statements.js";
import { planClassDeclaration, planEnumDeclaration, planInterfaceDeclaration, planUnionAliasDeclaration } from "./declarations-nominal.js";

export function planRustArtifacts(input: TargetCompileInput): TargetCompileResult {
  const diagnostics: TargetDiagnostic[] = [];
  const moduleNameByFileName = planModuleNames(input, diagnostics);
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const moduleItems = new Map<string, readonly RustItem[]>();
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
    };
    moduleItems.set(moduleName, planModuleItems(context));
  }

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
    const rendered = printRustSourceFile(createRustSourceFile(items));
    const useItems: RustItem[] = [];
    if (rendered.includes("js_abi::")) {
      useItems.push({ kind: "use", path: "tsonic_rust_js::abi", alias: "js_abi" });
    }
    if (rendered.includes("js_string::")) {
      useItems.push({ kind: "use", path: "tsonic_rust_js::string", alias: "js_string" });
    }
    const finalText = useItems.length === 0
      ? rendered
      : printRustSourceFile(createRustSourceFile([...useItems, ...items]));
    artifacts.push(rustSourceArtifact(`src/${moduleName}.rs`, finalText));
  }
  if (outputType === "bin" && entryFunction !== undefined) {
    const crateName = readRustCrateName(input.target);
    const mainText = [
      `// ${rustGeneratedHeaderComment}`,
      "",
      "fn main() {",
      `    ${crateName}::${entryFunction.moduleName}::${entryFunction.functionName}();`,
      "}",
      "",
    ].join("\n");
    artifacts.push(rustSourceArtifact("src/main.rs", mainText));
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
      continue;
    }
    const kind = ast.kindName(statement);
    if (kind === KindImportDeclaration || kind === "KindEndOfFile") {
      continue;
    }
    if (kind === KindFunctionDeclaration) {
      const item = planFunctionDeclaration(statement, context);
      if (item !== undefined) {
        items.push(item);
      }
      continue;
    }
    if (kind === KindVariableStatement) {
      const item = planTopLevelConst(statement, context);
      if (item !== undefined) {
        items.push(item);
      }
      continue;
    }
    if (kind === "KindClassDeclaration") {
      const planned = planClassDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      }
      continue;
    }
    if (kind === "KindInterfaceDeclaration") {
      const planned = planInterfaceDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      }
      continue;
    }
    if (kind === "KindTypeAliasDeclaration") {
      const planned = planUnionAliasDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
      }
      continue;
    }
    if (kind === "KindEnumDeclaration") {
      const planned = planEnumDeclaration(statement, context);
      if (planned !== undefined) {
        items.push(...planned);
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
    initializer === undefined ||
    typeNode === undefined ||
    rustType === undefined ||
    rustType.kind === "string" ||
    !isUpperSnakeName(name) ||
    !isValidRustIdentifier(name) ||
    !isConstLiteralInitializer(initializer, context) ||
    ast.kindName(initializer) === "KindStringLiteral"
  ) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.const",
      "Top-level declarations support only UPPER_SNAKE annotated const bindings with numeric or boolean literals.",
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
    type: rustType,
    value,
  };
}

interface RustBinaryEntry {
  readonly moduleName: string;
  readonly functionName: string;
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
    return { moduleName, functionName: "main" };
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
