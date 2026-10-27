import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Initializer, sourceClassFieldIsTypeOnly, sourceObjectMemberDeclarations, sourceParameterIsProperty,
  type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustReachability } from "../../../target-model/records/reachability.js";
import type { RustClassEmissionProducer } from "../../program/records/class-emission.js";
import type { RustNativeClassField, RustNativeClassEmission } from "../../../target-model/records/class-emission.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import { rustProjectMemberIsPrivate } from "../../project-types/member-privacy.js";
import { validatedRustCapturedFieldStorageFact } from "../../storage/receiver-captures.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { rustLocationTargetType } from "../../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../../policy/constraints/native-traits.js";
import { createRustNativeConstructorContract, createRustSourceCallableContract } from "../../callables/calls/source-callable-abi.js";

export function analyzeRustClassEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly source: TargetSourceProgram;
  readonly reachability: RustReachability;
  readonly producer: RustClassEmissionProducer;
}): readonly TargetDiagnostic[] {
  const { program, reachability } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const reject = (node: Node, message: string): void => {
    issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: ["target.capability=rust.backend.class"] });
  };
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    const declaration = definition.declaration;
    const environment = program.classValues.forDeclaration(declaration)?.environment;
    if (environment !== undefined) {
      const component = program.sourcePackageComponents.componentForFile(definition.fileName);
      const publicEnvironment = component !== undefined && (component.publishesImplementationAbi ||
        program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId)
          .includes(rustSourceItemIdentity(definition.fileName, environment.typeName)));
      const generics = program.records.projectGenerics.get(definition, environment.genericParameterIndexes);
      if (generics === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class environment requires its exact generic context.", declaration);
      const representation = program.objectRepresentations.representationFor(definition);
      const polymorphic = program.projectTypes.isPolymorphic(definition);
      input.producer.environment(definition, { definition, environment,
        module: ast.parent(declaration) === ast.getSourceFile(declaration), visibility: publicEnvironment ? "public" : "crate",
        manualClone: environment.storage === "value" && (generics.parameters.length + generics.optionalStorage.length > 0 || !environment.copy),
        captures: Object.freeze(environment.captures.map(capture => Object.freeze({ name: capture.fieldName,
          carrier: capture.storage === "location" ? rustLocationTargetType(capture.carrier) : capture.carrier,
          copy: capture.storage === "value" && isRustCopyCarrier(capture.carrier) }))),
        fields: Object.freeze(environment.staticFields.map(field => {
          const visibility = rustProjectMemberIsPrivate(ast, field.declaration) ? "private" as const : publicEnvironment ? "public" as const : "crate" as const;
          const initializer = Node_Initializer(ast, field.declaration);
          if (initializer === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class environment field requires its exact native initializer.", field.declaration);
          return Object.freeze({ field, visibility, initializer,
            deadCode: visibility === "public" || reachability.externallyReachable.has(declaration) || reachability.readAuthoredFields.has(field.declaration)
              ? undefined : "authored-unread-field" as const });
        })),
      });
      for (const member of sourceObjectMemberDeclarations(ast, declaration)) {
        if (member === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class environment requires dense checked members.", declaration);
        const isStatic = ast.hasModifierKind(member, "static");
        if (environment.consumers.includes(member)) {
          input.producer.callGenericArguments(member, generics.parameters.filter(selected => selected.parameter.kind !== "lifetime").length + generics.optionalStorage.length);
          if (isStatic) input.producer.staticEnvironment(member, environment);
        }
        if (isStatic ? !environment.consumers.includes(member) : !environment.instancesUseEnvironment && ast.kindName(member) !== "KindConstructor") continue;
        input.producer.memberEnvironment(member, { environment,
          source: isStatic || ast.kindName(member) === "KindConstructor" ? "parameter" : polymorphic || representation?.kind === "value" ? "field" : "state",
          borrowed: isStatic || !polymorphic && representation?.kind !== "value" });
      }
    }
    if (program.records.classDeclaration.get(declaration) === undefined) continue;
    const name = program.names.nameForDeclaration(declaration);
    if (name === undefined || !isValidRustIdentifier(name)) {
      reject(declaration, "Class names must be valid Rust identifiers.");
      continue;
    }
    const representation = program.objectRepresentations.representationFor(definition);
    const layout = program.projectTypes.objectLayoutForDefinition(definition);
    if (representation === undefined || layout?.kind !== "class") failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its exact native representation and object layout.", declaration);
    const polymorphic = program.projectTypes.isPolymorphic(definition);
    if (!polymorphic && (ast.extendsHeritageElements(declaration).length !== 0 || ast.implementsHeritageElements(declaration).length !== 0)) {
      reject(declaration, "Class inheritance and interface implementation are not supported by the Rust target.");
      continue;
    }
    const component = program.sourcePackageComponents.componentForFile(definition.fileName);
    const publiclyReachable = program.projectTypes.programErrorVariant(definition) !== undefined || component !== undefined &&
      (component.publishesImplementationAbi || program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId)
        .includes(rustSourceItemIdentity(definition.fileName, definition.targetPath)));
    const fields: RustNativeClassField[] = [];
    const methods: Node[] = [];
    const accessors: RustNativeClassEmission["accessors"][number][] = [];
    const constructors: Node[] = [];
    for (const member of sourceObjectMemberDeclarations(ast, declaration)) {
      if (member === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its dense source member inventory.", declaration);
      if (sourceClassFieldIsTypeOnly(ast, member) || ast.is.IsClassStaticBlockDeclaration(member)) continue;
      if (ast.is.IsPropertyDeclaration(member) || sourceParameterIsProperty(ast, member)) {
        if (ast.hasModifierKind(member, "static") || program.objectRepresentations.aliasFor(member) !== undefined) continue;
        const field = layout.fields.find(field => field.declaration === member);
        const targetName = program.projectTypes.fieldStorageName(definition, member);
        const carrier = program.callableValues.projectFieldStorage.get(member) ?? program.records.runtimeCarrier.get(member)?.carrier;
        if (field === undefined || targetName === undefined || !isValidRustIdentifier(targetName) || carrier === undefined)
          failTargetAnalysisInvariant("tsonic-rust", "An admitted class field requires its exact native slot, identifier and carrier.", member);
        const visibility = rustProjectMemberIsPrivate(ast, member) ? "private" as const : publiclyReachable ? "public" as const : "crate" as const;
        fields.push(Object.freeze({ ...field, targetName, carrier,
          initializer: sourceParameterIsProperty(ast, member) ? ast.name(member) : Node_Initializer(ast, member), visibility,
          deadCode: visibility === "public" || reachability.externallyReachable.has(declaration) || reachability.readAuthoredFields.has(member)
            ? undefined : "authored-unread-field", frameBinding: program.callableValues.frames.bindingFor(member),
          capturedStorage: validatedRustCapturedFieldStorageFact(member, program)?.storage }));
      } else if (ast.kindName(member) === "KindConstructor") constructors.push(member);
      else if (ast.is.IsMethodDeclaration(member)) {
        if (ast.body(member) !== undefined && program.projectTypes.memberSlotName(member, "static") === undefined) methods.push(member);
      } else if (ast.is.IsGetAccessorDeclaration(member) || ast.is.IsSetAccessorDeclaration(member)) {
        const role = ast.is.IsGetAccessorDeclaration(member) ? "read" as const : "write" as const;
        const targetName = program.projectTypes.memberSlotName(member, role);
        if (targetName === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted accessor requires its exact native slot.", member);
        accessors.push(Object.freeze({ declaration: member, role, name: targetName }));
      } else reject(member, "This class member is not supported by the Rust target.");
    }
    const implemented = constructors.filter(constructor => ast.body(constructor) !== undefined);
    if (implemented.length > 1 || constructors.length !== 0 && implemented.length !== 1)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires one exact implemented constructor.", declaration);
    const constructor = implemented[0];
    const classCarrier = program.projectTypes.openCarrier(definition);
    const constructorContract = constructor === undefined ? (() => {
      const signatures = program.projectTypes.constructorsForDefinition(definition);
      const signature = signatures.length === 1 ? signatures[0] : undefined;
      const parameters = signature === undefined ? undefined : program.records.implicitConstructorParameters.get(signature, classCarrier);
      if (signature === undefined || parameters === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted implicit constructor requires its actual selected native signature and parameter ABI.", declaration);
      return createRustNativeConstructorContract({ parameters, sourceDeclaration: signature.declaration, returnType: classCarrier });
    })() : createRustSourceCallableContract({ source: input.source, records: program.records,
      sourceLifetimes: program.sourceLifetimes }, constructor, classCarrier);
    if (constructorContract === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted class constructor requires its exact checked native callable contract.", constructor);
    const requirements = program.declarationGenericRequirements.contractFor(declaration);
    if (requirements === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class requires its finalized native generic contract.", declaration);
    const typeIdentities = new Set(definition.genericParameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []));
    const lifetimes = new Set(definition.genericParameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
    const hasStorageParameters = requirements.optionalStorage.some(entry => {
      if (entry.captured) return false;
      const references = rustTargetGenericReferences(entry.carrier);
      return references.typeIdentities.every(identity => typeIdentities.has(identity)) &&
        references.lifetimes.every(lifetime => lifetime.kind === "bound" || lifetimes.has(rustLifetimeKey(lifetime)));
    });
    input.producer.classDeclaration(declaration, { kind: polymorphic ? "polymorphic" : "ordinary", name, definition,
      abstract: ast.hasModifierKind(declaration, "abstract"),
      constructorEnvironment: environment?.instancesUseEnvironment || environment?.initializationUsesEnvironment ? environment : undefined,
      carrier: classCarrier, representation, publiclyReachable,
      visibility: ast.hasModifierKind(declaration, "export") || publiclyReachable ? "public" : "crate",
      explicitWrapperTraits: representation.kind !== "value" && (typeIdentities.size !== 0 || hasStorageParameters),
      fields: Object.freeze(fields), constructor, constructorContracts: Object.freeze([constructorContract]), methods: Object.freeze(methods), accessors: Object.freeze(accessors),
      constructorVisibility: constructor === undefined || !ast.hasModifierKind(constructor, "private") && !ast.hasModifierKind(constructor, "protected") ? "public" : "private",
      constructorDeadCode: publiclyReachable ? undefined : constructor === undefined
        ? reachability.invokedProjectConstructors.has(declaration) ? undefined : "generated-retained-constructor"
        : reachability.suppressedDeclarations.has(constructor) ? "authored-declaration" : undefined,
      environment,
      frame: program.callableValues.frames.definitionForOwner(declaration) });
  }
  return Object.freeze(issues);
}
