import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustObjectReferenceEmissionProducer } from "../program/records/object-reference-views.js";
import type { RustObjectReferenceEmission } from "../../target-model/records/object-reference-views.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { rustOptionElementCarrier, rustStructuralPropertyGetterStorageCarrier, rustStructuralPropertySetterStorageCarrier } from "../../target-model/types/index.js";

export function analyzeRustObjectReferenceEmission(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustObjectReferenceEmissionProducer) {
  const issues: TargetDiagnostic[] = [];
  const types: TargetTypeRef[] = [];
  const refuse = (node: Node): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `An object reference view requires its exact native owner, destination fields and callable storage. Node kind: ${program.source.ast.kindName(node)}.`,
      evidence: ["target.capability=rust.backend.object-reference-view"] });
  };
  for (const node of nodes) {
    const view = program.records.objectReferenceView.get(node);
    if (view === undefined) continue;
    if (view.kind === "project") { producer.publish(node, { kind: "project", view }); continue; }
    if (view.kind === "constructor") {
      const instance = rustClassConstructorInstance(view.sourceCarrier);
      if (instance === undefined || program.classValues.viewFor(view.declaration, instance, view.targetCarrier) === undefined) { refuse(node); continue; }
      producer.publish(node, { kind: "constructor", view });
      continue;
    }
    const shape = program.structuralShapes.definitionForCarrier(view.targetCarrier);
    if (shape === undefined || shape.fields.length !== view.fields.length) { refuse(node); continue; }
    const fields: Extract<RustObjectReferenceEmission, { readonly kind: "structural" }>["fields"][number][] = [];
    for (const [index, field] of view.fields.entries()) {
      const target = shape.fields[index];
      if (target === undefined || field.destinationIndex !== index || target.storage !== "property") break;
      const getter = rustOptionElementCarrier(rustStructuralPropertyGetterStorageCarrier(view.targetCarrier, target.carrier, target.presence));
      const setter = !field.writable ? undefined : rustOptionElementCarrier(rustStructuralPropertySetterStorageCarrier(view.targetCarrier, target.carrier, target.presence));
      const dispatch = field.source.declaration === undefined ? undefined : program.records.projectFieldDispatch.get(field.source.declaration);
      if (getter === undefined || field.writable && setter === undefined || field.source.dispatch !== undefined &&
        (dispatch === undefined || field.writable && dispatch.write === undefined)) break;
      types.push(getter, ...(setter === undefined ? [] : [setter]));
      fields.push(Object.freeze({ source: field.source, getter, setter }));
    }
    if (fields.length !== view.fields.length) { refuse(node); continue; }
    producer.publish(node, { kind: "structural", view, dispatch: shape.dispatchName !== undefined, fields: Object.freeze(fields) });
  }
  return { issues: Object.freeze(issues), types };
}
