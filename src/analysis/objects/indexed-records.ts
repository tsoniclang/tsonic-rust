import type { Node, SourceFile } from "@tsonic/tsts";
import { Node_Type, ObjectLiteralProperty_Value, SpreadAssignment_Expression } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import { rustRecordCarrierValue, type RustIndexedRecordStorage } from "../../target-model/types/carriers/records.js";
import { isRustIntegerCarrier, isRustStringCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import { resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";

interface IndexedRecordContract {
  readonly key: TargetTypeRef;
  readonly value: TargetTypeRef;
  readonly storage: RustIndexedRecordStorage;
}

export function resolveRustIndexedRecordContract(walk: RustFactWalk, carrier: TargetTypeRef): IndexedRecordContract | undefined {
  const record = rustRecordCarrierValue(carrier);
  if (record !== undefined) return { ...record, storage: { kind: "record" } };
  const definition = walk.context.projectTypes.definitionForCarrier(carrier);
  const layout = definition?.kind === "interface" ? rustProjectObjectLayout(definition.declaration, walk.context.ast) : undefined;
  if (definition === undefined || layout?.indexSignatures.length !== 1 || layout.fields.length !== 0 ||
    walk.context.projectTypes.isPolymorphic(definition)) return undefined;
  const index = layout.indexSignatures[0]!;
  const resolve = (declaration: Node): TargetTypeRef | undefined => {
    const declared = walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
    return declared === undefined ? undefined : walk.context.projectTypes.instantiateMemberCarrier(declaration, carrier, declared);
  };
  const key = resolve(index.keyParameter);
  const value = resolve(index.declaration);
  const name = walk.context.projectTypes.fieldStorageName(definition, index.declaration);
  return key === undefined || value === undefined || name === undefined ? undefined : {
    key, value, storage: { kind: "project-field", name },
  };
}

export function resolveRustIndexedRecordLiteral(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  resultCarrier: TargetTypeRef,
  properties: readonly Node[],
  contract: IndexedRecordContract,
): TargetTypeRef | undefined {
  const { key, value, storage } = contract;
  if (!isRustStringCarrier(key) && !isRustIntegerCarrier(key)) return undefined;
  const contributions: Extract<RustTargetOperationFact, { readonly kind: "record-index-literal" }>["contributions"][number][] = [];
  for (const property of properties) {
    const kind = walk.context.ast.kindName(property);
    if (kind === "KindSpreadAssignment") {
      const spread = SpreadAssignment_Expression(walk.context.ast, property);
      const sourceCarrier = spread === undefined ? undefined : resolveExpressionCarrier(walk, spread, sourceFile, undefined);
      const source = sourceCarrier === undefined ? undefined : resolveRustIndexedRecordContract(walk, sourceCarrier);
      if (spread === undefined || sourceCarrier === undefined || source === undefined ||
        !rustTargetTypeRefEquals(source.key, key) || !rustTargetTypeRefEquals(source.value, value)) return undefined;
      contributions.push({ kind: "spread", property, expression: spread, sourceCarrier, sourceStorage: source.storage });
      continue;
    }
    if (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment") return undefined;
    const name = walk.context.ast.name(property);
    if (name === undefined || walk.context.ast.is.IsComputedPropertyName(name)) return undefined;
    const sourceName = walk.context.ast.text(name);
    const initializer = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (initializer === undefined || resolveExpressionCarrier(walk, initializer, sourceFile, value) === undefined) return undefined;
    contributions.push({ kind: "property", property, sourceName, expression: initializer });
  }
  setRustOperationFact(walk, expression, {
    kind: "record-index-literal", operationId: "tsonic.rust.record.index-literal",
    resultCarrier, keyCarrier: key, valueCarrier: value, storage, contributions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}
