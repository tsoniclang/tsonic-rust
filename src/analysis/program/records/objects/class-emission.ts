import type { Node } from "@tsonic/tsts";
import type { RustNativeClassEmission } from "../../../../target-model/records/objects/class-emission.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeMemberVisibility, RustNativeMemberVisibilityRecords } from "../../../../target-model/records/native/native-member-names.js";
import type { RustClassEnvironmentRecords, RustClassEnvironmentTypeEmission, RustClassMemberEnvironmentEmission } from "../../../../target-model/records/objects/class-environments.js";
import type { RustNamedClassEnvironment } from "../../../../target-model/records/objects/class-values.js";
import type { RustClassValueReadEmission, RustClassValueModuleEmission } from "../../../../target-model/records/objects/class-environments.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue } from "../../../../target-model/types/index.js";
import type { RustClassValueCallable, RustClassValueForwarderEmission, RustClassValueForwarderRecords } from "../../../../target-model/records/callables/class-value-callables.js";
import type { RustClassImplementationContext, RustClassImplementationGenerics, RustClassConstructorViewEmission, RustClassImplementationRecords, RustClassStructuralViewEmission } from "../../../../target-model/records/objects/class-implementations.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustProjectViewMatches } from "../../../../policy/types/objects/project-view-bindings.js";
import type { RustProjectStructuralView } from "../../../../target-model/records/objects/project-structural-views.js";
import type { RustStructuralViewCallableEmission } from "../../../../target-model/records/objects/class-implementations.js";
import type { RustShapeGenericRequirementContract } from "../../../../target-model/records/types/generic-requirements.js";

export interface RustClassEmissionProducer {
  instanceViews(declaration: Node, fileName: string, values: readonly RustClassStructuralViewEmission[]): void;
  instanceViewPolymorphic(declaration: Node, value: boolean): void;
  instanceViewCallable(callable: RustClassValueCallable, value: RustStructuralViewCallableEmission): void;
  structuralViewRequirements(view: RustProjectStructuralView, value: RustShapeGenericRequirementContract): void;
  readonly implementationRecords: RustClassImplementationRecords;
  implementationContext(declaration: Node, carrier: TargetTypeRef, value: RustClassImplementationContext): void;
  implementationGenerics(carrier: TargetTypeRef, value: RustClassImplementationGenerics): void;
  constructorViews(declaration: Node, fileName: string, values: readonly RustClassConstructorViewEmission[]): void;
  readonly records: RustRecordFamily<RustNativeClassEmission>;
  readonly visibilityRecords: RustNativeMemberVisibilityRecords;
  readonly environmentRecords: RustClassEnvironmentRecords;
  readonly forwarderRecords: RustClassValueForwarderRecords;
  forwarder(subject: RustClassValueCallable, construction: boolean, value: RustClassValueForwarderEmission): void;
  environment(subject: RustProjectTypeDefinition, value: RustClassEnvironmentTypeEmission): void;
  memberEnvironment(subject: Node, value: RustClassMemberEnvironmentEmission): void;
  staticEnvironment(subject: Node, value: RustNamedClassEnvironment): void;
  callGenericArguments(subject: Node, count: number): void;
  valueRead(subject: Node, value: RustClassValueReadEmission): void;
  moduleValue(subject: Node, value: RustClassValueModuleEmission): void;
  visibility(subject: Node, value: RustNativeMemberVisibility): void;
  classDeclaration(subject: Node, value: RustNativeClassEmission): void;
}

export function createRustClassEmissionProducer(assertOpen: () => void): RustClassEmissionProducer {
  const visibility = new WeakMap<Node, RustNativeMemberVisibility>();
  const environments = new WeakMap<Node, RustClassEnvironmentTypeEmission>();
  const environmentsByFile = new Map<string, Map<string, RustClassEnvironmentTypeEmission>>();
  const memberEnvironments = new WeakMap<Node, RustClassMemberEnvironmentEmission>();
  const staticEnvironments = new WeakMap<Node, RustNamedClassEnvironment>();
  const genericArguments = new WeakMap<Node, number>();
  const reads = new WeakMap<Node, RustClassValueReadEmission>();
  const moduleValues = new WeakMap<Node, RustClassValueModuleEmission>();
  const forwarders = new WeakMap<RustClassValueCallable, Map<boolean, RustClassValueForwarderEmission>>();
  const implementationContexts = new WeakMap<Node, Map<string, RustClassImplementationContext>>();
  const implementationGenerics = new Map<string, RustClassImplementationGenerics>();
  const constructorViews = new WeakMap<Node, Map<string, readonly RustClassConstructorViewEmission[]>>();
  const viewRequirements = new WeakMap<RustProjectStructuralView, RustShapeGenericRequirementContract>();
  const instanceViews = new WeakMap<Node, Map<string, readonly RustClassStructuralViewEmission[]>>();
  const instanceConversions = new Map<string, RustProjectStructuralView>();
  const instancePolymorphic = new WeakMap<Node, boolean>();
  const instanceCallables = new WeakMap<RustClassValueCallable, RustStructuralViewCallableEmission>();
  const family = createRustRecordFamily<RustNativeClassEmission>({ id: "tsonic.rust.nativeClass", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    implementationRecords: Object.freeze({
      // A use converts one instance of an emitted view; the emitted (generalized) view that binds to it is its conversion.
      structuralView: Object.freeze({ get: (source: TargetTypeRef, target: TargetTypeRef) => {
        const exact = instanceConversions.get(closedMetadataKey([source, target]));
        if (exact !== undefined) return exact;
        const covering = [...instanceConversions.values()].filter(view => rustProjectViewMatches(view, source, target));
        return covering.length === 1 ? covering[0] : undefined;
      } }),
      structuralViewImplementations: Object.freeze({ get: (declaration: Node, fileName: string) => instanceViews.get(declaration)?.get(fileName) }),
      structuralViewPolymorphic: Object.freeze({ get: (declaration: Node) => instancePolymorphic.get(declaration) }),
      structuralViewCallable: Object.freeze({ get: (callable: RustClassValueCallable) => instanceCallables.get(callable) }),
      structuralViewRequirements: Object.freeze({ get: (view: RustProjectStructuralView) => viewRequirements.get(view) }),
      classImplementationContext: Object.freeze({ get: (declaration: Node, carrier: TargetTypeRef) => implementationContexts.get(declaration)?.get(closedMetadataKey(carrier)) }),
      classImplementationGenerics: Object.freeze({ get: (carrier: TargetTypeRef) => implementationGenerics.get(closedMetadataKey(carrier)) }),
      classConstructorViews: Object.freeze({ get: (declaration: Node, fileName: string) => constructorViews.get(declaration)?.get(fileName) }),
    }),
    instanceViews(declaration: Node, fileName: string, values: readonly RustClassStructuralViewEmission[]): void {
      assertOpen();
      let files = instanceViews.get(declaration);
      if (files === undefined) { files = new Map(); instanceViews.set(declaration, files); }
      if (files.has(fileName)) failTargetAnalysisInvariant("tsonic-rust", "A structural implementation inventory has one source owner.", declaration);
      files.set(fileName, Object.freeze(values));
      for (const view of values) {
        const key = closedMetadataKey([view.sourceCarrier, view.targetCarrier]);
        if (!instanceConversions.has(key)) instanceConversions.set(key, view);
      }
    },
    instanceViewPolymorphic(declaration: Node, value: boolean): void {
      assertOpen();
      if (instancePolymorphic.has(declaration)) failTargetAnalysisInvariant("tsonic-rust", "A structural class has one native dispatch decision.", declaration);
      instancePolymorphic.set(declaration, value);
    },
    instanceViewCallable(callable: RustClassValueCallable, value: RustStructuralViewCallableEmission): void {
      assertOpen();
      if (instanceCallables.has(callable)) failTargetAnalysisInvariant("tsonic-rust", "A structural callable has one native dispatch owner.", callable.declaration);
      instanceCallables.set(callable, Object.freeze(value));
    },
    structuralViewRequirements(view: RustProjectStructuralView, value: RustShapeGenericRequirementContract): void {
      assertOpen();
      if (viewRequirements.has(view)) failTargetAnalysisInvariant("tsonic-rust", "A native structural view has one generic requirement owner.", view.declaration);
      viewRequirements.set(view, value);
    },
    implementationContext(declaration: Node, carrier: TargetTypeRef, value: RustClassImplementationContext): void {
      assertOpen();
      let instances = implementationContexts.get(declaration);
      if (instances === undefined) { instances = new Map(); implementationContexts.set(declaration, instances); }
      const key = closedMetadataKey(carrier);
      if (instances.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A class implementation context has one exact source owner.", declaration);
      instances.set(key, Object.freeze(value));
    },
    implementationGenerics(carrier: TargetTypeRef, value: RustClassImplementationGenerics): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (implementationGenerics.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A class implementation generic inventory has one source owner.");
      implementationGenerics.set(key, Object.freeze(value));
    },
    constructorViews(declaration: Node, fileName: string, values: readonly RustClassConstructorViewEmission[]): void {
      assertOpen();
      let files = constructorViews.get(declaration);
      if (files === undefined) { files = new Map(); constructorViews.set(declaration, files); }
      if (files.has(fileName)) failTargetAnalysisInvariant("tsonic-rust", "A class constructor implementation inventory has one source owner.", declaration);
      files.set(fileName, Object.freeze(values));
    },
    forwarderRecords: Object.freeze({ classValueForwarder: Object.freeze({ get: (subject: RustClassValueCallable, construction: boolean) => forwarders.get(subject)?.get(construction) }) }),
    forwarder(subject: RustClassValueCallable, construction: boolean, value: RustClassValueForwarderEmission): void {
      assertOpen();
      let modes = forwarders.get(subject);
      if (modes === undefined) { modes = new Map(); forwarders.set(subject, modes); }
      if (modes.has(construction)) failTargetAnalysisInvariant("tsonic-rust", "A native class value forwarder has one source owner.", subject.declaration);
      modes.set(construction, Object.freeze(value));
    },
    environmentRecords: Object.freeze({
      classValueRead: Object.freeze({ get: (subject: Node) => reads.get(subject) }),
      classValueModule: Object.freeze({ get: (subject: Node) => moduleValues.get(subject) }),
      classMemberEnvironment: Object.freeze({ get: (subject: Node) => memberEnvironments.get(subject) }),
      classStaticEnvironment: Object.freeze({ get: (subject: Node) => staticEnvironments.get(subject) }),
      classCallGenericArguments: Object.freeze({ get: (subject: Node) => genericArguments.get(subject) }),
      classEnvironment: Object.freeze({ get: (subject: Node) => environments.get(subject) }),
      classEnvironmentType: Object.freeze({ get: (carrier: TargetTypeRef) => {
        const identity = rustSourceTypeCarrierValue(carrier);
        return identity === undefined ? undefined : environmentsByFile.get(identity.fileName)?.get(identity.typeName);
      } }),
    }),
    valueRead(subject: Node, value: RustClassValueReadEmission): void {
      assertOpen();
      if (reads.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native class value read is selected exactly once.", subject);
      reads.set(subject, Object.freeze(value));
    },
    moduleValue(subject: Node, value: RustClassValueModuleEmission): void {
      assertOpen();
      if (moduleValues.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native class module value is selected exactly once.", subject);
      moduleValues.set(subject, Object.freeze(value));
    },
    memberEnvironment(subject: Node, value: RustClassMemberEnvironmentEmission): void {
      assertOpen();
      if (memberEnvironments.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native member environment has one producer.", subject);
      memberEnvironments.set(subject, Object.freeze(value));
    },
    staticEnvironment(subject: Node, value: RustNamedClassEnvironment): void {
      assertOpen();
      if (staticEnvironments.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native static environment has one producer.", subject);
      staticEnvironments.set(subject, value);
    },
    callGenericArguments(subject: Node, count: number): void {
      assertOpen();
      if (genericArguments.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native class call generic context has one producer.", subject);
      genericArguments.set(subject, count);
    },
    environment(subject: RustProjectTypeDefinition, value: RustClassEnvironmentTypeEmission): void {
      assertOpen();
      if (environments.has(subject.declaration)) failTargetAnalysisInvariant("tsonic-rust", "A native class environment is written exactly once.", subject.declaration);
      let declarations = environmentsByFile.get(subject.fileName);
      if (declarations === undefined) { declarations = new Map(); environmentsByFile.set(subject.fileName, declarations); }
      // Readers look the environment up by its carrier (classEnvironmentType), so it is keyed by the carrier identity,
      // which differs from the target path for a class nested in a callable.
      const identity = rustSourceTypeCarrierValue(value.environment.carrier)?.typeName;
      if (identity === undefined || declarations.has(identity))
        failTargetAnalysisInvariant("tsonic-rust", "A native class environment requires one exact source carrier identity.", subject.declaration);
      const selected = Object.freeze(value);
      environments.set(subject.declaration, selected);
      declarations.set(identity, selected);
    },
    visibilityRecords: Object.freeze({ nativeMemberVisibility: Object.freeze({ get: (subject: Node, publiclyReachable: boolean) => {
      const selected = visibility.get(subject);
      return publiclyReachable ? selected?.public : selected?.internal;
    } }) }),
    visibility(subject: Node, value: RustNativeMemberVisibility): void {
      assertOpen();
      if (visibility.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native member visibility is written exactly once.", subject);
      visibility.set(subject, Object.freeze(value));
    },
    classDeclaration: (subject: Node, value: RustNativeClassEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
