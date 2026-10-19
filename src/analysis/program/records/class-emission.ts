import type { Node } from "@tsonic/tsts";
import type { RustNativeClassEmission } from "../../../target-model/records/class-emission.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeMemberVisibility, RustNativeMemberVisibilityRecords } from "../../../target-model/records/native-member-names.js";
import type { RustClassEnvironmentRecords, RustClassEnvironmentTypeEmission, RustClassMemberEnvironmentEmission } from "../../../target-model/records/class-environments.js";
import type { RustNamedClassEnvironment } from "../../../target-model/records/class-values.js";
import type { RustClassValueReadEmission, RustClassValueModuleEmission } from "../../../target-model/records/class-environments.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";
import type { RustClassValueCallable, RustClassValueForwarderEmission, RustClassValueForwarderRecords } from "../../../target-model/records/class-value-callables.js";
import type { RustClassImplementationContext, RustClassImplementationGenerics, RustClassConstructorViewEmission, RustClassImplementationRecords } from "../../../target-model/records/class-implementations.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

export interface RustClassEmissionProducer {
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
  const family = createRustRecordFamily<RustNativeClassEmission>({ id: "tsonic.rust.nativeClass", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    implementationRecords: Object.freeze({
      classImplementationContext: Object.freeze({ get: (declaration: Node, carrier: TargetTypeRef) => implementationContexts.get(declaration)?.get(closedMetadataKey(carrier)) }),
      classImplementationGenerics: Object.freeze({ get: (carrier: TargetTypeRef) => implementationGenerics.get(closedMetadataKey(carrier)) }),
      classConstructorViews: Object.freeze({ get: (declaration: Node, fileName: string) => constructorViews.get(declaration)?.get(fileName) }),
    }),
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
      if (declarations.has(subject.targetPath)) failTargetAnalysisInvariant("tsonic-rust", "A native class environment requires one exact source carrier identity.", subject.declaration);
      const selected = Object.freeze(value);
      environments.set(subject.declaration, selected);
      declarations.set(subject.targetPath, selected);
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
