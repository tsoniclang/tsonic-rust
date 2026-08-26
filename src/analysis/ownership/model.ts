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

export interface RustFixedMutableLoanBinding {
  readonly statement: Node;
  readonly declaration: Node;
  readonly rootDeclaration: Node;
  readonly index: number;
}

export interface RustFixedMutableLoanGroup {
  readonly bindings: readonly RustFixedMutableLoanBinding[];
}

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
  captureFor(callable: Node, node: Node): RustCapture | undefined;
  capturesFor(callable: Node): readonly RustCapture[];
  executionContractFor(callable: Node): RustExecutionContract | undefined;
  executionCarrierFor(node: Node): RustTypeRef | undefined;
  executionDomainFor(callable: Node): RustExecutionDomain;
  executionStorageFor(callable: Node): RustExecutionStorage;
  loansAt(node: Node): readonly RustLoan[];
  dropStatesFor(node: Node): readonly RustDropState[];
  dropObligationsForRegion(region: RustRegionRef | string): readonly RustDropObligation[];
  pinStatesFor(node: Node): readonly RustPinState[];
  traitProofFor(type: RustTypeRef, trait: RustTraitRef): RustTraitProof | undefined;
  ownedReadForCarrier(type: RustTypeRef): Extract<RustValueReadDisposition, { readonly kind: "copy" | "clone" }> | undefined;
  bindingRequiresMutable(node: Node): boolean;
  fixedMutableLoanGroupFor(statement: Node): RustFixedMutableLoanGroup | undefined;
}
