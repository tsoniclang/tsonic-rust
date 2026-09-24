import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import type { RustTargetOperationFact } from "./facts.js";

export function rustTargetOperationFactEquals(
  left: RustTargetOperationFact,
  right: RustTargetOperationFact,
): boolean {
  if (left.kind !== right.kind) return false;
  const leftReferences: Node[] = [];
  const rightReferences: Node[] = [];
  const leftMetadata = projectOperationMetadata(left, leftReferences);
  const rightMetadata = projectOperationMetadata(right, rightReferences);
  return leftReferences.length === rightReferences.length &&
    leftReferences.every((node, index) => node === rightReferences[index]) &&
    closedMetadataEquals(leftMetadata, rightMetadata);
}

function projectOperationMetadata(fact: RustTargetOperationFact, references: Node[]): unknown {
  const reference = (node: Node | undefined): number | undefined => {
    if (node === undefined) return undefined;
    references.push(node);
    return references.length - 1;
  };
  switch (fact.kind) {
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
      return fact.error.kind === "runtime"
        ? { ...fact, error: { ...fact.error, expression: reference(fact.error.expression) } }
        : fact;
    case "reference-operation":
      return fact.operation === "store"
        ? { ...fact, operandExpression: reference(fact.operandExpression), valueExpression: reference(fact.valueExpression),
            writeStrategy: fact.writeStrategy === undefined ? undefined : { ...fact.writeStrategy,
              readExpression: reference(fact.writeStrategy.readExpression),
              rightExpression: reference(fact.writeStrategy.rightExpression) } }
        : { ...fact, operandExpression: reference(fact.operandExpression) };
    case "native-pointer":
      return { ...fact, pointerExpression: reference(fact.pointerExpression),
        valueExpression: reference(fact.valueExpression), offsetExpression: reference(fact.offsetExpression) };
    default:
      return fact;
  }
}
