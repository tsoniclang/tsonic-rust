import { allocateRustGeneratedName as allocateGeneratedName } from "../../../target-model/names/generated.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustNamePlan } from "../../../target-model/names/model.js";
import type { RustProjectTypeDefinition } from "../../../policy/types/project-types.js";

export function projectDefinition(
  declaration: Node,
  sourceFile: SourceFile,
  ast: AstReader,
  namePlan: RustNamePlan,
  usedNames: Set<string>,
): RustProjectTypeDefinition | undefined {
  const kindName = ast.kindName(declaration);
  const kind = kindName === "KindClassDeclaration"
    ? "class" as const
    : kindName === "KindInterfaceDeclaration"
      ? "interface" as const
      : undefined;
  if (kind === undefined) {
    return undefined;
  }
  const nameNode = ast.name(declaration);
  const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
  const targetName = namePlan.nameForDeclaration(declaration);
  const fileName = ast.getFileName(sourceFile);
  const rawParameters = ast.typeParameters(declaration);
  const parameters = denseNodes(rawParameters);
  const sourceTypeParameterNames = parameters?.map((parameter) => {
    const name = ast.name(parameter);
    return name === undefined ? "" : ast.text(name);
  });
  const targetParameterNames = parameters?.map((parameter) =>
    namePlan.nameForDeclaration(parameter));
  return sourceName.length === 0 || targetName === undefined || fileName.length === 0 ||
      parameters === undefined || sourceTypeParameterNames === undefined ||
      sourceTypeParameterNames.some((name) => name.length === 0) ||
      targetParameterNames === undefined || targetParameterNames.some((name) => name === undefined)
    ? undefined
    : (() => {
        const stateName = allocateGeneratedName(
          usedNames,
          `${targetName}State`,
        );
        const dispatchName = allocateGeneratedName(
          usedNames,
          `${targetName}Dispatch`,
        );
        const rootName = kind === "class"
          ? allocateGeneratedName(usedNames, `${targetName}Root`)
          : undefined;
        return Object.freeze({
        declaration,
        sourceFile,
        fileName,
        sourceName,
        targetName,
        kind,
        typeParameterNames: Object.freeze(sourceTypeParameterNames),
        targetTypeParameterNames: Object.freeze(targetParameterNames as string[]),
        stateName,
        dispatchName,
        ...(rootName === undefined ? {} : { rootName }),
      });
      })();
}

export function sourceFileIdentifierNames(
  sourceFile: SourceFile,
  ast: AstReader,
  namePlan: RustNamePlan,
): Set<string> {
  const result = new Set<string>();
  const visit = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    const targetName = namePlan.nameForDeclaration(node);
    if (targetName !== undefined) {
      result.add(targetName);
    }
    ast.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

export function projectMemberNames(
  declaration: Node,
  ast: AstReader,
  namePlan: RustNamePlan,
): Set<string> {
  const result = new Set<string>();
  for (const member of denseNodes(ast.members(declaration)) ?? []) {
    const targetName = namePlan.nameForDeclaration(member);
    if (targetName !== undefined) {
      result.add(targetName);
    }
  }
  return result;
}

export function heritageKindIssue(
  source: RustProjectTypeDefinition,
  relation: "extends" | "implements",
  target: RustProjectTypeDefinition,
): string | undefined {
  if (source.kind === "interface") {
    return relation !== "extends" || target.kind !== "interface"
      ? `Project interface '${source.sourceName}' can extend only another project interface.`
      : undefined;
  }
  return relation === "extends"
    ? target.kind === "class"
      ? undefined
      : `Project class '${source.sourceName}' can extend only another project class.`
    : target.kind === "interface"
      ? undefined
      : `Project class '${source.sourceName}' can implement only a project interface.`;
}

export function definitionKey(fileName: string, sourceName: string): string {
  return `${fileName}::${sourceName}`;
}

export function compareProjectDefinitions(
  left: RustProjectTypeDefinition,
  right: RustProjectTypeDefinition,
): number {
  const fileOrder = left.fileName.localeCompare(right.fileName, "en");
  return fileOrder !== 0
    ? fileOrder
    : left.sourceName.localeCompare(right.sourceName, "en");
}

export function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}
