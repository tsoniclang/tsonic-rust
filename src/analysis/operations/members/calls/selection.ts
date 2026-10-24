import { selectRustNativeStringOperation } from "../../../../policy/operations/source-profiles/native-string.js";
import { selectRustNativePromiseContinuation } from "../../../../policy/operations/source-profiles/native-promises.js";
import { acceptRuntimeCallableCall, acceptStructuralRuntimeMethodCall, acceptRuntimeCallableCarrierCall } from "../../runtime-callables.js";

import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";

import { createRustJsCallRequest, selectedSoleArgumentNumberKind } from "./source-profile-request.js";
import { asNode, isProjectSourceDeclaration, resolveSelectedSourceProfileMember } from "../../../../policy/identities/selected-source.js";
import { rustJsErrorTargetType, rustUnitTargetType } from "../../../../target-model/types/index.js";
import { readRustSourceKeepAlive } from "../../../../source/extension/reachability.js";
import { mapSelectedJsSpecialCall } from "../../object-projections.js";
import { acceptProjectSourceCall } from "../../project-call-signatures.js";
import { selectRustArrayTypeTest } from "../type-tests.js";
import { isRustArrayTypeTestMember } from "../../source-profiles/js/type-tests.js";

import { acceptRustPolicy } from "../../../../policy/model/contracts.js";
import { acceptSelectedCall, checkedCallIsConstruction, instantiateSelectedCallTemplate, selectedCallReceiverValueCarrier, selectedProjectConstructor } from "./instantiation.js";

import { selectedImplicitSuperConstructorClass } from "./implicit-super.js";
import { substituteProviderOperationForm } from "../../../../policy/types/callables/provider-templates.js";

import { mapRustSourceMarkerCall } from "./deferred.js";
import { providerIdentityText, rejectSelectedOperation } from "../result.js";
import { providerOperationFact } from "../../../../policy/operations/members/provider-templates.js";
import { resolveRustTargetTypeRef } from "../../../source-evidence/types/resolution/source.js";
import { createRustPropertyProjectionSelector } from "../../../conversions/property-projections.js";

import { selectedCallArgumentCarriers, selectedCallArgumentNodes, selectedCallCalleeDeclaration } from "../operators.js";
import { selectedCallProviderDeclaration, selectedCallProviderDomain } from "../../../../policy/identities/selected-source.js";
import { selectedValueCarrier } from "../../selected-values.js";
import { selectJsSurfaceConstructorBySourceOwner } from "../../../../policy/operations/source-profiles/js/index.js";
import { selectJsSurfaceOperation } from "../../../../policy/operations/source-profiles/js/selection.js";
import { selectRustGeneratorSourceCall } from "../../../../policy/operations/source-profiles/generator-source-profile.js";
import { rustSourceErrorConstructorOperation, selectRustSourceErrorConstructor } from "../../../../policy/operations/source-profiles/error-source-profile.js";
import { selectRustProviderOperation } from "../../../../policy/operations/provider-selection.js";
import { selectRustProviderPointerResult } from "../../pointers/provider-result.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { sourceCallMarkerByIdentity } from "../../../../source/profiles/call-markers.js";
import { mapSelectedStringRegExpProtocolCall } from "../regexp-protocols.js";

import { selectRustPointerViewCall } from "../../pointer-views.js";
import { selectBorrowedCallbackParameters } from "./borrowed-callbacks.js";

import { rustClassConstructorInstance } from "../../../../target-model/types/carriers/class-constructors.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier } from "../../../../target-model/types/carriers/source-error.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection } from "../../../../policy/model/contracts.js";

import type { RustOperationsProviderOptions } from "../model.js";

export function resolveRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const pointerView = selectRustPointerViewCall(request, context, options);
  if (pointerView !== undefined) return pointerView;
  const keepAlive = readRustSourceKeepAlive(request.source.call, context);
  if (keepAlive !== undefined) {
    const value = resolveRustTargetTypeRef(keepAlive.valueExpression, context, options);
    if (keepAlive.call !== request.source.call || request.source.sourceArguments.length !== 1 ||
      request.source.sourceArguments[0]?.expression !== keepAlive.valueExpression || value === undefined) {
      return rejectSelectedOperation(request.source.call, context,
        "RUST_KEEP_ALIVE_EVIDENCE_CONFLICT", "Reachability requires the exact selected source value and its closed carrier.");
    }
    return acceptSelectedCall(request, {
      kind: "provider-operation", operationId: "tsonic.rust.keep-alive", operationKind: "method",
      target: { form: "call", path: "rt::keep_alive", argModes: ["ref"] },
      parameterCarriers: [value], resultCarrier: rustUnitTargetType(),
      isAsync: false, isFallible: false, errorBoundary: "none",
    }, [value], context, options, { sourceName: "keepalive" });
  }
  const providerEvidence = selectedCallProviderDeclaration(request, context);
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked call carries conflicting selected provider declaration identities.");
  }
  const selectedSourceMember = resolveSelectedSourceProfileMember(
    context,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  const selectedCalleeDeclaration = selectedCallCalleeDeclaration(request);
  const projectConstructorOwner = asNode(selectedCalleeDeclaration, context);
  const projectConstructorDefinition = options.projectTypes.definitionForDeclaration(projectConstructorOwner);
  if (selectedSourceMember !== undefined && checkedCallIsConstruction(request, context) &&
    projectConstructorDefinition?.kind === "class" && projectConstructorOwner !== undefined &&
    selectedProjectConstructor(projectConstructorDefinition, request, options)?.implicit === true) {
    return acceptProjectSourceCall(request, projectConstructorOwner, context, options);
  }
  const calleeSourceMember = selectedCalleeDeclaration !== undefined &&
    context.ast.is.IsIndexSignatureDeclaration(selectedCalleeDeclaration) ? undefined : resolveSelectedSourceProfileMember(
    context,
    selectedCalleeDeclaration,
    options.sourceProfiles,
  );
  if (selectedSourceMember === undefined && calleeSourceMember !== undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_SOURCE_DECLARATION_MISSING", "Checked source-profile call has callee evidence but no exact selected declaration evidence.");
  }
  if (selectedSourceMember !== undefined && calleeSourceMember !== undefined &&
    selectedSourceMember.profile !== calleeSourceMember.profile) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_SOURCE_EVIDENCE_CONFLICT", "Checked source-profile call carries declarations from conflicting source profiles.");
  }
  if (providerEvidence.kind === "selected" && selectedSourceMember === undefined) {
    const provider = providerEvidence.identity;
    const domain = selectedCallProviderDomain(request, provider, context);
    if (domain === undefined) return rejectSelectedOperation(request.source.call, context,
      "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "The selected provider invocation requires its exact retained callable signature and declaration owner.");
    if (domain === "value") return acceptRuntimeCallableCall(request, context, options) ?? rejectSelectedOperation(
      request.source.call, context, "RUST_SOURCE_CALLABLE_CARRIER_MISSING",
      "The selected provider-origin callable value requires its exact native invocation carrier.");
    const sourceMarker = provider.exportId === undefined
      ? undefined
      : sourceCallMarkerByIdentity.get(`${provider.moduleSpecifier}::${provider.exportId}`);
    if (sourceMarker !== undefined) {
      return mapRustSourceMarkerCall(request, provider, sourceMarker, context, options);
    }
    const operationKind = checkedCallIsConstruction(request, context) ? "constructor" : "method";
    const selection = selectRustProviderOperation(options.providerRows, provider, operationKind);
    if (selection.kind === "missing") {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(provider)}' as ${operationKind}.`);
    }
    if (selection.kind === "ambiguous") {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(provider)}' matches ${selection.rows.length} Rust operation rows.`);
    }
    const instantiation = instantiateSelectedCallTemplate(
      request,
      providerOperationFact(selection.row),
      context,
      options,
    );
    if (instantiation === undefined) {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN", `Selected call '${provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier}' does not prove one closed instantiation of its Rust provider type parameters.`);
    }
    const sourceResult = selectRustProviderPointerResult(request.source, context, options,
      selection.row.genericParameters ?? [], instantiation.substitutions.types);
    if (sourceResult?.kind === "invalid") {
      return rejectSelectedOperation(request.source.call, context,
        "RUST_PROVIDER_POINTER_RESULT_NOT_PROVEN", sourceResult.reason);
    }
    if (sourceResult !== undefined && !rustTargetTypeRefEquals(sourceResult.carrier, instantiation.template.resultCarrier)) {
      return rejectSelectedOperation(request.source.call, context,
        "RUST_PROVIDER_POINTER_RESULT_CONFLICT",
        "The selected provider result conflicts with the canonical source pointer carrier.",
        [{ message: `source=${JSON.stringify(sourceResult.carrier)}; provider=${JSON.stringify(instantiation.template.resultCarrier)}` }]);
    }
    if (selection.row.immediateCallback !== undefined) {
      return acceptRustPolicy({
        kind: "deferred-callback",
        callback: {
          shape: "direct",
          sourceArgumentIndex: selection.row.immediateCallback.sourceArgumentIndex,
          failure: {
            kind: "invocation",
            fallibleTarget: substituteProviderOperationForm(
              selection.row.immediateCallback.fallibleTarget,
              instantiation.substitutions,
            ),
          },
        },
        sourceName: provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier,
        providerDeclaration: provider,
        template: instantiation.template,
        parameterCarriers: instantiation.template.parameterCarriers ?? [],
      });
    }
    return acceptSelectedCall(request, instantiation.template, instantiation.template.parameterCarriers, context, options, {
      sourceName: provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier,
      providerDeclaration: provider,
    });
  }

  if (selectedSourceMember?.ownerName === "ErrorConstructor" &&
    selectedSourceMember.memberName === "captureStackTrace") {
    const carriers = selectedCallArgumentCarriers(request, context, options);
    const carrier = carriers[0];
    const definition = carrier === undefined ? undefined : options.projectTypes.definitionForCarrier(carrier);
    if (carriers.length !== 1 || carrier === undefined ||
      (!rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) && !isRustMutableJsErrorCarrier(carrier) && !isRustSourceErrorCarrier(carrier) &&
        (definition === undefined || options.projectTypes.inheritedExternalBaseForDefinition(definition)?.base.programError !== true))) {
      return rejectSelectedOperation(request.source.call, context, "RUST_ERROR_CAPTURE_CONTRACT",
        "Error.captureStackTrace requires one exact builtin Error or Error-derived project value.");
    }
    return acceptSelectedCall(request, {
      kind: "provider-operation", operationId: "tsonic.rust.error.capture-stack", operationKind: "method",
      target: { form: "call", path: "rt::capture_error_stack", argModes: ["ref"] },
      parameterCarriers: [carrier], resultCarrier: rustUnitTargetType(),
      isAsync: false, isFallible: false, errorBoundary: "none",
    }, [carrier], context, options, { sourceName: "captureStackTrace" });
  }
  const errorConstructor = selectRustSourceErrorConstructor(selectedSourceMember, checkedCallIsConstruction(request, context));
  if (errorConstructor !== undefined) {
    const subject = context.sourceStorage.subjectFor(request.source.call);
    if (subject.kind === "unresolved") return rejectSelectedOperation(request.source.call, context,
      "RUST_ERROR_STORAGE_NOT_PROVEN", subject.reason);
    const selectedStorage = options.sourceErrorCarrier(subject.subject);
    if (selectedStorage === undefined) return rejectSelectedOperation(request.source.call, context,
      "RUST_ERROR_STORAGE_NOT_PROVEN", "Rust Error construction requires its exact checked storage carrier.");
    const operation = rustSourceErrorConstructorOperation(errorConstructor, selectedCallArgumentCarriers(request, context, options),
      isRustWritableSourceErrorCarrier(selectedStorage));
    if (operation === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_ERROR_MESSAGE_REQUIRED",
        "Rust error construction requires an empty argument list or one checked optional string message.",
      );
    }
    return acceptSelectedCall(request, operation, operation.parameterCarriers, context, options, {
      sourceName: errorConstructor.sourceName,
    });
  }
  if (selectedSourceMember !== undefined) {
    if (isRustArrayTypeTestMember(selectedSourceMember)) {
      return selectRustArrayTypeTest(request, context, options);
    }
    const receiverCarrier = selectedCallReceiverValueCarrier(
      request,
      context,
      options,
    );
    if (selectedSourceMember.profile === "native" && selectedSourceMember.ownerName === "Promise") {
      const template = selectRustNativePromiseContinuation(selectedSourceMember.memberName, receiverCarrier,
        selectedCallArgumentCarriers(request, context, options));
      if (template === undefined) return rejectSelectedOperation(request.source.call, context, "RUST_NATIVE_PROMISE_CONTINUATION_CONTRACT",
        "A native Promise continuation requires a native Promise body receiver and catch(rejected) or then(fulfilled, rejected?) callbacks.");
      return acceptSelectedCall(request, template, template.parameterCarriers, context, options, { sourceName: selectedSourceMember.memberName });
    }
    if (selectedSourceMember.profile === "native" && selectedSourceMember.ownerName === "String") {
      const template = selectRustNativeStringOperation(selectedSourceMember.memberName, receiverCarrier, selectedCallArgumentNodes(request).length);
      if (template === undefined) return rejectSelectedOperation(request.source.call, context, "RUST_NATIVE_STRING_CONTRACT",
        "Native String operations require their exact selected declaration and native string operands.");
      return acceptSelectedCall(request, template, template.parameterCarriers, context, options, { sourceName: selectedSourceMember.memberName });
    }
    const generator = selectRustGeneratorSourceCall({
      ownerName: selectedSourceMember.ownerName,
      memberName: selectedSourceMember.memberName,
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      selectedParameterCount: request.source.sourceSelectedSignatureParameters.length,
      argumentCarriers: selectedCallArgumentCarriers(request, context, options),
    });
    if (generator.kind === "rejected") {
      return rejectSelectedOperation(
        request.source.call,
        context,
        generator.code,
        generator.message,
      );
    }
    if (generator.kind === "resolved") {
      return acceptSelectedCall(
        request,
        generator.template,
        generator.parameterCarriers,
        context,
        options,
        { sourceName: selectedSourceMember.memberName },
      );
    }
  }
  if (selectedSourceMember?.profile === "js") {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.source.call, context, "RUST_JS_SURFACE_REQUIRED", "The selected call belongs to the explicit JavaScript source profile, which is not active.");
    }
    if (checkedCallIsConstruction(request, context)) {
      const typeArgumentCarriers = (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
      const argumentCarriers = selectedCallArgumentCarriers(request, context, options);
      const selection = selectJsSurfaceConstructorBySourceOwner({
        sourceOwnerName: selectedSourceMember.ownerName,
        typeArgumentCarriers,
        argumentCarriers,
        soleArgumentNumberKind: selectedSoleArgumentNumberKind(request, context),
        propertyProjection: createRustPropertyProjectionSelector(request, context, options, argumentCarriers),
        carrierSupportsProjectIdentity: options.projectCarrierSupportsObjectIdentity,
      }, context.typeDefinitions);
      if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
        return rejectSelectedOperation(
          request.source.call,
          context,
          "RUST_SELECTED_OPERATION_UNSUPPORTED",
          `The selected JavaScript constructor '${selectedSourceMember.ownerName}' has no closed Rust operation row for the selected argument carriers.`,
          [{
            message: `arguments=${JSON.stringify(argumentCarriers)}; selectedTypeArguments=${JSON.stringify(typeArgumentCarriers)}`,
          }],
        );
      }
      return acceptSelectedCall(request, selection.fact, selection.parameterCarriers ?? [], context, options, {
        sourceName: selectedSourceMember.ownerName,
      });
    }
    const regexpProtocol = mapSelectedStringRegExpProtocolCall(
      request,
      selectedSourceMember.ownerName,
      selectedSourceMember.memberName,
      context,
      options,
    );
    if (regexpProtocol !== undefined) {
      return regexpProtocol;
    }
    const special = mapSelectedJsSpecialCall(
      request,
      selectedSourceMember.ownerName,
      selectedSourceMember.memberName,
      context,
      options,
    );
    if (special !== undefined) {
      return special;
    }
    const nativeRequest = createRustJsCallRequest(request, context, options);
    const selection = nativeRequest === undefined ? undefined : selectJsSurfaceOperation(nativeRequest, context.typeDefinitions);
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no closed Rust operation row for the selected receiver and argument carriers.`,
      );
    }
    if (selection.callback !== undefined) {
      const specialized = selectBorrowedCallbackParameters(request, selection, context, options);
      return specialized.fact.kind !== "provider-operation" || specialized.callback === undefined
        ? rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_CALLBACK_CARRIER_MISSING", `Selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no provider operation template.`)
        : acceptRustPolicy({
            kind: "deferred-callback",
            callback: specialized.callback,
            sourceName: selectedSourceMember.memberName,
            template: specialized.fact,
            parameterCarriers: specialized.parameterCarriers ?? [],
          });
    }
    return acceptSelectedCall(request, selection.fact, selection.parameterCarriers, context, options, {
      sourceName: selectedSourceMember.memberName,
    });
  }

  const sourceDeclaration = isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)
    ? asNode(request.sourceSelectedDeclaration, context)
    : undefined;
  const calleeDeclaration = isProjectSourceDeclaration(context, selectedCallCalleeDeclaration(request))
    ? asNode(selectedCallCalleeDeclaration(request), context)
    : undefined;
  const constructorCarrier = checkedCallIsConstruction(request, context)
    ? selectedValueCarrier(request.source.sourceCallee.expression, request.source.sourceCallee.type, context, options)
    : undefined;
  const constructorInstance = constructorCarrier === undefined ? undefined : rustClassConstructorInstance(constructorCarrier);
  const constructorDefinition = checkedCallIsConstruction(request, context)
    ? options.projectTypes.definitionForDeclaration(calleeDeclaration) ??
      (constructorInstance === undefined ? undefined : options.projectTypes.definitionForCarrier(constructorInstance))
    : undefined;
  const implicitConstructorClass = constructorDefinition?.kind === "class"
    ? constructorDefinition.declaration
    : sourceDeclaration === undefined
      ? selectedImplicitSuperConstructorClass(request, context, options)
      : undefined;
  if (implicitConstructorClass !== undefined) {
    return acceptProjectSourceCall(request, implicitConstructorClass, context, options);
  }
  if (sourceDeclaration === undefined && calleeDeclaration !== undefined) {
    const runtimeCallable = acceptRuntimeCallableCall(
      request,
      context,
      options,
    );
    if (runtimeCallable !== undefined) {
      return runtimeCallable;
    }
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PROJECT_DECLARATION_MISSING", "Checked project-source call has callee evidence but no exact selected callable declaration evidence.");
  }
  if (sourceDeclaration !== undefined) {
    const declarationKind = context.ast.kindName(sourceDeclaration);
    if (declarationKind === "KindConstructSignature" || declarationKind === "KindConstructorType") {
      const receiverCarrier = selectedValueCarrier(request.source.sourceCallee.expression, request.source.sourceCallee.type, context, options);
      const construction = receiverCarrier === undefined ? undefined : options.sourceTypes.structuralObjectForType(
        request.source.sourceCallee.type, receiverCarrier,
      )?.construction;
      if (construction === undefined || receiverCarrier === undefined || construction.declaration !== sourceDeclaration ||
        !checkedCallIsConstruction(request, context)) {
        return rejectSelectedOperation(request.source.call, context, "RUST_CONSTRUCTOR_VALUE_SIGNATURE_NOT_CLOSED",
          "A constructor value requires the exact selected construct declaration and its closed native signature.");
      }
      const result = acceptRuntimeCallableCarrierCall(request, construction.carrier, context, options,
        undefined, undefined, sourceDeclaration, undefined, receiverCarrier);
      if (result !== undefined) return result;
    }
    const reference = context.source.navigation.sourceReferenceFor(request.source.sourceCallee.expression);
    const binding = context.records.moduleBinding.get(reference?.declaration);
    const nativeCallable = binding?.storage === "native-callable" &&
      (binding.callableDeclaration === sourceDeclaration ||
        declarationKind === "KindFunctionType" || declarationKind === "KindCallSignature");
    const lexicalBinding = context.sourceCallables.directLexicalBinding(sourceDeclaration);
    const directLexical = lexicalBinding !== undefined && lexicalBinding === reference?.declaration ||
      reference !== undefined && context.sourceCallables.promiseCallAliasTarget(reference.declaration) === sourceDeclaration;
    const calleeKind = calleeDeclaration === undefined ? undefined : context.ast.kindName(calleeDeclaration);
    const storedCallable = calleeKind !== undefined && ["KindVariableDeclaration", "KindParameter",
      "KindPropertyDeclaration", "KindPropertySignature", "KindPropertyAssignment", "KindShorthandPropertyAssignment"].includes(calleeKind);
    const callableType = !nativeCallable && !directLexical && (storedCallable || declarationKind === "KindFunctionType" ||
      declarationKind === "KindCallSignature" || declarationKind === "KindArrowFunction" ||
      declarationKind === "KindFunctionExpression");
    const structuralMethod = callableType ? undefined : acceptStructuralRuntimeMethodCall(
      request,
      sourceDeclaration,
      context,
      options,
    );
    if (structuralMethod !== undefined) {
      return structuralMethod;
    }
    if (callableType) {
      return acceptRuntimeCallableCall(request, context, options) ?? rejectSelectedOperation(
        request.source.call, context, "RUST_SOURCE_CALLABLE_CARRIER_MISSING",
        "The exact selected callable value requires a closed native invocation carrier.",
      );
    }
    return acceptProjectSourceCall(request, nativeCallable ? binding.callableDeclaration : sourceDeclaration, context, options);
  }

  return rejectSelectedOperation(
    request.source.call,
    context,
    "RUST_SELECTED_CALL_EVIDENCE_MISSING",
    "Checked call has no exact provider, source-profile, or project-source selection that Rust can lower.",
  );
}
