import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, sourceParameterIsProperty } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustNativeGuardResultFactKey, rustNativeUnreachableFactKey } from "../facts/native-control-flow.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustOptionCarrier, isRustAbsenceCarrier } from "../../target-model/types/index.js";
import { rustInheritedProjectConstructor, type RustProjectConstructorSignature, type RustProjectTypeDefinition,
  type RustProjectTypePolicy } from "./type-policy.js";
import { rustProjectObjectLayout } from "./object-layout.js";
import type { RustReceiverFieldAliasQueries } from "./receiver-field-aliases.js";
import type { RustReceiverFieldCaptureQueries } from "./receiver-captures.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { analyzeRustConstructionReadiness, type RustConstructionPointQueries } from "./construction-readiness.js";
import { selectRustExternalInitialization, type RustExternalInitialization } from "./external-initialization.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

export interface RustConstructionField {
  readonly declaration: Node;
  readonly owner: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
  readonly initializer?: Node;
  readonly absenceDefault: boolean;
  readonly externallyInitialized: boolean;
}

export interface RustConstructionLayer {
  readonly definition: RustProjectTypeDefinition;
  readonly signature: RustProjectConstructorSignature;
  readonly constructor: Node | undefined;
  readonly baseCall?: Node;
  readonly fields: readonly RustConstructionField[];
  readonly statements: readonly Node[];
}

export interface RustConstructionIssue {
  readonly node: Node;
  readonly reason: string;
}

export interface RustProjectConstructionPlan extends RustConstructionPointQueries {
  readonly definition: RustProjectTypeDefinition;
  readonly layers: readonly RustConstructionLayer[];
  readonly fields: readonly RustConstructionField[];
  readonly issues: readonly RustConstructionIssue[];
  readonly publishesReceiver: boolean;
  readonly mutatesPublishedFields: boolean;
}

export interface RustProjectConstructionQueries {
  forDefinition(definition: RustProjectTypeDefinition): RustProjectConstructionPlan | undefined;
  externalInitializationForCall(call: Node): RustExternalInitialization | undefined;
  ownsExternalArgument(argument: Node): boolean;
}

export interface RustConstructionAnalysisInput {
  readonly ast: AstReader;
  readonly facts: RustPlanQueries;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly projectTypes: RustProjectTypePolicy;
  readonly receiverFieldAliases: RustReceiverFieldAliasQueries;
  readonly receiverCaptures: RustReceiverFieldCaptureQueries;
  mayThrow(node: Node): boolean;
}

export function analyzeRustProjectConstructions(input: RustConstructionAnalysisInput): RustProjectConstructionQueries {
  const plans = new Map<RustProjectTypeDefinition, RustProjectConstructionPlan>();
  const externalInitializations = new WeakMap<Node, RustExternalInitialization>();
  const ownedExternalArguments = new WeakSet<Node>();
  for (const definition of input.projectTypes.definitions) {
    if (definition.kind !== "class") continue;
    const lineage = input.projectTypes.classLineage(definition);
    const layers: RustConstructionLayer[] = [];
    const issues: RustConstructionIssue[] = [];
    if (lineage === undefined || lineage.length > 256) {
      issues.push(Object.freeze({ node: definition.declaration,
        reason: "Native construction requires one bounded exact source class lineage." }));
    } else {
      let selected = input.projectTypes.constructorsForDefinition(definition)[0];
      if (selected === undefined) issues.push(Object.freeze({ node: definition.declaration,
        reason: "Native construction has no exact effective constructor signature." }));
      for (let index = lineage.length - 1; index >= 0 && selected !== undefined; index -= 1) {
        const owner = lineage[index]!;
        const constructor = input.ast.members(owner.declaration).find(member => member !== undefined &&
          input.ast.kindName(member) === "KindConstructor" && input.ast.body(member) !== undefined);
        const body = constructor === undefined ? undefined : input.ast.body(constructor);
        const rawStatements = body === undefined ? [] : input.ast.statements(body);
        if (rawStatements.some(statement => statement === undefined)) {
          issues.push(Object.freeze({ node: owner.declaration, reason: "Constructor contains an undefined statement slot." }));
          break;
        }
        const base = input.projectTypes.heritageForDefinition(owner).find(edge => edge.kind === "extends" && edge.target.kind === "class");
        const external = input.projectTypes.externalBaseForDefinition(owner);
        const first = rawStatements[0];
        const call = first === undefined || input.ast.kindName(first) !== "KindExpressionStatement"
          ? undefined : Node_Expression(input.ast, first);
        const callee = call === undefined ? undefined : Node_Expression(input.ast, call);
        const baseCall = call !== undefined && input.ast.is.IsCallExpression(call) &&
          callee !== undefined && input.ast.kindName(callee) === "KindSuperKeyword" ? call : undefined;
        if (external !== undefined && baseCall !== undefined) {
          const initialization = selectRustExternalInitialization(external, baseCall, input.ast, input.facts, input.typeDefinitions);
          if (initialization === undefined) issues.push(Object.freeze({ node: baseCall,
            reason: "External field initialization has no exact selected native input contract." }));
          else {
            externalInitializations.set(baseCall, initialization);
            const argument = input.ast.arguments(baseCall)[0];
            if (argument !== undefined && (initialization.kind === "value" || initialization.kind === "optional"))
              ownedExternalArguments.add(argument);
          }
        }
        const fields: RustConstructionField[] = [];
        for (const field of external?.fields ?? []) fields.push(Object.freeze({
          declaration: field.declaration, owner, carrier: field.carrier,
          absenceDefault: false, externallyInitialized: true,
        }));
        for (const field of rustProjectObjectLayout(owner.declaration, input.ast)?.fields ?? []) {
          if (input.ast.hasModifierKind(field.declaration, "abstract") ||
            input.receiverFieldAliases.aliasFor(field.declaration) !== undefined) continue;
          const carrier = input.facts.getRuntimeCarrierFact(field.declaration)?.carrier;
          const initializer = sourceParameterIsProperty(input.ast, field.declaration)
            ? input.ast.name(field.declaration) : Node_Initializer(input.ast, field.declaration);
          if (carrier === undefined) {
            issues.push(Object.freeze({ node: field.declaration, reason: "Physical constructor field has no exact finalized carrier." }));
            continue;
          }
          fields.push(Object.freeze({ declaration: field.declaration, owner, carrier, externallyInitialized: false,
            absenceDefault: initializer === undefined && (isRustOptionCarrier(carrier) || isRustAbsenceCarrier(carrier)),
            ...(initializer === undefined ? {} : { initializer }) }));
        }
        layers.unshift(Object.freeze({ definition: owner, signature: selected, constructor,
          ...(baseCall === undefined ? {} : { baseCall }),
          fields: Object.freeze(fields), statements: Object.freeze(rawStatements.slice(baseCall === undefined ? 0 : 1) as Node[]) }));
        if (constructor !== undefined && (base !== undefined || external !== undefined) && baseCall === undefined)
          issues.push(Object.freeze({ node: constructor,
            reason: "Native inheritance requires its exact checked super(...) constructor call as the first statement." }));
        if (base !== undefined) {
          const inherited = constructor === undefined ? rustInheritedProjectConstructor(input.projectTypes, owner, selected) : undefined;
          const fact = baseCall === undefined ? undefined : input.facts.getFact(baseCall, rustTargetOperationFactKey);
          selected = inherited?.base === base.target ? inherited.constructor
            : fact?.kind === "source-call" && fact.target.form === "constructor"
              ? input.projectTypes.constructorForTargetName(base.target, fact.target.name) : undefined;
          if (selected === undefined) issues.push(Object.freeze({ node: constructor ?? owner.declaration,
            reason: "Inherited construction has no exact selected base constructor contract." }));
        }
      }
    }
    const physicalDeclaration = input.receiverCaptures.storageDeclaration;
    const logicalFields = layers.flatMap(layer => layer.fields);
    const fields = Object.freeze(logicalFields.filter(field => physicalDeclaration(field.declaration) === field.declaration));
    const physicalFields = new Map(fields.map(field => [field.declaration, field]));
    const receiver = input.projectTypes.openCarrier(definition);
    for (const field of logicalFields) {
      const declaration = physicalDeclaration(field.declaration);
      if (declaration === field.declaration) continue;
      const physical = physicalFields.get(declaration);
      const actualCarrier = input.projectTypes.instantiateMemberCarrier(field.declaration, receiver, field.carrier);
      const physicalCarrier = physical === undefined ? undefined
        : input.projectTypes.instantiateMemberCarrier(physical.declaration, receiver, physical.carrier);
      if (physicalCarrier === undefined || !rustTargetTypeRefEquals(actualCarrier, physicalCarrier))
        issues.push(Object.freeze({ node: field.declaration,
          reason: "A retained override family requires one exact native physical payload carrier." }));
    }
    const readiness = analyzeRustConstructionReadiness({ ast: input.ast, definition,
      layers: layers.map(layer => ({ ...layer, fields: layer.fields.map(field => ({ ...field,
        declaration: physicalDeclaration(field.declaration) })) })), fields,
      selectedField(node) {
        const fact = input.facts.getFact(node, rustTargetOperationFactKey);
        return fact?.kind === "source-field" && fact.storage === "project-object" &&
          fact.valueSemantics.kind === "stored" && fact.declaration !== undefined
          ? { declaration: physicalDeclaration(fact.declaration), accessMode: fact.accessMode } : undefined;
      },
      guardResult: node => input.facts.getFact(node, rustNativeGuardResultFactKey),
      unreachable: node => input.facts.getFact(node, rustNativeUnreachableFactKey) === true,
      mayThrow: input.mayThrow,
    });
    plans.set(definition, Object.freeze({ definition, layers: Object.freeze(layers), fields,
      issues: Object.freeze([...issues, ...readiness.issues]), pointFor: readiness.pointFor,
      expressions: readiness.expressions,
      completesNormally: readiness.completesNormally, layerCompletes: readiness.layerCompletes,
      layerHasEarlyReturn: readiness.layerHasEarlyReturn,
      mutatesUnpublishedField: readiness.mutatesUnpublishedField,
      expressionsWithin: readiness.expressionsWithin, publishesReceiver: readiness.publishesReceiver,
      mutatesPublishedFields: readiness.mutatesPublishedFields }));
  }
  return Object.freeze({ forDefinition: (definition: RustProjectTypeDefinition) => plans.get(definition),
    externalInitializationForCall: (call: Node) => externalInitializations.get(call),
    ownsExternalArgument: (argument: Node) => ownedExternalArguments.has(argument) });
}
