import { createRustProjectTypePolicy } from "./resolution.js";
import type { RustProjectTypePolicy, RustProjectTypePolicyRegistry } from "../../../policy/types/project-types.js";

export function createRustProjectTypePolicyRegistry(): RustProjectTypePolicyRegistry {
  let current: RustProjectTypePolicy | undefined;
  const requireCurrent = (): RustProjectTypePolicy => {
    if (current === undefined) {
      throw new Error("Rust project type policy was read before source analysis initialized it.");
    }
    return current;
  };
  const registry: RustProjectTypePolicyRegistry = {
    get definitions() {
      return requireCurrent().definitions;
    },
    get issues() {
      return requireCurrent().issues;
    },
    initialize(host) {
      if (current !== undefined) {
        throw new Error("Rust project type policy can be initialized only once.");
      }
      current = createRustProjectTypePolicy(host);
      return current;
    },
    isInitialized() {
      return current !== undefined;
    },
    seal() {
      return requireCurrent();
    },
    definitionForDeclaration(declaration) {
      return requireCurrent().definitionForDeclaration(declaration);
    },
    definitionContainingDeclaration(declaration) {
      return requireCurrent().definitionContainingDeclaration(declaration);
    },
    definitionForCarrier(carrier) {
      return requireCurrent().definitionForCarrier(carrier);
    },
    openCarrier(definition) {
      return requireCurrent().openCarrier(definition);
    },
    heritageForDefinition(definition) {
      return requireCurrent().heritageForDefinition(definition);
    },
    externalBaseForDefinition(definition) {
      return requireCurrent().externalBaseForDefinition(definition);
    },
    externalFieldForReceiver(declaration, receiver) {
      return requireCurrent().externalFieldForReceiver(declaration, receiver);
    },
    get programErrorDefinitions() {
      return requireCurrent().programErrorDefinitions;
    },
    programErrorVariant(definition) {
      return requireCurrent().programErrorVariant(definition);
    },
    directSupertypes(carrier) {
      return requireCurrent().directSupertypes(carrier);
    },
    commonSupertype(carriers) {
      return requireCurrent().commonSupertype(carriers);
    },
    relationship(source, target) {
      return requireCurrent().relationship(source, target);
    },
    instantiateMemberCarrier(member, receiver, declaredCarrier) {
      return requireCurrent().instantiateMemberCarrier(member, receiver, declaredCarrier);
    },
    isPolymorphic(definition) {
      return requireCurrent().isPolymorphic(definition);
    },
    classLineage(definition) {
      return requireCurrent().classLineage(definition);
    },
    interfacesForClass(definition) {
      return requireCurrent().interfacesForClass(definition);
    },
    concreteClassesFor(definition) {
      return requireCurrent().concreteClassesFor(definition);
    },
    downcastRoute(source, targetCarrier) {
      return requireCurrent().downcastRoute(source, targetCarrier);
    },
    constructorsForDefinition(definition) {
      return requireCurrent().constructorsForDefinition(definition);
    },
    constructorForSignature(definition, signature) {
      return requireCurrent().constructorForSignature(definition, signature);
    },
    constructorForTargetName(definition, targetName) {
      return requireCurrent().constructorForTargetName(definition, targetName);
    },
    fieldStorageName(definition, declaration) {
      return requireCurrent().fieldStorageName(definition, declaration);
    },
    baseStateFieldName(definition) {
      return requireCurrent().baseStateFieldName(definition);
    },
    stateMarkerFieldName(definition) {
      return requireCurrent().stateMarkerFieldName(definition);
    },
    memberSlotName(declaration, role) {
      return requireCurrent().memberSlotName(declaration, role);
    },
    memberImplementation(concreteClass, contractMember) {
      return requireCurrent().memberImplementation(concreteClass, contractMember);
    },
  };
  return Object.freeze(registry);
}
