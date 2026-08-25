import type { Node } from "@tsonic/tsts";
import type {
  RustCapture,
  RustDropObligation,
  RustDropState,
  RustExecutionContract,
  RustExecutionDomain,
  RustExecutionStorage,
  RustLoan,
  RustOwnershipOperation,
  RustPinState,
  RustPlaceRef,
  RustRegionRef,
  RustSourceValueContract,
  RustTraitProof,
  RustTraitRef,
  RustTypeRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import type { RustSourceFlowGraph } from "./control-flow.js";

export interface RustOwnershipAnalysis {
  readonly flow: RustSourceFlowGraph;
  readonly regions: readonly RustRegionRef[];
  readonly operations: readonly RustOwnershipOperation[];
  readonly loans: readonly RustLoan[];
  readonly drops: readonly RustDropState[];
  readonly dropObligations: readonly RustDropObligation[];
  readonly pins: readonly RustPinState[];
  sourceContractFor(node: Node): RustSourceValueContract | undefined;
  placeFor(node: Node): RustPlaceRef | undefined;
  operationFor(node: Node): RustOwnershipOperation | undefined;
  readDispositionFor(node: Node): RustValueReadDisposition | undefined;
  captureFor(node: Node): RustCapture | undefined;
  capturesFor(callable: Node): readonly RustCapture[];
  executionContractFor(callable: Node): RustExecutionContract | undefined;
  executionCarrierFor(node: Node): RustTypeRef | undefined;
  executionDomainFor(callable: Node): RustExecutionDomain;
  executionStorageFor(callable: Node): RustExecutionStorage;
  loansAt(node: Node): readonly RustLoan[];
  dropStateFor(node: Node): RustDropState | undefined;
  dropObligationsForRegion(region: RustRegionRef | string): readonly RustDropObligation[];
  pinStateFor(node: Node): RustPinState | undefined;
  traitProofFor(type: RustTypeRef, trait: RustTraitRef): RustTraitProof | undefined;
  ownedReadForCarrier(type: RustTypeRef): Extract<RustValueReadDisposition, { readonly kind: "copy" | "clone" }> | undefined;
  bindingRequiresMutable(node: Node): boolean;
}
