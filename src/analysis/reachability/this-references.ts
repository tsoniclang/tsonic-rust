import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { AstReader, Node } from "@tsonic/tsts";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustProjectRootThisCarrier(
  declaration: Node,
  ast: AstReader,
  projectTypes: RustProjectTypePolicy,
  references: ReadonlyMap<Node, ReadonlyMap<Node, readonly Node[]>>,
): TargetTypeRef | undefined {
  const kind = ast.kindName(declaration);
  if ((kind !== "KindMethodDeclaration" && kind !== "KindGetAccessor" && kind !== "KindSetAccessor") ||
    ast.hasModifierKind(declaration, "static")) return undefined;
  const owner = projectTypes.definitionContainingDeclaration(declaration);
  if (owner === undefined || !projectTypes.isPolymorphic(owner)) return undefined;
  const selected = references.get(declaration);
  if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A polymorphic source method requires sealed receiver-reference evidence.");
  const carrier = projectTypes.openCarrier(owner);
  return (selected.get(owner.declaration)?.length ?? 0) > 0
    ? carrier : undefined;
}

export function analyzeRustProjectThisReferences(
  method: Node,
  ast: AstReader,
  records: RustProgramRecords,
  projectTypes: RustProjectTypePolicy,
): ReadonlyMap<Node, readonly Node[]> {
  const references = new Map<Node, Node[]>();
  const pending = [method];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const kind = ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      const selected = records.runtimeCarrier.get(node)?.carrier;
      const owner = projectTypes.definitionForCarrier(selected);
      if (owner !== undefined) {
        const selectedReferences = references.get(owner.declaration) ?? [];
        selectedReferences.push(node);
        references.set(owner.declaration, selectedReferences);
      }
    } else {
      ast.forEachChild(node, child => {
        if (child !== undefined) pending.push(child);
      });
    }
  }
  return new Map([...references].map(([declaration, nodes]) => [declaration, Object.freeze(nodes)]));
}
