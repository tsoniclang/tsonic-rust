import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustReachability } from "../../target-model/records/program/reachability.js";
import type { RustDispatchMemberRole } from "../../target-model/records/program/reachability.js";
import type { RustProjectClassProducer } from "../program/records/objects/project-classes.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { RustProjectDispatchEmission } from "../../target-model/records/objects/project-classes.js";
import type { RustDeadCodeDisposition } from "../../target-model/records/native/native-liveness.js";
import { rustSourceItemIdentity } from "../../target-model/names/source-output-identities.js";
import { selectRustStructuralDispatchArguments } from "../../policy/types/objects/structural-generics.js";

export function analyzeRustProjectDispatchEmission(program: Omit<RustAnalysisProgram, "reachability">,
  definition: RustProjectTypeDefinition, reachability: RustReachability, producer: RustProjectClassProducer): readonly TargetDiagnostic[] {
  const structuralSupers: RustProjectDispatchEmission["structuralSupers"][number][] = [];
  const objectLifetime = program.objectRepresentations.representationFor(definition)?.dispatchObjectLifetime;
  for (const view of program.classValues.instanceViews) {
    if (view.declaration !== definition.declaration) continue;
    const shape = program.structuralShapes.definitionForCarrier(view.targetCarrier);
    if (shape === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted structural supertrait requires its exact selected native shape.", definition.declaration);
    const dispatch = program.records.structuralShapeEmission.get(shape)?.dispatch;
    if (dispatch === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted structural supertrait requires its completed native generic membership.", definition.declaration);
    const genericArguments = selectRustStructuralDispatchArguments(
      dispatch.genericParameterIndices.map(index => shape.stateGenericArguments[index]!), objectLifetime);
    if (genericArguments === undefined) return Object.freeze([{
      code: "RUST_STRUCTURAL_SUPER_LIFETIME_UNRESOLVED", category: "error", source: "tsonic-rust", sourceNode: definition.declaration,
      message: "A structural supertrait requires a proven native object lifetime for its captured callable storage.",
      evidence: ["target.capability=rust.analysis.project-structural-dispatch"],
    }]);
    structuralSupers.push(Object.freeze({ carrier: shape.carrier, genericArguments }));
  }
  const component = program.sourcePackageComponents.componentForFile(definition.fileName);
  if (component === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native project dispatch trait requires its exact source component.", definition.declaration);
  const publiclyReachable = program.projectTypes.programErrorVariant(definition) !== undefined || component.publishesImplementationAbi ||
    program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId)
      .includes(rustSourceItemIdentity(definition.fileName, definition.targetPath));
  const suppressed = reachability.suppressedDeclarations.has(definition.declaration);
  const deadCode = (member: Node, role: RustDispatchMemberRole): RustDeadCodeDisposition | undefined =>
    publiclyReachable || suppressed || reachability.usedDispatchMembers.get(member)?.has(role) === true ? undefined : "generated-unused-dispatch";
  const carrier = program.projectTypes.openCarrier(definition);
  const fields = producer.records.projectClassFields.get(definition, carrier);
  if (fields === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native dispatch trait requires its exact instantiated field inventory.", definition.declaration);
  const selectedFields = new Map<Node, RustProjectDispatchEmission["fields"] extends ReadonlyMap<Node, infer Value> ? Value : never>();
  for (const field of fields) {
    const dispatch = program.projectFieldDispatch.planFor(field.declaration);
    const read = program.projectTypes.memberSlotName(field.declaration, "read");
    const write = dispatch?.write === undefined ? undefined : program.projectTypes.memberSlotName(field.declaration, "write");
    const captured = program.records.capturedFieldStorage.get(field.declaration) !== undefined;
    const capture = captured ? program.projectTypes.memberSlotName(field.declaration, "capture") : undefined;
    if (dispatch === undefined || read === undefined || dispatch.write !== undefined && write === undefined || captured && (!dispatch.stored || capture === undefined))
      failTargetAnalysisInvariant("tsonic-rust", "A native dispatch field requires its exact physical slots and effects.", field.declaration);
    selectedFields.set(field.declaration, Object.freeze({ dispatch, read, write, capture,
      contentMutation: dispatch.stored && dispatch.mutableContent && field.carrier.kind === "array",
      deadCode: Object.freeze({ read: deadCode(field.declaration, "read"), write: deadCode(field.declaration, "write"),
        capture: deadCode(field.declaration, "capture"), content: deadCode(field.declaration, "content") }) }));
  }
  const accessors = (producer.records.projectClassAccessors.get(definition) ?? []).map(accessor => {
    const slot = program.projectTypes.memberSlotName(accessor.declaration, accessor.role);
    if (slot === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native accessor requires its exact dispatch slot.", accessor.declaration);
    return Object.freeze({ ...accessor, slot, deadCode: deadCode(accessor.declaration, accessor.role) });
  });
  const methods: RustProjectDispatchEmission["methods"][number][] = [];
  for (const declaration of program.records.classMethods.get(definition.declaration) ?? []) {
    if (program.source.ast.hasModifierKind(declaration, "static")) continue;
    for (const variant of program.projectMethodDispatch.variantsForMember(declaration)) methods.push(Object.freeze({ declaration, variant,
      exact: definition.kind === "class" && !program.source.ast.hasModifierKind(declaration, "abstract"),
      virtualDeadCode: deadCode(declaration, "method-virtual"), exactDeadCode: deadCode(declaration, "method-exact") }));
  }
  const writes: RustProjectDispatchEmission["methodWrites"][number][] = [];
  const slots = new Set<string>();
  for (const property of producer.records.projectMethodProperties.get(definition, carrier) ?? []) {
    const slot = program.projectTypes.memberSlotName(property.declaration, "method-write");
    if (slot === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted writable native method requires its exact dispatch slot.", property.declaration);
    if (slots.has(slot)) continue;
    slots.add(slot);
    writes.push(Object.freeze({ property, slot, deadCode: deadCode(property.declaration, "write") }));
  }
  const projection = program.projectTypes.checkedProjectionSlot(definition);
  producer.dispatch(definition, { publiclyReachable, deadCode: suppressed ? "authored-declaration" : undefined,
    projection: projection === undefined ? undefined : Object.freeze({ slot: projection,
      deadCode: publiclyReachable || reachability.usedCheckedProjections.has(definition.declaration) ? undefined : "generated-unused-dispatch" }),
    routes: Object.freeze(program.projectTypes.downcastRoutesFor(definition).map(route => Object.freeze({ route,
      deadCode: publiclyReachable || suppressed || reachability.usedDowncasts.get(definition.declaration)?.has(route.target.declaration) === true
        ? undefined : "generated-unused-dispatch" }))), fields: selectedFields, accessors: Object.freeze(accessors), methods: Object.freeze(methods),
    methodWrites: Object.freeze(writes), projectSupers: Object.freeze(program.projectTypes.heritageForDefinition(definition).map(edge => edge.targetType)),
    structuralSupers: Object.freeze(structuralSupers) });
  return Object.freeze([]);
}
