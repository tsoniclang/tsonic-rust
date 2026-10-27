import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustIndexedRecordProducer } from "../program/records/objects/indexed-records.js";
import type { RustIndexedRecordStorage } from "../../target-model/records/objects/indexed-records.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { selectRustIndexedRecordStorage } from "../../policy/types/objects/indexed-records.js";
import type { SourceFile } from "@tsonic/tsts";
import { Node_Type, ObjectLiteralProperty_Value, SpreadAssignment_Expression } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import { rustRecordCarrierValue } from "../../target-model/types/carriers/records.js";
import { isRustIntegerCarrier } from "../../target-model/types/index.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { resolveTypeNodeCarrier } from "../source-evidence/types/source-carriers.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { parseSourceIntegerLiteral } from "../../source/extension/literals.js";

export function analyzeRustIndexedRecords(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustIndexedRecordProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const selectedStorage = new Set<string>();
  const reject = (node: Node, message: string): void => { issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
    message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: ["target.capability=rust.backend.project-index-key"] }); };
  const storage = (node: Node, carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, contract: RustIndexedRecordStorage): void => {
    const identity = closedMetadataKey([carrier, key, value, contract]);
    if (selectedStorage.has(identity)) return;
    selectedStorage.add(identity);
    const definition = program.projectTypes.definitionForCarrier(carrier);
    const selected = selectRustIndexedRecordStorage({ carrier, key, value, storage: contract, definition,
      representation: program.objectRepresentations.representationFor(definition), polymorphic: definition !== undefined && program.projectTypes.isPolymorphic(definition) });
    if (selected.kind === "rejected") reject(node, selected.reason);
    else producer.storage(carrier, key, value, contract, selected.value);
  };
  for (const node of new Set(nodes)) {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "record-index-literal") {
      storage(node, operation.resultCarrier, operation.keyCarrier, operation.valueCarrier, operation.storage);
      for (const contribution of operation.contributions) {
        if (contribution.kind === "spread") storage(contribution.property, contribution.sourceCarrier, operation.keyCarrier, operation.valueCarrier, contribution.sourceStorage);
        else {
          const integer = isRustIntegerCarrier(operation.keyCarrier) ? parseSourceIntegerLiteral(contribution.sourceName) : undefined;
          if (!isRustStringCarrier(operation.keyCarrier) && integer === undefined) reject(contribution.property, "An indexed literal key requires its exact checked native string or integer value.");
          else producer.literalKey(contribution.property, { kind: integer === undefined ? "string" : "integer", value: integer?.toString(10) ?? contribution.sourceName });
        }
      }
      continue;
    }
    if (operation?.kind !== "source-index-signature") continue;
    storage(node, operation.receiverCarrier, operation.keyCarrier, operation.resultCarrier, operation.storage);
    const selected = program.records.selectedOperation.get(node);
    const optional = program.records.optionalChain.get(node);
    const result = optional?.resultCarrier ?? operation.resultCarrier;
    if (selected?.operationId !== operation.operationId || selected.operationKind !== "indexer" ||
      !rustTargetTypeRefEquals(selected.resultType, result) || !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, result) ||
      optional !== undefined && !rustTargetTypeRefEquals(optional.innerResultCarrier, operation.resultCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted indexed record access requires its exact checked operation and native result evidence.", node);
    const receiver = Node_Expression(program.source.ast, node);
    if (receiver === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted indexed record access requires its checked receiver.", node);
    if (program.source.ast.is.IsPropertyAccessExpression(node)) {
      const name = program.source.ast.name(node);
      if (name === undefined || !program.source.ast.is.IsIdentifier(name) || !isRustStringCarrier(operation.keyCarrier)) {
        reject(node, "A native source-name index access requires its exact checked string key."); continue;
      }
      producer.access(node, { receiver, key: Object.freeze({ kind: "literal", value: program.source.ast.text(name) }) });
    } else {
      const expression = ElementAccessExpression_ArgumentExpression(program.source.ast, node);
      if (expression === undefined || !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(expression)?.carrier, operation.keyCarrier)) {
        reject(node, "A native index access requires its exact checked key expression and carrier."); continue;
      }
      producer.access(node, { receiver, key: Object.freeze({ kind: "expression", expression }) });
    }
  }
  return Object.freeze(issues);
}

interface IndexedRecordContract {
  readonly key: TargetTypeRef;
  readonly value: TargetTypeRef;
  readonly storage: RustIndexedRecordStorage;
}

export function resolveRustIndexedRecordContract(walk: RustFactWalk, carrier: TargetTypeRef): IndexedRecordContract | undefined {
  const record = rustRecordCarrierValue(carrier);
  if (record !== undefined) return { ...record, storage: { kind: "record" } };
  const definition = walk.context.projectTypes.definitionForCarrier(carrier);
  const layout = definition?.kind === "interface" ? walk.context.projectTypes.objectLayoutForDefinition(definition) : undefined;
  if (definition === undefined || layout?.indexSignatures.length !== 1 || layout.fields.length !== 0 ||
    walk.context.projectTypes.isPolymorphic(definition)) return undefined;
  const index = layout.indexSignatures[0]!;
  const resolve = (declaration: Node): TargetTypeRef | undefined => {
    const declared = walk.context.records.runtimeCarrier.get(declaration)?.carrier ??
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
    if (name === undefined) return undefined;
    const selected = walk.context.ast.is.IsComputedPropertyName(name) || walk.context.ast.is.IsNumericLiteral(name)
      ? walk.context.semanticsFor(property).propertyNames.get(name) : undefined;
    const sourceName = walk.context.ast.is.IsComputedPropertyName(name) || walk.context.ast.is.IsNumericLiteral(name)
      ? selected?.kind === "resolved" ? selected.name : undefined : walk.context.ast.text(name);
    if (sourceName === undefined) return undefined;
    const initializer = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (initializer === undefined || resolveExpressionCarrier(walk, initializer, sourceFile, value) === undefined) return undefined;
    contributions.push({ kind: "property", property, sourceName, expression: initializer });
  }
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "record-index-literal", "analysis/objects/indexed-records.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "record-index-literal", operationId: "tsonic.rust.record.index-literal",
    resultCarrier, keyCarrier: key, valueCarrier: value, storage, contributions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}
