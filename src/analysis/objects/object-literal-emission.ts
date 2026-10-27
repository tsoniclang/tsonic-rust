import type { Node, ResolvedSourceObjectLiteralElementInfo, SourceFile } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { ObjectLiteralProperty_Value, type SourcePropertyNameSelection, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustObjectLiteralEmissionProducer } from "../program/records/objects/object-literal-emission.js";
import type { RustObjectLiteralEmission, RustObjectLiteralEmissionRequest, RustRecordLiteralFact, RustStructuralLiteralEmission } from "../../target-model/records/objects/object-literal-emission.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableProtocol, rustCallableTargetType, rustStructuralPropertyValueCarrier, rustUnitTargetType, rustEmptyObjectTargetId, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { selectRustObjectLiteralDispatch } from "../../policy/types/objects/object-literal-emission.js";
import { analyzeRustProjectLiteralEmission } from "./project-literal-emission.js";
import { rustJsValueTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustObjectLiteralEmission(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[],
  producer: RustObjectLiteralEmissionProducer, propertyName: (node: Node) => SourcePropertyNameSelection | undefined,
  objectLiteralElement: (node: Node) => ResolvedSourceObjectLiteralElementInfo | undefined, source: TargetSourceProgram): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string, unsupported = false): void => {
    issues.push({ code: unsupported ? "RUST_UNSUPPORTED_AST" : "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const { ast } = program.source;
    if (!ast.is.IsObjectLiteralExpression(node)) continue;
    const fact = program.records.targetOperation.get(node);
    const properties = ast.properties(node);
    if (fact?.kind === "empty-object-literal" && (fact.resultCarrier.kind !== "target-named" || fact.resultCarrier.id !== rustEmptyObjectTargetId || properties.length !== 0))
      refuse(node, "rust.backend.empty-object", "Empty object construction requires exact finalized empty syntax and identity storage.");
    if (fact?.kind === "provider-record-literal") {
      if (properties.length !== fact.fields.length || fact.fields.some((field, index) => field.property !== properties[index]) ||
        new Set([...fact.fields, ...fact.absentFields].map(field => field.targetName)).size !== fact.fields.length + fact.absentFields.length ||
        fact.completion === "default" && fact.absentFields.length !== 0)
        refuse(node, "rust.backend.provider-record-literal", "Provider object-literal syntax conflicts with its finalized native struct construction fact.");
      if (fact.fields.some(field => !rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.records, field.expression), field.storageCarrier)))
        refuse(node, "rust.backend.provider-record-field", "Provider object-literal field values conflict with their finalized storage carriers.");
    }
    if (fact?.kind === "record-index-literal" && (properties.length !== fact.contributions.length || fact.contributions.some((part, index) => part.property !== properties[index])))
      refuse(node, "rust.backend.record-index-literal-contract", "Index-backed object literal conflicts with its finalized interface, contribution order, or generated storage contract.");
    if (fact?.kind !== "record-literal") continue;
    if (properties.length !== fact.contributions.length || fact.contributions.some((part, index) => part.property !== properties[index]) ||
      new Set(fact.fields.map(field => field.sourceName)).size !== fact.fields.length || new Set(fact.fields.map(field => field.storageIndex)).size !== fact.fields.length)
      refuse(node, "rust.backend.record-fields", "Object literal syntax does not match its finalized ordered contribution fact.");
    if (fact.storage === "project-object") {
      const definition = program.projectTypes.definitionForCarrier(fact.resultCarrier);
      if (definition === undefined || program.objectRepresentations.representationFor(definition) === undefined)
        refuse(node, "rust.backend.record", "Object literal shape does not resolve to a generated Rust struct.", true);
    }
    for (const part of fact.contributions) {
      if (part.kind === "spread" || part.kind === "method") continue;
      const name = ast.name(part.property);
      const selected = name !== undefined && (ast.is.IsComputedPropertyName(name) || ast.is.IsNumericLiteral(name)) ? propertyName(name) : undefined;
      const sourceName = name === undefined ? undefined : ast.is.IsComputedPropertyName(name) || ast.is.IsNumericLiteral(name)
        ? selected?.kind === "resolved" ? selected.name : undefined : ast.text(name);
      if (sourceName !== part.sourceName) refuse(part.property, "rust.backend.record-fields", "Object literal syntax does not match its finalized ordered contribution fact.");
      if (part.kind !== "structural-method") continue;
      const field = fact.fields.find(field => field.storageIndex === part.targetStorageIndex);
      const physical = program.structuralShapes.field(fact.resultCarrier, part.targetStorageIndex);
      const raw = field?.presence === "optional" ? rustOptionElementCarrier(physical?.methodPlan?.carrier) : physical?.methodPlan?.carrier;
      if (physical?.methodPlan?.kind === "fixed") {
        const checked = objectLiteralElement(part.property);
        if (field?.method !== true || physical.method !== true || raw === undefined ||
          physical.sourceName !== part.sourceName || physical.methodPlan.declaration !== part.expression ||
          checked?.objectLiteral !== node || checked.element !== part.property || checked.elementKind !== "method" ||
          part.property !== part.expression)
          refuse(part.property, "rust.backend.record-fields", "Object literal syntax does not match its finalized ordered contribution fact.");
        continue;
      }
      const construction = physical?.methodPlan?.constructions?.find(selected => selected.object === node && selected.property === part.property &&
        selected.expression === part.expression && selected.storageIndex === part.targetStorageIndex);
      // A generic method is stored as its generic callable family value, which its sealed implementation constructs.
      const generic = raw !== undefined && rustGenericCallableValue(raw) !== undefined;
      if (field?.method !== true || raw === undefined || (generic
        ? program.callableValues.generic.definitionFor(raw) === undefined ||
          program.callableValues.generic.implementationFor(part.expression) === undefined
        : construction === undefined || !rustTargetTypeRefEquals(construction.destinationCarrier, raw)))
        refuse(part.property, "rust.backend.record-fields", "Object literal syntax does not match its finalized ordered contribution fact.");
    }
  }
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "closed-record-literal") continue;
    const { ast } = program.source;
    const properties = ast.properties(node);
    const valid = rustTargetTypeRefEquals(fact.resultCarrier, rustJsValueTargetType()) &&
      rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, fact.resultCarrier) && properties.length !== 0 &&
      properties.length === fact.fields.length && new Set(fact.fields.map(field => field.sourceName)).size === fact.fields.length &&
      fact.fields.every((field, index) => {
        const property = properties[index];
        const name = property === undefined ? undefined : ast.name(property);
        const selected = name !== undefined && (ast.is.IsComputedPropertyName(name) || ast.is.IsNumericLiteral(name)) ? propertyName(name) : undefined;
        const sourceName = name === undefined ? undefined : ast.is.IsComputedPropertyName(name) || ast.is.IsNumericLiteral(name)
          ? selected?.kind === "resolved" ? selected.name : undefined : ast.text(name);
        return property !== undefined && property === field.property && (ast.is.IsPropertyAssignment(property) || ast.is.IsShorthandPropertyAssignment(property)) &&
          sourceName === field.sourceName && ObjectLiteralProperty_Value(ast, property) === field.expression &&
          rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.records, field.expression), fact.resultCarrier);
      });
    if (valid) producer.closed(node, fact);
    else issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `Closed record construction requires exact ordered data-property and carrier facts. Node kind: ${ast.kindName(node)}.`,
      evidence: ["target.capability=rust.backend.closed-record"] });
  }
  if (issues.length !== 0) return Object.freeze(issues);
  const modules = new Map<SourceFile, RustObjectLiteralEmissionRequest[]>();
  const structural = (node: Node, carrier: TargetTypeRef, accessorFields: ReadonlySet<number>): RustStructuralLiteralEmission => {
    const shape = program.structuralShapes.templateForCarrier(carrier);
    if (shape === undefined || shape.construction !== undefined || shape.dispatchName === undefined &&
      !shape.fields.some(field => field.methodPlan?.kind === "fixed"))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal requires its exact selected native implementation template.", node);
    const fields = shape.fields.map((field, storageIndex) => {
      if (field.nativeLayout !== undefined || field.storage === "bound")
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal requires its selected native value or callable storage.", node);
      const protocol = field.method ? rustGenericCallableProtocol(field.carrier) ?? rustCallableProtocol(field.carrier) : undefined;
      const storage = field.methodPlan?.carrier;
      if (field.method && (protocol === undefined || storage === undefined))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal method requires its exact native callable storage.", node);
      const accessor = accessorFields.has(storageIndex);
      const value = accessor ? rustStructuralPropertyValueCarrier(field.carrier, field.presence) : undefined;
      if (!field.method && (shape.dispatchName !== undefined && field.property === undefined || accessor && (value === undefined || field.property?.selfMode !== "rc" ||
        field.property.setterTargetName !== undefined && field.presence !== "required")))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal property requires its exact native accessor ABI.", node);
      return Object.freeze({ field, copy: isRustCopyCarrier(field.carrier),
        frozen: program.frozenDataWrites.receiverFor("structural-object", carrier, storageIndex) !== undefined,
        method: protocol === undefined || storage === undefined ? undefined : field.methodPlan?.kind === "fixed"
          ? Object.freeze({ kind: "fixed", declaration: field.methodPlan.declaration, payload: field.methodPlan.payload,
              parameters: protocol.parameters, result: protocol.result, storage })
          : Object.freeze({ kind: "stored", parameters: protocol.parameters, result: protocol.result, storage }),
        accessor: !accessor || value === undefined ? undefined : Object.freeze({ getter: rustCallableTargetType([shape.carrier], value),
          setter: field.property?.setterTargetName === undefined ? undefined : rustCallableTargetType([shape.carrier, value], rustUnitTargetType()) }) });
    });
    return Object.freeze({ carrier, shape, fields: Object.freeze(fields) });
  };
  const append = (request: RustObjectLiteralEmissionRequest): void => {
    const file = program.source.ast.getSourceFile(request.node);
    if (file === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted literal requires its exact source module.", request.node);
    const requests = modules.get(file) ?? [];
    requests.push(request);
    modules.set(file, requests);
  };
  const native = new Set(nodes);
  const sourceFieldsFor = (node: Node, fact: RustRecordLiteralFact): RustObjectLiteralEmission["sourceFields"] => {
    const fields = new Map<number, Node | undefined>();
    for (const contribution of fact.contributions) {
      if (contribution.kind === "spread") {
        const sourceFact = program.records.targetOperation.get(contribution.expression);
        const source = sourceFact?.kind === "record-literal" ? literalFor(contribution.expression, sourceFact) : undefined;
        if (source !== undefined) for (const field of source.sourceFields) {
          const destination = contribution.fields.find(selected => selected.sourceStorageIndex === field.storageIndex);
          if (destination === undefined) continue;
          const original = sourceFact?.kind === "record-literal"
            ? sourceFact.fields.find(selected => selected.storageIndex === field.storageIndex) : undefined;
          fields.set(destination.targetStorageIndex, original?.presence === "required" ? field.value : undefined);
        }
        for (const field of contribution.fields) {
          if (source?.sourceFields.some(selected => selected.storageIndex === field.sourceStorageIndex)) continue;
          fields.set(field.targetStorageIndex, undefined);
        }
      } else if (contribution.kind === "method") {
        for (const field of fact.fields) if (field.contractDeclarations.some(declaration =>
          contribution.contractDeclarations.includes(declaration))) fields.set(field.storageIndex, undefined);
      } else {
        const checked = objectLiteralElement(contribution.property);
        if (checked?.objectLiteral !== node || checked.element !== contribution.property)
          failTargetAnalysisInvariant("tsonic-rust", "An admitted object field requires its exact checked source occurrence.", contribution.property);
        const value = contribution.kind === "property" && (checked.elementKind === "property" || checked.elementKind === "shorthand")
          ? ObjectLiteralProperty_Value(program.source.ast, contribution.property) : undefined;
        if (contribution.kind === "property" && value === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "An admitted data field requires its exact checked source value.", contribution.property);
        fields.set(contribution.targetStorageIndex, value);
      }
    }
    for (const field of fact.fields) if (!fields.has(field.storageIndex)) fields.set(field.storageIndex, undefined);
    return Object.freeze([...fields].map(([storageIndex, value]) => Object.freeze({ storageIndex, value })));
  };
  const literalFor = (node: Node, fact: RustRecordLiteralFact): RustObjectLiteralEmission | undefined => {
    const existing = producer.records.objectLiteralEmission.get(node);
    if (existing !== undefined) return existing;
    if (!native.has(node)) return undefined;
    const sourceFields = sourceFieldsFor(node, fact);
    const project = program.projectTypes.definitionForCarrier(fact.resultCarrier);
    const shape = program.structuralShapes.definitionForCarrier(fact.resultCarrier);
    const form = selectRustObjectLiteralDispatch({ fact, structuralImplementation: shape?.dispatchName !== undefined ||
      shape?.fields.some(field => field.methodPlan?.kind === "fixed") === true,
      polymorphicProject: project !== undefined && program.projectTypes.isPolymorphic(project) });
    const implementation: RustObjectLiteralEmission["implementation"] = form === undefined ? undefined : form === "project"
      ? Object.freeze({ kind: "project", selection: analyzeRustProjectLiteralEmission(program, node, fact, source) })
      : Object.freeze({ kind: "structural", selection: structural(node, fact.resultCarrier, new Set(fact.contributions.flatMap(contribution =>
        contribution.kind === "accessor" && contribution.role === "get" ? [contribution.targetStorageIndex] : []))) });
    const selected: RustObjectLiteralEmission = Object.freeze({ node, carrier: fact.resultCarrier, sourceFields, implementation });
    producer.literal(node, selected);
    return selected;
  };
  const visit = (node: Node): void => {
    const fact = program.records.targetOperation.get(node);
    if (native.has(node) && fact?.kind === "record-literal") {
      const selected = literalFor(node, fact);
      if (selected?.implementation !== undefined) append(Object.freeze({ node, ...selected.implementation }));
    }
    const reference = program.records.objectReferenceEmission.get(node);
    if (native.has(node) && reference?.kind === "structural" && reference.dispatch)
      append(Object.freeze({ kind: "reference", node, selection: structural(node, reference.view.targetCarrier,
        new Set(reference.view.fields.map(field => field.destinationIndex))) }));
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  for (const [file, requests] of modules) producer.module(file, Object.freeze(requests));
  return Object.freeze(issues);
}
