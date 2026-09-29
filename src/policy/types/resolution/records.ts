import type { Node, Type } from "@tsonic/tsts";
import { sourceTransformedTypeFactEvidenceNodes } from "@tsonic/target-api/source";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustIntegerCarrier, isRustStringCarrier } from "../../../target-model/types/index.js";
import { rustRecordTargetType } from "../../../target-model/types/carriers/records.js";
import { resolveRustEvidenceNodesToCommonCarrier, resolveRustTypeComponentEvidence } from "./source-evidence.js";

export function resolveRustIndexedRecordType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  authoredRoot?: Node,
): TargetTypeRef | undefined {
  const semantics = context.currentSemantics;
  const indexes = semantics.types.indexInfos(type);
  if (indexes.length !== 1 || semantics.types.propertyInfos(type).length !== 0 ||
    semantics.types.callSignatures(type).length !== 0 || semantics.types.constructSignatures(type).length !== 0) return undefined;
  const index = indexes[0]!;
  if (index.keyType === undefined || index.valueType === undefined) return undefined;
  const key = resolveRustTypeComponentEvidence({ selectedType: index.keyType }, context, options, resolving);
  if (key === undefined || !isRustStringCarrier(key) && !isRustIntegerCarrier(key)) return undefined;
  const nodes = authoredRoot === undefined ? [] : sourceTransformedTypeFactEvidenceNodes(
    context.ast, semantics, authoredRoot, index.valueType,
  );
  const value = nodes.length === 0
    ? resolveRustTypeComponentEvidence({ selectedType: index.valueType,
        ...(index.declaration === undefined ? {} : { authoredTypeNode: context.ast.typeNode(index.declaration) }) },
      context, options, resolving)
    : resolveRustEvidenceNodesToCommonCarrier(nodes, index.valueType, context, options, resolving);
  return value === undefined ? undefined : rustRecordTargetType(key, value);
}
