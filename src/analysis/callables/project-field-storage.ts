import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { Node_Type } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustProjectStructuralView } from "../../target-model/records/project-structural-views.js";
import type { RustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-registry.js";
import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustCallableTargetForSourceLifetime } from "../../policy/conversions/value-carrier-reconciliation.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { closeRustRetainedCallableCarrier, rustRequiresCallableFieldStorage } from "../../policy/ownership/retained-storage.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";

export interface RustProjectCallableFieldStorage {
  get(declaration: Node): TargetTypeRef | undefined;
}

export interface RustProjectCallableFieldStorageConstruction extends RustProjectCallableFieldStorage {
  completeViews(views: readonly RustProjectStructuralView[], shapes: Pick<RustStructuralShapePlanRegistry, "completePhysicalCarrier">):
    readonly RustSourceCallableSpecializationIssue[];
  seal(): TargetStageResult<RustProjectCallableFieldStorage>;
}

export function prepareRustProjectCallableFieldStorage(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: Pick<RustObjectRepresentationPlan, "nativeLifetimeFor">;
}, subjectFor: (subject: Extract<ReturnType<SourceStorageQueries["subject"]>, { readonly kind: "resolved" }>["subject"],
  carrier: TargetTypeRef) => RustNativeStorageSelection): RustProjectCallableFieldStorageConstruction {
  const fields = new Set<Node>();
  for (const definition of input.projectTypes.definitions) {
    for (const field of input.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []) {
      fields.add(field.declaration);
    }
  }
  const selected = new Map<Node, TargetTypeRef>();
  const failures = new Map<Node, string>();
  let closed = false;
  const published = Object.freeze({ get: (declaration: Node) => selected.get(declaration) });
  const select = (declaration: Node): TargetTypeRef | undefined => {
    const existing = selected.get(declaration);
    if (existing !== undefined) return existing;
    const field = fields.has(declaration);
    const declared = !field ? undefined : input.records.runtimeCarrier.get(declaration)?.carrier ??
      input.records.runtimeCarrier.get(Node_Type(input.ast, declaration))?.carrier;
    if (!field || declared === undefined || !rustRequiresCallableFieldStorage(declared)) return undefined;
    const subject = input.storage.subject(declaration, "member");
    if (subject.kind === "unresolved") { failures.set(declaration, subject.reason); return undefined; }
    const selection = subjectFor(subject.subject, declared);
    if (selection.kind === "unresolved") { failures.set(declaration, selection.reason); return undefined; }
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const requiredLifetime = owner === undefined ? undefined : input.objectRepresentations.nativeLifetimeFor(owner)?.ownedCallableFieldLifetime;
    const carrier = requiredLifetime === undefined ? selection.carrier : closeRustRetainedCallableCarrier(selection.carrier, requiredLifetime);
    selected.set(declaration, carrier);
    failures.delete(declaration);
    return carrier;
  };
  return Object.freeze({ get: (declaration: Node) => closed ? selected.get(declaration) : select(declaration),
    completeViews(views: readonly RustProjectStructuralView[], shapes: Pick<RustStructuralShapePlanRegistry, "completePhysicalCarrier">) {
      if (closed) failTargetAnalysisInvariant("tsonic-rust", "Structural field views complete while their original physical member owner is open.");
      const issues: RustSourceCallableSpecializationIssue[] = [];
      for (const view of views) {
        const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
        if (shape === undefined) {
          issues.push({ subject: view.declaration, message: "A physical field view requires its exact original structural destination." });
          continue;
        }
        let changed = false;
        let demanded = false;
        let unavailable = false;
        const members = new Map(view.fields.map(member => [member.storageIndex, member]));
        const completed = shape.fields.map((field, index) => {
          const member = members.get(index);
          if (member?.field === undefined || rustCallableProtocol(rustOptionElementCarrier(member.field.resultCarrier) ??
            member.field.resultCarrier) === undefined) return field;
          demanded = true;
          const stored = select(member.declaration);
          const physical = stored === undefined ? undefined
            : input.projectTypes.instantiateMemberCarrier(member.declaration, view.sourceCarrier, stored);
          if (physical === undefined) {
            unavailable = true;
            issues.push({ subject: member.declaration, message: failures.get(member.declaration) ??
              "A physical field view requires its exact instantiated native member storage before structural completion." });
            return field;
          }
          const type = rustCallableTargetForSourceLifetime(physical, field.type);
          changed ||= type !== field.type;
          return type === field.type ? field : Object.freeze({ ...field, type });
        });
        if (!demanded || unavailable) continue;
        const physical = changed ? rustStructuralObjectTargetType(shape.ownerFileName, Object.freeze(completed), shape.representation,
          shape.construction, shape.bases, shape.implementation) : view.targetCarrier;
        const selected = shapes.completePhysicalCarrier(view.targetCarrier, physical);
        if (selected.kind === "unresolved") issues.push({ subject: view.declaration, message: selected.reason });
      }
      return Object.freeze(issues);
    },
    seal(): TargetStageResult<RustProjectCallableFieldStorage> {
      if (closed) return resolvedTargetStage(published);
      const issues: TargetDiagnostic[] = [];
      for (const declaration of fields.keys()) {
        const declared = input.records.runtimeCarrier.get(declaration)?.carrier ??
          input.records.runtimeCarrier.get(Node_Type(input.ast, declaration))?.carrier;
        if (declared === undefined || !rustRequiresCallableFieldStorage(declared) || select(declaration) !== undefined) continue;
        const storageFailure = input.storage.failureReason();
        issues.push({ code: storageFailure === undefined ? "RUST_CALLABLE_VALUE_NOT_CLOSED" : "RUST_SOURCE_STORAGE_NOT_PROVEN",
          category: "error", source: "tsonic-rust", sourceNode: declaration,
          message: storageFailure ?? failures.get(declaration) ?? "A callable field requires its complete physical native member storage.",
          evidence: ["target.capability=rust.callable-value.exact-implementation"] });
      }
      if (issues.length !== 0) return rejectedTargetStage(Object.freeze(issues));
      closed = true;
      return resolvedTargetStage(published);
    } });
}
