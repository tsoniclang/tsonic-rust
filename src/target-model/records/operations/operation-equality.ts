import { type Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../types/equality.js";
import { type RustTargetOperationFact } from "./operations.js";
import { type RustProjectFieldSelection } from "../objects/project-fields.js";
import { type RustProjectAccessorSelection } from "../objects/project-accessors.js";
import { type RustPropertyProjectionFact } from "../objects/property-projections.js";
import { type RustSelectedTargetOperation } from "./member-selections.js";

type RustOperationComparisonInput = RustTargetOperationFact | RustProjectFieldSelection | RustProjectAccessorSelection;

export function rustPropertyProjectionFactEquals(left: RustPropertyProjectionFact, right: RustPropertyProjectionFact): boolean {
  return closedMetadataEquals(left.conversion, right.conversion) && left.cases.length === right.cases.length &&
    left.cases.every((selected, index) => {
      const other = right.cases[index];
      return other !== undefined && rustTargetTypeRefEquals(selected.source, other.source) &&
        closedMetadataEquals(selected.conversion, other.conversion) && selected.reads.length === other.reads.length &&
        selected.reads.every((read, offset) => other.reads[offset] !== undefined &&
          rustProjectMemberSelectionEquals(read, other.reads[offset]!));
    });
}

export function rustTargetOperationFactEquals(
  left: RustTargetOperationFact,
  right: RustTargetOperationFact,
): boolean {
  return operationMetadataEquals(left, right);
}

export function rustProjectMemberSelectionEquals(
  left: RustProjectFieldSelection | RustProjectAccessorSelection,
  right: RustProjectFieldSelection | RustProjectAccessorSelection,
): boolean {
  const optionalKeys = left.kind === "source-field" ? ["declaration", "dispatch"] : ["read", "write", "dispatch"];
  return optionalKeys.every(key => Object.prototype.hasOwnProperty.call(left, key) ===
    Object.prototype.hasOwnProperty.call(right, key)) &&
    operationMetadataEquals(left, right);
}

function operationMetadataEquals(left: RustOperationComparisonInput, right: RustOperationComparisonInput): boolean {
  if (left.kind !== right.kind) return false;
  const leftReferences: Node[] = [];
  const rightReferences: Node[] = [];
  const leftMetadata = projectOperationMetadata(left, leftReferences);
  const rightMetadata = projectOperationMetadata(right, rightReferences);
  return leftReferences.length === rightReferences.length &&
    leftReferences.every((node, index) => node === rightReferences[index]) &&
    closedMetadataEquals(leftMetadata, rightMetadata);
}

function projectOperationMetadata(fact: RustOperationComparisonInput, references: Node[]): unknown {
  const reference = (node: Node | undefined): number | undefined => {
    if (node === undefined) return undefined;
    references.push(node);
    return references.length - 1;
  };
  switch (fact.kind) {
    case "array-literal":
      return { ...fact, contributions: fact.contributions.map(contribution => contribution.kind === "value"
        ? contribution : { ...contribution, input: { ...contribution.input,
          expression: reference(contribution.input.expression),
          controlNodes: contribution.input.controlNodes.map(reference),
          inputs: contribution.input.inputs.map(input => ({ ...input, expression: reference(input.expression) })) } }) };
    case "native-propagation":
      return { ...fact, callableDeclaration: reference(fact.callableDeclaration), operandExpression: reference(fact.operandExpression) };
    case "native-range":
      return { ...fact, operands: fact.operands.map(reference) };
    case "template-string":
      return { ...fact, substitutions: fact.substitutions.map(part =>
        ({ ...part, expression: reference(part.expression) })) };
    case "switch":
      return { ...fact, clauses: fact.clauses.map(clause =>
        ({ ...clause, clause: reference(clause.clause), expression: reference(clause.expression) })) };
    case "object-shape-projection":
      return { ...fact, sourceValue: reference(fact.sourceValue),
        keyExpression: reference(fact.keyExpression), assignmentSource: reference(fact.assignmentSource) };
    case "source-field":
    case "source-method-property":
      return { ...fact, declaration: reference(fact.declaration) };
    case "source-static-field":
      return { ...fact, declaration: reference(fact.declaration), classReceiver: reference(fact.classReceiver) };
    case "source-accessor":
      return { ...fact,
        read: fact.read === undefined ? undefined : { ...fact.read, declaration: reference(fact.read.declaration) },
        write: fact.write === undefined ? undefined : { ...fact.write, declaration: reference(fact.write.declaration) } };
    case "source-union-field":
      return { ...fact, variants: fact.variants.map(variant => ({ ...variant,
        field: variant.field === undefined ? undefined :
          { ...variant.field, declaration: reference(variant.field.declaration) } })) };
    case "source-call": {
      const target = fact.target;
      if (target.form === "union-method") {
        return { ...fact, target: { ...target, variants: target.variants.map(variant =>
          ({ ...variant, declaration: reference(variant.declaration) })) } };
      }
      if (target.form === "function" || target.form === "static-method" || target.form === "constructor") {
        return { ...fact, target: { ...target, classReceiver: reference(target.classReceiver) } };
      }
      return fact;
    }
    case "provider-record-literal":
    case "closed-record-literal":
      return { ...fact, fields: fact.fields.map(field => ({ ...field,
        property: reference(field.property), expression: reference(field.expression) })) };
    case "record-literal":
      return { ...fact,
        fields: fact.fields.map(field => ({ ...field,
          implementationDeclaration: reference(field.implementationDeclaration),
          contractDeclarations: field.contractDeclarations.map(reference) })),
        contributions: fact.contributions.map(contribution => {
          switch (contribution.kind) {
            case "property":
            case "accessor":
              return { ...contribution, property: reference(contribution.property) };
            case "structural-method":
              return { ...contribution, property: reference(contribution.property),
                expression: reference(contribution.expression) };
            case "method":
              return { ...contribution, property: reference(contribution.property),
                expression: reference(contribution.expression),
                contractDeclarations: contribution.contractDeclarations.map(reference) };
            case "spread":
              return { ...contribution, property: reference(contribution.property),
                expression: reference(contribution.expression), methods: contribution.methods.map(method =>
                  ({ ...method, contractDeclaration: reference(method.contractDeclaration),
                    sourceDeclaration: reference(method.sourceDeclaration) })) };
          }
        }) };
    case "record-index-literal":
      return { ...fact, contributions: fact.contributions.map(contribution =>
        ({ ...contribution, property: reference(contribution.property), expression: reference(contribution.expression) })) };
    case "throw-op":
      return { ...fact, error: { ...fact.error, expression: reference(fact.error.expression) } };
    case "reference-operation":
      return fact.operation === "store"
        ? { ...fact, operandExpression: reference(fact.operandExpression), valueExpression: reference(fact.valueExpression) }
        : { ...fact, operandExpression: reference(fact.operandExpression) };
    case "native-pointer":
      return { ...fact, pointerExpression: reference(fact.pointerExpression),
        valueExpression: reference(fact.valueExpression), offsetExpression: reference(fact.offsetExpression) };
    default:
      return fact;
  }
}






export function rustSelectedTargetOperationEquals(
  left: RustSelectedTargetOperation,
  right: RustSelectedTargetOperation,
): boolean {
  return left.operationId === right.operationId &&
    left.operationKind === right.operationKind &&
    left.targetOperation === right.targetOperation &&
    rustTargetTypeRefEquals(left.resultType, right.resultType) &&
    closedMetadataEquals(left.providerDeclaration, right.providerDeclaration) &&
    operationProvenanceEquals(left.provenance, right.provenance);
}

function operationProvenanceEquals(
  left: RustSelectedTargetOperation["provenance"],
  right: RustSelectedTargetOperation["provenance"],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.sourceExpression === right.sourceExpression &&
    left.sourceReceiver === right.sourceReceiver &&
    left.sourceCallee === right.sourceCallee &&
    left.sourceSelectedSignature === right.sourceSelectedSignature &&
    left.sourceSelectedSymbol === right.sourceSelectedSymbol &&
    left.sourceSelectedDeclaration === right.sourceSelectedDeclaration &&
    left.sourceSelectedReadDeclaration === right.sourceSelectedReadDeclaration &&
    left.sourceSelectedWriteDeclaration === right.sourceSelectedWriteDeclaration &&
    left.sourceCalleeSymbol === right.sourceCalleeSymbol &&
    left.sourceCalleeDeclaration === right.sourceCalleeDeclaration &&
    left.sourceResultType === right.sourceResultType &&
    left.sourceReturnType === right.sourceReturnType &&
    closedMetadataEquals(left.providerDeclaration, right.providerDeclaration);
}
