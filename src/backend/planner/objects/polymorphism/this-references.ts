import type { AstReader, Node } from "@tsonic/tsts";
import type { RustProjectTypePolicy } from "../../../../analysis/project-types/type-policy.js";
import type { RustProgramRecords } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function rustProjectRootThisCarrier(
  declaration: Node,
  ast: AstReader,
  records: RustProgramRecords,
  projectTypes: RustProjectTypePolicy,
): TargetTypeRef | undefined {
  const kind = ast.kindName(declaration);
  if ((kind !== "KindMethodDeclaration" && kind !== "KindGetAccessor" && kind !== "KindSetAccessor") ||
    ast.hasModifierKind(declaration, "static")) return undefined;
  const owner = projectTypes.definitionContainingDeclaration(declaration);
  if (owner === undefined || !projectTypes.isPolymorphic(owner)) return undefined;
  const carrier = projectTypes.openCarrier(owner);
  return rustProjectThisReferences(declaration, carrier, ast, records, projectTypes).length > 0
    ? carrier : undefined;
}

export function rustProjectThisReferences(
  method: Node,
  ownerCarrier: TargetTypeRef,
  ast: AstReader,
  records: RustProgramRecords,
  projectTypes: RustProjectTypePolicy,
): readonly Node[] {
  const owner = projectTypes.definitionForCarrier(ownerCarrier);
  if (owner === undefined) return [];
  const references: Node[] = [];
  const pending = [method];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const kind = ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      const selected = records.runtimeCarrier.get(node)?.carrier;
      if (projectTypes.definitionForCarrier(selected) === owner) references.push(node);
    } else {
      ast.forEachChild(node, child => {
        if (child !== undefined) pending.push(child);
      });
    }
  }
  return references;
}
