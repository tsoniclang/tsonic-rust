import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustOutputType } from "../../target-model/project/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type {
  RustSourceModuleAnalysis,
  RustSourceModuleAnalysisIssue,
  RustSourceModuleConstruction,
  RustSourceModuleConstructionIndex,
} from "./model.js";

export function analyzeRustSourceModuleConstructions(input: {
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly outputType: RustOutputType;
}): RustSourceModuleAnalysis {
  const entries: RustSourceModuleConstruction[] = [];
  const issues: RustSourceModuleAnalysisIssue[] = [];
  for (const sourceFile of input.sourceFiles) {
    if (sourceFile.IsDeclarationFile) continue;
    visit(sourceFile, (node) => {
      if (input.source.ast.kindName(node) !== "KindNewExpression") return;
      const operation = input.facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind !== "provider-operation" ||
        operation.abi.target.form !== "source-module-construction") {
        return;
      }
      if (input.outputType !== "bin") {
        issues.push(issue(
          "RUST_SOURCE_MODULE_CONSTRUCTION_REQUIRES_BINARY",
          node,
          "A source-module construction requires binary output so the compiler can emit a closed module-entry dispatcher.",
        ));
        return;
      }
      const form = operation.abi.target;
      const moduleArgument = input.source.ast.arguments(node)[form.sourceArgumentIndex];
      if (moduleArgument === undefined ||
        (input.source.ast.kindName(moduleArgument) !== "KindStringLiteral" &&
          input.source.ast.kindName(moduleArgument) !== "KindNoSubstitutionTemplateLiteral")) {
        issues.push(issue(
          "RUST_SOURCE_MODULE_ARGUMENT_NOT_STATIC",
          node,
          "A source-module construction requires one exact authored string-literal module argument.",
        ));
        return;
      }
      const resolution = input.source.navigation.moduleSpecifierResolution(moduleArgument);
      if (resolution.kind !== "project") {
        issues.push(issue(
          resolution.kind === "unresolved"
            ? "RUST_SOURCE_MODULE_ARGUMENT_UNRESOLVED"
            : "RUST_SOURCE_MODULE_ARGUMENT_NOT_PROJECT_SOURCE",
          moduleArgument,
          resolution.kind === "unresolved"
            ? "The selected source-module argument does not resolve to an exact checked module."
            : "The selected source-module argument resolves outside the checked project source graph.",
        ));
        return;
      }
      entries.push(Object.freeze({
        expression: node,
        sourceFile,
        targetSourceFile: resolution.sourceFile,
        moduleArgument,
        sourceArgumentIndex: form.sourceArgumentIndex,
        targetArgumentIndex: form.targetArgumentIndex,
        bootstrap: Object.freeze({ ...form.bootstrap }),
      }));
    });
  }
  const bootstrapById = new Map<string, RustSourceModuleConstruction>();
  for (const entry of entries) {
    const existing = bootstrapById.get(entry.bootstrap.id);
    if (existing === undefined) {
      bootstrapById.set(entry.bootstrap.id, entry);
    } else if (!bootstrapEquals(existing.bootstrap, entry.bootstrap)) {
      issues.push(issue(
        "RUST_SOURCE_MODULE_BOOTSTRAP_CONFLICT",
        entry.expression,
        `Source-module constructions share provider bootstrap identity '${entry.bootstrap.id}' but carry contradictory target contracts.`,
      ));
    }
  }
  return Object.freeze({ index: createIndex(entries), issues: Object.freeze(issues) });

  function visit(node: Node, selected: (candidate: Node) => void): void {
    selected(node);
    input.source.ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child, selected);
    });
  }
}

function createIndex(
  values: readonly RustSourceModuleConstruction[],
): RustSourceModuleConstructionIndex {
  const entries = Object.freeze([...values]);
  const byExpression = new WeakMap<Node, RustSourceModuleConstruction>();
  const bySourceFile = new Map<SourceFile, RustSourceModuleConstruction[]>();
  const targets = new Set<SourceFile>();
  const bootstrapById = new Map<string, RustSourceModuleConstruction["bootstrap"]>();
  for (const entry of entries) {
    byExpression.set(entry.expression, entry);
    const sourceEntries = bySourceFile.get(entry.sourceFile) ?? [];
    sourceEntries.push(entry);
    bySourceFile.set(entry.sourceFile, sourceEntries);
    targets.add(entry.targetSourceFile);
    const existingBootstrap = bootstrapById.get(entry.bootstrap.id);
    if (existingBootstrap === undefined) {
      bootstrapById.set(entry.bootstrap.id, entry.bootstrap);
    }
  }
  const frozenBySourceFile = new Map(
    [...bySourceFile].map(([sourceFile, sourceEntries]) =>
      [sourceFile, Object.freeze(sourceEntries)] as const),
  );
  const targetEntries = Object.freeze([...targets]);
  return Object.freeze({
    construction: (node: Node) => byExpression.get(node),
    entries: () => entries,
    from: (sourceFile: SourceFile) => frozenBySourceFile.get(sourceFile) ?? emptyEntries,
    targets: () => targetEntries,
    bootstraps: () => Object.freeze([...bootstrapById.values()]),
  });
}

function bootstrapEquals(
  left: RustSourceModuleConstruction["bootstrap"],
  right: RustSourceModuleConstruction["bootstrap"],
): boolean {
  return left.id === right.id && left.path === right.path &&
    left.errorBoundary === right.errorBoundary &&
    ((left.errorCarrier === undefined && right.errorCarrier === undefined) ||
      (left.errorCarrier !== undefined && right.errorCarrier !== undefined &&
        rustTargetTypeRefEquals(left.errorCarrier, right.errorCarrier)));
}

const emptyEntries: readonly RustSourceModuleConstruction[] = Object.freeze([]);

function issue(
  code: string,
  node: Node,
  message: string,
): RustSourceModuleAnalysisIssue {
  return Object.freeze({ code, node, message });
}
