import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, Node_Type } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableProtocol, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveRustTypeComponentEvidence } from "../source-evidence/types/resolution/source-evidence.js";

import { rustProjectStaticFieldStorage } from "../project-types/object-layout.js";
import { finalizeRustClassValueCallable, selectRustClassValueCallable, selectRustClassValueCallablePlan } from "./class-value-callables.js";

import { selectRustProjectStructuralView } from "./project-structural-views.js";

import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";

import { selectRustCallableValueAdapter } from "../../policy/conversions/callable-adapters.js";
import type { RustClassValueFact } from "../../target-model/records/class-values.js";

import type { RustClassValueView } from "../../target-model/records/class-values.js";
export function selectRustClassValue(
  walk: RustFactWalk,
  expression: Node,
  expected: TargetTypeRef | undefined,
): { readonly kind: "qualifier"; readonly carrier: TargetTypeRef } |
  { readonly kind: "constructor"; readonly value: RustClassValueFact } | undefined {
  const { ast } = walk.context;
  const declaration = ast.kindName(expression) === "KindClassExpression" ? expression
    : walk.context.source.navigation.sourceReferenceFor(expression)?.declaration;
  if (declaration === undefined || ast.kindName(declaration) !== "KindClassDeclaration" &&
    ast.kindName(declaration) !== "KindClassExpression") return undefined;
  const semantics = walk.context.semanticsFor(expression);
  const sourceType = semantics.types.expressionType(expression);
  const contextual = semantics.types.contextualValueSelection(expression);
  const carrier = expected ?? (contextual.kind !== "selected" ? undefined : resolveRustTypeComponentEvidence(
    contextual.component, rustResolutionContext(walk, expression), walk.operationOptions, new Set<object>()));
  const shape = carrier === undefined ? undefined : walk.sourceTypes.structuralObjectForCarrier(carrier);
  if (sourceType === undefined) return undefined;
  const native = resolveRustTargetTypeRef(sourceType, rustResolutionContext(walk, expression), walk.operationOptions);
  const instance = rustClassConstructorInstance(native);
  if (native === undefined || instance === undefined || walk.context.projectTypes.definitionForCarrier(instance)?.declaration !== declaration) return undefined;
  if (shape === undefined) {
    if (!ast.is.IsClassExpression(expression) && isClassDeclarationQualifier(expression, ast)) {
      return { kind: "qualifier", carrier: native };
    }
    walk.context.classValues.recordConstructorValue(declaration, "value");
    return { kind: "constructor", value: { declaration, sourceCarrier: instance, carrier: native } };
  }
  if (carrier === undefined || !selectRustClassValueView(walk, expression, declaration, carrier)) return undefined;
  return { kind: "constructor", value: { declaration, sourceCarrier: instance, carrier } };
}

function isClassDeclarationQualifier(expression: Node, ast: AstReader): boolean {
  let current = expression;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined || Node_Expression(ast, parent) !== current) return false;
    if (ast.is.IsParenthesizedExpression(parent)) {
      current = parent;
      continue;
    }
    return ast.is.IsNewExpression(parent) || ast.is.IsPropertyAccessExpression(parent) || ast.is.IsElementAccessExpression(parent);
  }
}

export function selectRustClassValueView(
  walk: RustFactWalk, expression: Node, declaration: Node, carrier: TargetTypeRef,
): boolean {
  const { ast } = walk.context;
  const semantics = walk.context.semanticsFor(expression);
  const sourceType = semantics.types.expressionType(expression);
  const sourceCarrier = sourceType === undefined ? undefined : rustClassConstructorInstance(resolveRustTargetTypeRef(
    sourceType, rustResolutionContext(walk, expression), walk.operationOptions));
  const shape = walk.sourceTypes.structuralObjectForCarrier(carrier);
  const destinationType = shape?.sourceType;
  if (shape === undefined || sourceType === undefined || sourceCarrier === undefined || destinationType === undefined) return false;
  const reject = (): undefined => {
    appendRustDiagnostic(walk, "RUST_CLASS_VALUE_NOT_CLOSED",
      "Class constructor values require exact construct/static-member correspondence and closed structural storage.",
      expression, ["target.capability=rust.class-value.static-storage"]);
    return undefined;
  };
  const owner = rustStructuralObjectCarrierValue(carrier)?.ownerFileName;
  const component = (file: string) => walk.context.sourcePackages.packages.find(entry => entry.sourceFiles.includes(file))?.componentId;
  const declarationFile = ast.getSourceFile(declaration);
  if (shape.storage !== "structural-object" || owner === undefined ||
    component(owner) === undefined || component(ast.getFileName(declarationFile)) === undefined) { reject(); return false; }
  const correspondence = semantics.types.structuralMembers(sourceType, destinationType, "read");
  if (correspondence.kind !== "available" || correspondence.destination.calls.length !== 0 ||
    correspondence.destination.constructs.length !== (shape.construction === undefined ? 0 : 1) || correspondence.destination.indexes.length !== 0 ||
    correspondence.members.length !== shape.fields.length) { reject(); return false; }
  const sourceConstructs = semantics.types.signatureInfos(sourceType, "construct");
  const targetConstructs = semantics.types.signatureInfos(destinationType, "construct");
  const constructionPlan = shape.construction === undefined || correspondence.source.constructs.length !== 1 ||
    sourceConstructs.length !== 1 || targetConstructs.length !== 1 ||
    sourceConstructs[0]!.signature !== correspondence.source.constructs[0] ||
    targetConstructs[0]!.signature !== correspondence.destination.constructs[0]
    ? undefined : selectRustClassValueCallablePlan(walk, declaration, sourceConstructs[0]!,
      targetConstructs[0]!, shape.construction.carrier, true, semantics, false, sourceCarrier);
  const constructionResult = shape.construction === undefined ? undefined : rustCallableProtocol(shape.construction.carrier)?.result;
  const constructionAdapter = constructionPlan === undefined || constructionResult === undefined ? undefined
    : selectRustCallableValueAdapter(constructionPlan.resultCarrier, constructionResult, walk.context.projectTypes, walk.context.typeDefinitions) ??
      (sourceConstructs[0]?.returnType !== undefined && selectRustProjectStructuralView(walk, declaration,
        constructionPlan.resultCarrier, constructionResult, semantics, sourceConstructs[0].returnType)
        ? { kind: "project-structural-view" as const, sourceCarrier: constructionPlan.resultCarrier, targetCarrier: constructionResult, fallible: false as const }
        : undefined);
  const construction = constructionPlan === undefined || constructionAdapter === undefined ? undefined
    : finalizeRustClassValueCallable(constructionPlan, constructionAdapter);
  if (shape.construction !== undefined && construction === undefined) { reject(); return false; }
  const fields: RustClassValueView["fields"][number][] = [];
  for (const field of shape.fields) {
    const pair = correspondence.members.find(pair => field.symbols.includes(pair.destination.property.symbol));
    if (pair?.kind !== "present" ||
      field.presence !== "required" || pair.source.declarations.length !== 1) { reject(); return false; }
    const sourceDeclaration = pair.source.declarations[0]!;
    if (ast.parent(sourceDeclaration) !== declaration) { reject(); return false; }
    if (field.method === true && pair.source.read === "method") {
      const sourceSignatures = semantics.types.signatureInfos(pair.source.property.type, "call");
      const targetSignatures = semantics.types.signatureInfos(pair.destination.property.type, "call");
      const callable = sourceSignatures.length === 1 && targetSignatures.length === 1
        ? selectRustClassValueCallable(walk, declaration, sourceSignatures[0]!, targetSignatures[0]!, field.resultCarrier, semantics, false, sourceCarrier) : undefined;
      if (callable === undefined) { reject(); return false; }
      if (!walk.sourceTypes.registerStructuralFieldImplementation({ carrier, storageIndex: field.storageIndex, kind: "dispatch" })) { reject(); return false; }
      fields.push({ declaration: sourceDeclaration, fileName: ast.getFileName(ast.getSourceFile(sourceDeclaration)),
        targetName: callable.targetName, storageIndex: field.storageIndex, writable: false, callable });
      continue;
    }
    if (field.method === true || pair.source.read !== "property") { reject(); return false; }
    const storage = rustProjectStaticFieldStorage(sourceDeclaration, ast,
      walk.context.projectTypes.memberSlotName(sourceDeclaration, "static"));
    const fieldType = Node_Type(ast, sourceDeclaration);
    const fieldCarrier = walk.context.records.runtimeCarrier.get(sourceDeclaration)?.carrier ?? resolveRustTargetTypeRef(
      fieldType ?? pair.source.property.type, rustResolutionContext(walk, sourceDeclaration), walk.operationOptions);
    if (storage === undefined || !rustTargetTypeRefEquals(fieldCarrier, field.resultCarrier)) { reject(); return false; }
    if (!walk.sourceTypes.registerStructuralFieldImplementation({ carrier, storageIndex: field.storageIndex, kind: "dispatch" })) { reject(); return false; }
    fields.push({ ...storage, storageIndex: field.storageIndex, writable: !field.readonly });
  }
  if (!walk.context.classValues.record({ declaration, sourceCarrier, targetCarrier: carrier, fields, ...(construction === undefined ? {} : { construction }) })) { reject(); return false; }
  return true;
}
