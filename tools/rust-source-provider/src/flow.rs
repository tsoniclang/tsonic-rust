use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use rustc_hir::{Node, PatKind};
use rustc_middle::mir::{BindingForm, Body, LocalInfo, Location, SourceInfo};
use rustc_middle::mir::visit::{VisitPlacesWith, Visitor};
use rustc_middle::ty::TyCtxt;
use rustc_middle::util::Providers;
use rustc_session::Session;
use rustc_span::{Span, def_id::LocalDefId};

use crate::evidence::{definition_id, node_id, source_span};

mod control;
mod uses;
pub mod model;

use model::{Block, BodyFlow, Local, Origin, Step, Terminal};

type BuildMir = for<'tcx> fn(TyCtxt<'tcx>, LocalDefId) -> Body<'tcx>;
static ORIGINAL: OnceLock<BuildMir> = OnceLock::new();
static CAPTURE: OnceLock<Mutex<Capture>> = OnceLock::new();

struct Capture {
    remaining: usize,
    rows: usize,
    bodies: HashMap<LocalDefId, BodyFlow>,
    spans: HashSet<Span>,
    error: Option<String>,
}

pub struct CapturedFlow {
    pub bodies: Vec<BodyFlow>,
    pub spans: HashSet<Span>,
    pub rows: usize,
}

pub fn initialize(maximum_rows: usize) -> Result<(), String> {
    CAPTURE.set(Mutex::new(Capture { remaining: maximum_rows, rows: 0, bodies: HashMap::new(), spans: HashSet::new(), error: None }))
        .map_err(|_| "Native flow capture cannot reuse a compiler process.".to_owned())
}

pub fn provide(_: &Session, providers: &mut Providers) {
    if ORIGINAL.set(providers.hooks.build_mir_inner_impl).is_err() {
        panic!("Native flow capture cannot replace its compiler hook twice.");
    }
    providers.hooks.build_mir_inner_impl = observe;
}

fn observe<'tcx>(context: TyCtxt<'tcx>, owner: LocalDefId) -> Body<'tcx> {
    let body = ORIGINAL.get().expect("Native flow compiler hook is absent.")(context, owner);
    let mut capture = CAPTURE.get().expect("Native flow capture is absent.").lock().expect("Native flow capture failed.");
    if capture.error.is_none() {
        if capture.bodies.contains_key(&owner) {
            capture.error = Some("Native flow body was constructed more than once.".to_owned());
        } else {
            match capture.body(context, owner, &body) {
                Ok(flow) => { capture.bodies.insert(owner, flow); }
                Err(error) => capture.error = Some(error),
            }
        }
    }
    body
}

pub fn take() -> Result<CapturedFlow, String> {
    let mut capture = CAPTURE.get().ok_or("Native flow capture is absent.")?.lock().map_err(|_| "Native flow capture failed.")?;
    if let Some(error) = capture.error.take() { return Err(error); }
    let mut bodies = std::mem::take(&mut capture.bodies).into_iter().collect::<Vec<_>>();
    bodies.sort_by_key(|(owner, _)| owner.local_def_index.as_u32());
    Ok(CapturedFlow { bodies: bodies.into_iter().map(|(_, body)| body).collect(),
        spans: std::mem::take(&mut capture.spans), rows: std::mem::take(&mut capture.rows) })
}

impl Capture {
    fn reserve(&mut self) -> Result<(), String> {
        self.remaining = self.remaining.checked_sub(1).ok_or("Native flow evidence exceeds the row limit.")?;
        self.rows += 1;
        Ok(())
    }

    fn origin(&mut self, context: TyCtxt<'_>, body: &Body<'_>, source: SourceInfo) -> Result<Origin, String> {
        self.reserve()?;
        self.spans.insert(source.span);
        let node = body.source_scopes[source.scope].local_data.as_ref().unwrap_crate_local().lint_root;
        Ok(Origin { node: node_id(node), source: source_span(context, source.span) })
    }

    fn body(&mut self, context: TyCtxt<'_>, owner: LocalDefId, body: &Body<'_>) -> Result<BodyFlow, String> {
        self.reserve()?;
        let locals = body.local_decls.iter().map(|local| {
            self.reserve()?;
            let origin = self.origin(context, body, local.source_info)?;
            let root = body.source_scopes[local.source_info.scope].local_data.as_ref().unwrap_crate_local().lint_root;
            let pattern = match context.hir_node(root) {
                Node::Pat(pattern) => Some(pattern),
                Node::Param(parameter) => Some(parameter.pat),
                _ => None,
            };
            let binding = match (local.local_info(), pattern.map(|pattern| &pattern.kind)) {
                (LocalInfo::User(_), Some(PatKind::Binding(_, binding, _, _))) => Some(node_id(*binding)),
                _ => None,
            };
            let guard_target = match local.local_info() {
                LocalInfo::User(BindingForm::RefForGuard(target)) => Some(target.as_usize()),
                _ => None,
            };
            Ok(Local { origin, binding, guard_target })
        }).collect::<Result<_, String>>()?;
        let mut blocks = Vec::new();
        for (block, data) in body.basic_blocks.iter_enumerated() {
            self.reserve()?;
            let mut statements = Vec::new();
            for statement_index in 0..data.statements.len() {
                statements.push(self.step(context, body, Location { block, statement_index })?);
            }
            let terminator = data.terminator();
            let step = self.step(context, body, body.terminator_loc(block))?;
            let control = control::control(&terminator.kind, &mut || self.reserve())?;
            blocks.push(Block { cleanup: data.is_cleanup, statements, terminator: Terminal { step, control } });
        }
        Ok(BodyFlow { owner: definition_id(owner.to_def_id()), argument_count: body.arg_count, locals, blocks })
    }

    fn step(&mut self, context: TyCtxt<'_>, body: &Body<'_>, location: Location) -> Result<Step, String> {
        self.reserve()?;
        let origin = self.origin(context, body, *body.source_info(location))?;
        let mut accesses = Vec::new();
        let mut failure = None;
        VisitPlacesWith(|place, usage| {
            if failure.is_some() { return; }
            match uses::access(place, usage, &mut || self.reserve()) {
                Ok(access) => accesses.push(access), Err(error) => failure = Some(error),
            }
        }).visit_location(body, location);
        if let Some(error) = failure { return Err(error); }
        Ok(Step { origin, accesses })
    }
}
