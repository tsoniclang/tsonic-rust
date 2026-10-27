import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectClassProducer } from "../program/records/objects/project-classes.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectRootContractEmission, RustProjectRootFieldEmission, RustProjectRootMethodEmission } from "../../target-model/records/objects/project-classes.js";
import type { RustProjectMethodDispatchVariant } from "../../target-model/records/operations/method-dispatch.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustProjectMemberIsPrivate } from "./member-privacy.js";

export function analyzeRustProjectRootEmission(program: Omit<RustAnalysisProgram, "reachability">, concrete: RustProjectTypeDefinition,
  carrier: TargetTypeRef, producer: RustProjectClassProducer,
  requestArguments: (member: Node, arguments_: readonly TargetTypeRef[], receiver: TargetTypeRef) => void): void {
  const contracts = program.projectTypes.contractsForClass(concrete);
  const lineage = program.projectTypes.classLineage(concrete);
  if (contracts === undefined || lineage === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native root requires its exact checked contracts and state lineage.", concrete.declaration);
  const selectedContracts: RustProjectRootContractEmission[] = [];
  for (const contract of contracts) {
    const contractCarrier = producer.records.projectRelationship.get(carrier, contract);
    const fields = contractCarrier === undefined ? undefined : producer.records.projectClassFields.get(contract, contractCarrier);
    if (contractCarrier === undefined || fields === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native root contract requires its exact instantiated fields.", contract.declaration);
    const fieldPlans = new Map<Node, RustProjectRootFieldEmission>();
    for (const field of fields) {
      const privateField = field.origin === "project" && rustProjectMemberIsPrivate(program.source.ast, field.declaration);
      const dispatch = program.projectFieldDispatch.planFor(field.declaration);
      const implementation = field.origin === "external" ? { kind: "stored" as const, declaration: field.declaration }
        : privateField ? { kind: program.objectRepresentations.aliasFor(field.declaration) === undefined ? "stored" as const : "receiver-alias" as const, declaration: field.declaration }
          : program.projectFieldDispatch.implementationFor(concrete, field.declaration);
      const read = program.projectTypes.memberSlotName(field.declaration, "read");
      const write = dispatch?.write === undefined ? undefined : program.projectTypes.memberSlotName(field.declaration, "write");
      if (dispatch === undefined || implementation === undefined || read === undefined || dispatch.write !== undefined && write === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted root field requires its exact native implementation and dispatch slots.", field.declaration);
      const getter = implementation.kind === "accessor" ? producer.records.projectCallableSignature.get(implementation.getter) : undefined;
      const setter = implementation.kind === "accessor" && implementation.setter !== undefined ? producer.records.projectCallableSignature.get(implementation.setter) : undefined;
      if (implementation.kind === "accessor" && (getter === undefined || dispatch.write !== undefined && setter === undefined) ||
        !dispatch.read.fallible && getter?.fallible === true || dispatch.write?.fallible === false && setter?.fallible === true)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted root field requires its exact native accessor effects.", field.declaration);
      const error = program.records.projectMemberError.get(field.declaration)?.carrier;
      if ((dispatch.read.fallible || dispatch.write?.fallible === true) && error === undefined ||
        getter?.fallible === true && !rustTargetTypeRefEquals(getter.errorCarrier, error) ||
        setter?.fallible === true && !rustTargetTypeRefEquals(setter.errorCarrier, error))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted root field requires its exact contract-owned native accessor error ABI.", field.declaration);
      fieldPlans.set(field.declaration, Object.freeze({ private: privateField, implementation, dispatch, read, write,
        capture: program.projectTypes.memberSlotName(field.declaration, "capture"),
        contentMutation: dispatch.stored && dispatch.mutableContent && field.carrier.kind === "array",
        readWrap: dispatch.read.fallible && getter?.fallible !== true,
        writeWrap: dispatch.write?.fallible === true && setter?.fallible !== true }));
    }
    const accessors = (producer.records.projectClassAccessors.get(contract) ?? []).map(accessor => {
      const implementation = program.projectTypes.memberImplementation(concrete, accessor.declaration);
      const slot = program.projectTypes.memberSlotName(accessor.declaration, accessor.role);
      if (implementation.kind !== "resolved" || slot === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native accessor requires its exact concrete implementation and slot.", accessor.declaration);
      return Object.freeze({ ...accessor, implementation: implementation.implementation.declaration, slot });
    });
    const methods: RustProjectRootMethodEmission[] = [];
    const writes = new Set<Node>();
    for (const member of program.records.classMethods.get(contract.declaration) ?? []) {
      if (program.source.ast.hasModifierKind(member, "static")) continue;
      const implementation = program.projectTypes.memberImplementation(concrete, member);
      if (implementation.kind !== "resolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted native method requires its exact concrete implementation.", member);
      const virtual = implementation.implementation.declaration;
      const writable = program.projectMethodProperties.usageFor(member)?.writable === true || program.projectMethodProperties.usageFor(virtual)?.writable === true;
      const overridePath = writable ? producer.records.projectMethodPropertyPath.get(concrete, virtual) : undefined;
      if (writable && overridePath === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted writable root method requires its exact physical override slot.", member);
      for (const variant of program.projectMethodDispatch.variantsForMember(member)) {
        requestArguments(member, variant.targetTypeArguments, carrier);
        const arguments_ = producer.records.projectMethodArguments.get(member, variant.targetTypeArguments, carrier);
        if (arguments_ === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted root method requires its exact instantiated arguments.", member);
        const select = (declaration: Node): { readonly declaration: Node; readonly variant: RustProjectMethodDispatchVariant } => {
          const selected = program.projectMethodDispatch.variantForMember(declaration, arguments_, carrier);
          if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted root method requires its exact native implementation variant.", declaration);
          requestArguments(declaration, selected.targetTypeArguments, carrier);
          return Object.freeze({ declaration, variant: selected });
        };
        let exact: RustProjectRootMethodEmission["exact"];
        if (contract.kind === "class" && !program.source.ast.hasModifierKind(member, "abstract")) {
          const selected = lineage.includes(contract) ? program.projectTypes.memberImplementation(contract, member) : implementation;
          if (selected.kind !== "resolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted exact native method requires its checked declaring-class implementation.", member);
          exact = select(selected.implementation.declaration);
        }
        let write: RustProjectRootMethodEmission["write"];
        if (!writes.has(member) && program.projectMethodProperties.usageFor(member)?.writable === true) {
          writes.add(member);
          const slot = program.projectTypes.memberSlotName(member, "method-write");
          const owner = program.projectTypes.definitionContainingDeclaration(virtual);
          const ownerCarrier = owner === undefined ? undefined : producer.records.projectRelationship.get(carrier, owner);
          const property = owner === undefined || ownerCarrier === undefined ? undefined
            : producer.records.projectMethodProperties.get(owner, ownerCarrier)?.find(candidate => candidate.declaration === virtual);
          if (slot === undefined || overridePath === undefined || property === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted root method replacement requires its exact native slot and callable storage.", member);
          write = Object.freeze({ slot, path: overridePath, property });
        }
        methods.push(Object.freeze({ member, variant, virtual: select(virtual), exact, overridePath, write }));
      }
    }
    const routes = program.projectTypes.downcastRoutesFor(contract).filter(route => {
      const relation = program.projectTypes.relationship(carrier, route.target);
      return (route.target.kind === "interface" || lineage.includes(route.target)) && relation.kind === "related" && rustTargetTypeRefEquals(relation.targetType, route.targetCarrier);
    });
    selectedContracts.push(Object.freeze({ definition: contract, carrier: contractCarrier, fields: fieldPlans,
      projectionSlot: program.projectTypes.checkedProjectionSlot(contract), routes: Object.freeze(routes), accessors: Object.freeze(accessors), methods: Object.freeze(methods) }));
  }
  producer.root(carrier, { contracts: Object.freeze(selectedContracts), projections: Object.freeze(program.classValues.instanceViewImplementations
    .filter(view => view.declaration === concrete.declaration && rustTargetTypeRefEquals(view.sourceCarrier, carrier)).map(view => view.targetCarrier)) });
}
