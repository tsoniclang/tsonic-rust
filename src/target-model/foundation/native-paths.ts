import type { RustFoundation } from "./model.js";

export const rustNativeRootFoundations: Readonly<Record<string, RustFoundation>> = Object.freeze({
  core: "core", std: "std", alloc: "alloc", js_abi: "std", tsonic_rust_js: "std",
  String: "alloc", Vec: "alloc", Box: "alloc", Rc: "alloc", Arc: "alloc",
});

export const rustRuntimeExportFoundations: Readonly<Record<string, RustFoundation>> = Object.freeze({
  async_runtime: "std", block_on: "std", run_tasks: "std", spawn: "std", TaskScope: "std",
  capture_error_stack: "std", record: "std", Record: "std", timer_queue: "std",
  control_flow: "core", dispatch: "core", field: "core", iteration: "core", operators: "core", optional_storage: "core", reachability: "core",
  finish_finally: "core", Completion: "core", Field: "core", FieldKey: "core", ReadField: "core", ReadFieldOf: "core",
  WriteField: "core", WriteFieldOf: "core", iter_cloned: "core", iter_copied: "core", native_shift_left: "core",
  native_shift_right: "core", native_unsigned_shift_right: "core", OptionalStorage: "core", keep_alive: "core",
  bigint: "alloc", callable: "alloc", conversions: "alloc", dispatch_queue: "alloc", empty_object: "alloc", error: "alloc",
  frame_callable: "alloc", frame_callable_family: "alloc", generator: "alloc", location: "alloc", module_cell: "alloc",
  numeric: "alloc", object_handle: "alloc", object_identity: "alloc", object_ref: "alloc", ordered_dispatch: "alloc",
  raw_memory: "alloc", record_field: "alloc", retained_error: "alloc", source_string: "alloc", ts_value: "alloc",
  RawPointer: "alloc", finish_resource: "alloc", BigInt: "alloc", Callable: "alloc", CallableImplementation: "alloc",
  EmptyObject: "alloc", ErrorField: "alloc", ErrorObject: "alloc", ErrorStack: "alloc", JsError: "alloc", JsErrorKind: "alloc",
  MutableJsError: "alloc", TsonicError: "alloc", TsonicResult: "alloc", WritableErrorObject: "alloc",
  SourceError: "alloc", WritableSourceError: "alloc",
  FrameCallable: "alloc", FrameCallableEntry: "alloc", FrameEntryCounter: "alloc", FrameCallableFamily: "alloc", FrameCallableFamilyEntry: "alloc",
  AsyncGenerator: "alloc", BorrowedAsyncGenerator: "alloc", BorrowedGenerator: "alloc", Generator: "alloc",
  GeneratorController: "alloc", GeneratorResume: "alloc", IteratorResult: "alloc", IteratorValue: "alloc", YieldPoint: "alloc",
  GeneratorNoReentry: "alloc", GeneratorMayReenter: "alloc",
  Location: "alloc", ModuleCell: "alloc", EmptyObjectState: "alloc", ObjectHandle: "alloc", ObjectHandleState: "alloc", ObjectState: "alloc",
  freeze_object: "alloc", object_is_frozen: "alloc", ObjectIdentity: "alloc", ObjectIdentityCarrier: "alloc", WeakObjectIdentity: "alloc",
  ObjectRef: "alloc", ObjectRefState: "alloc", RecordField: "alloc", RetainedError: "alloc", RetainedErrorObject: "alloc",
  WritableRetainedError: "alloc", WritableRetainedErrorObject: "alloc", source_string_greater_than: "alloc",
  source_string_greater_than_or_equal: "alloc", source_string_less_than: "alloc", source_string_less_than_or_equal: "alloc",
  ToSourceString: "alloc", clone_ts_value: "alloc", NativePayload: "alloc", TsValue: "alloc",
});
