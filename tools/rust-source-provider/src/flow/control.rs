use rustc_middle::mir::{TerminatorKind, UnwindAction, UnwindTerminateReason};

use super::model::{Branch, Control, Unwind};

pub fn control(kind: &TerminatorKind<'_>, reserve: &mut impl FnMut() -> Result<(), String>) -> Result<Control, String> {
    reserve()?;
    Ok(match kind {
        TerminatorKind::Goto { target } => Control::Goto { target: target.as_usize() },
        TerminatorKind::SwitchInt { targets, .. } => Control::Switch {
            branches: targets.iter().map(|(value, target)| {
                reserve()?;
                Ok(Branch { value: value.to_string(), target: target.as_usize() })
            }).collect::<Result<_, String>>()?,
            otherwise: targets.otherwise().as_usize(),
        },
        TerminatorKind::Return => Control::Return,
        TerminatorKind::Unreachable => Control::Unreachable,
        TerminatorKind::UnwindResume => Control::UnwindResume,
        TerminatorKind::UnwindTerminate(reason) => Control::UnwindTerminate { reason: unwind_reason(*reason) },
        TerminatorKind::Drop { target, unwind, drop, .. } => Control::Drop {
            target: target.as_usize(), unwind: unwind_control(*unwind, reserve)?, drop: drop.map(|target| target.as_usize()),
        },
        TerminatorKind::Call { target, unwind, .. } => Control::Call {
            target: target.map(|target| target.as_usize()), unwind: unwind_control(*unwind, reserve)?,
        },
        TerminatorKind::TailCall { .. } => Control::TailCall,
        TerminatorKind::Assert { target, unwind, .. } => Control::Assert {
            target: target.as_usize(), unwind: unwind_control(*unwind, reserve)?,
        },
        TerminatorKind::Yield { resume, drop, .. } => Control::Yield {
            resume: resume.as_usize(), drop: drop.map(|target| target.as_usize()),
        },
        TerminatorKind::CoroutineDrop => Control::CoroutineDrop,
        TerminatorKind::FalseEdge { real_target, imaginary_target } => Control::FalseEdge {
            real: real_target.as_usize(), imaginary: imaginary_target.as_usize(),
        },
        TerminatorKind::FalseUnwind { real_target, unwind } => Control::FalseUnwind {
            real: real_target.as_usize(), unwind: unwind_control(*unwind, reserve)?,
        },
        TerminatorKind::InlineAsm { targets, unwind, .. } => Control::InlineAssembly {
            targets: targets.iter().map(|target| { reserve()?; Ok(target.as_usize()) }).collect::<Result<_, String>>()?,
            unwind: unwind_control(*unwind, reserve)?,
        },
    })
}

fn unwind_control(value: UnwindAction, reserve: &mut impl FnMut() -> Result<(), String>) -> Result<Unwind, String> {
    reserve()?;
    Ok(match value {
        UnwindAction::Continue => Unwind::Continue,
        UnwindAction::Unreachable => Unwind::Unreachable,
        UnwindAction::Terminate(reason) => Unwind::Terminate { reason: unwind_reason(reason) },
        UnwindAction::Cleanup(target) => Unwind::Cleanup { target: target.as_usize() },
    })
}

fn unwind_reason(value: UnwindTerminateReason) -> &'static str {
    match value {
        UnwindTerminateReason::Abi => "abi",
        UnwindTerminateReason::InCleanup => "in-cleanup",
    }
}
