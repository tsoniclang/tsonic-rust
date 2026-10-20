import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function admitRustUnionProjections(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[]): void {
  for (const node of nodes) {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "source-union-field" && fact?.kind !== "union-property") continue;
    const variants = program.typeDefinitions.sourceUnionVariants(fact.unionCarrier);
    const selected = new Set(fact.selectedVariantIndexes);
    if (variants === undefined || variants.length !== fact.variants.length || selected.size === 0 ||
      selected.size !== fact.selectedVariantIndexes.length || [...selected].some(index => !Number.isInteger(index) || index < 0 || index >= fact.variants.length))
      failTargetAnalysisInvariant("tsonic-rust", "Native union projection has no exact emitted shape and selected-variant set.", node);
    for (const [index, variant] of fact.variants.entries()) {
      const declaration = variants[index];
      const selection = fact.kind === "union-property" ? fact.variants[index]!.operation : fact.variants[index]!.field;
      if (declaration === undefined || declaration.name !== variant.name || !rustTargetTypeRefEquals(declaration.carrier, variant.carrier) ||
        selected.has(index) !== (selection !== undefined))
        failTargetAnalysisInvariant("tsonic-rust", "Native union projection conflicts with its finalized variant contract.", node);
      if (fact.kind === "source-union-field") {
        const field = fact.variants[index]!.field;
        if (field?.dispatch !== undefined) {
          const definition = field.declaration === undefined ? undefined : program.projectTypes.definitionContainingDeclaration(field.declaration);
          const relationship = definition === undefined ? undefined : program.projectTypes.relationship(variant.carrier, definition);
          const dispatch = field.declaration === undefined ? undefined : program.records.projectFieldDispatch.get(field.declaration);
          if (relationship?.kind !== "related" || !rustTargetTypeRefEquals(relationship.targetType, field.dispatch.ownerCarrier) || dispatch === undefined)
            failTargetAnalysisInvariant("tsonic-rust", "A native union field requires its exact admitted project dispatch relationship.", node);
        }
        continue;
      }
      const operation = fact.variants[index]!.operation;
      if (operation !== undefined && (operation.abi.operationKind !== "property" || operation.abi.sourceArguments.length !== 0 ||
        operation.abi.sourceReceiver.kind !== "receiver" || !rustTargetTypeRefEquals(operation.abi.sourceReceiver.carrier, variant.carrier) ||
        !rustTargetTypeRefEquals(operation.resultCarrier, fact.resultCarrier)))
        failTargetAnalysisInvariant("tsonic-rust", "Native union property arm conflicts with its exact receiver or result ABI.", node);
    }
  }
}
