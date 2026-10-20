import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { ObjectLiteralProperty_Value, type SourcePropertyNameSelection } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "../program/model.js";
import type { RustObjectLiteralEmissionProducer } from "../program/records/object-literal-emission.js";
import type { RustObjectLiteralEmission, RustObjectLiteralEmissionRequest, RustStructuralLiteralEmission } from "../../target-model/records/object-literal-emission.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier, rustCallableProtocol, rustCallableTargetType, rustStructuralPropertyValueCarrier, rustUnitTargetType } from "../../target-model/types/index.js";
import { selectRustObjectLiteralDispatch } from "../../policy/objects/object-literal-emission.js";
import { analyzeRustProjectLiteralEmission } from "./project-literal-emission.js";
import { rustJsValueTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustObjectLiteralEmission(program: Omit<RustTargetProgram, "reachability">, nodes: readonly Node[],
  producer: RustObjectLiteralEmissionProducer, propertyName: (node: Node) => SourcePropertyNameSelection | undefined): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const node of nodes) {
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
  const modules = new Map<SourceFile, RustObjectLiteralEmissionRequest[]>();
  const structural = (node: Node, carrier: TargetTypeRef, accessorFields: ReadonlySet<number>): RustStructuralLiteralEmission => {
    const shape = program.structuralShapes.templateForCarrier(carrier);
    if (shape?.dispatchName === undefined || shape.construction !== undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal requires its exact native dispatch template.", node);
    const fields = shape.fields.map((field, storageIndex) => {
      if (field.nativeLayout !== undefined || field.storage === "bound")
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal requires its selected native value or callable storage.", node);
      const protocol = field.method ? rustCallableProtocol(field.carrier) : undefined;
      const storage = field.methodStorageCarrier;
      if (field.method && (protocol === undefined || storage === undefined))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal method requires its exact native callable storage.", node);
      const accessor = accessorFields.has(storageIndex);
      const value = accessor ? rustStructuralPropertyValueCarrier(field.carrier, field.presence) : undefined;
      if (!field.method && (field.property === undefined || accessor && (value === undefined || field.property.selfMode !== "rc" ||
        field.property.setterTargetName !== undefined && field.presence !== "required")))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted structural literal property requires its exact native accessor ABI.", node);
      return Object.freeze({ field, copy: isRustCopyCarrier(field.carrier),
        frozen: program.frozenDataWrites.receiverFor("structural-object", carrier, storageIndex) !== undefined,
        method: protocol === undefined || storage === undefined ? undefined : Object.freeze({ parameters: protocol.parameters, result: protocol.result, storage }),
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
  const visit = (node: Node): void => {
    const fact = program.records.targetOperation.get(node);
    if (native.has(node) && fact?.kind === "record-literal") {
      const project = program.projectTypes.definitionForCarrier(fact.resultCarrier);
      const form = selectRustObjectLiteralDispatch({ fact, structuralDispatch: program.structuralShapes.definitionForCarrier(fact.resultCarrier)?.dispatchName !== undefined,
        polymorphicProject: project !== undefined && program.projectTypes.isPolymorphic(project) });
      if (form !== undefined) {
        const selected: RustObjectLiteralEmission = form === "project" ? Object.freeze({ kind: "project", node, selection: analyzeRustProjectLiteralEmission(program, node, fact) })
          : Object.freeze({ kind: "structural", node, selection: structural(node, fact.resultCarrier, new Set(fact.contributions.flatMap(contribution =>
            contribution.kind === "accessor" && contribution.role === "get" ? [contribution.targetStorageIndex] : []))) });
        producer.literal(node, selected);
        append(selected);
      }
    }
    const view = program.records.objectReferenceView.get(node);
    if (native.has(node) && view?.kind === "structural" && program.structuralShapes.definitionForCarrier(view.targetCarrier)?.dispatchName !== undefined)
      append(Object.freeze({ kind: "reference", node, selection: structural(node, view.targetCarrier, new Set(view.fields.map(field => field.destinationIndex))) }));
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  for (const [file, requests] of modules) producer.module(file, Object.freeze(requests));
  return Object.freeze(issues);
}
