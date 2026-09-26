use rustc_ast::token::{Delimiter, IdentIsRaw, TokenKind};
use rustc_ast::tokenstream::{Spacing, TokenStream, TokenTree};
use rustc_ast_pretty::pprust;
use rustc_session::parse::ParseSess;
use rustc_span::{FileName, create_session_globals_then, edition::Edition};
use serde::Serialize;

use crate::request::{Budget, Limits};
use crate::source::{SourceRange, source_range};

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TokenKindData {
    Identifier { text: String, raw: bool },
    Literal { text: String },
    Punctuation { text: String, joint: bool },
    Group { delimiter: &'static str, tokens: Vec<Token> },
}

#[derive(Serialize)]
pub struct Token {
    #[serde(flatten)]
    data: TokenKindData,
    source: SourceRange,
}

pub fn read_tokens(edition: &str, source: String, limits: &Limits) -> Result<Vec<Token>, String> {
    let edition = edition.parse::<Edition>().map_err(|()| "Unsupported Rust edition.".to_owned())?;
    create_session_globals_then(edition, &[], None, || {
        let session = ParseSess::new();
        let parsed = rustc_parse::source_str_to_stream(
            &session,
            FileName::Custom("tsonic-native-quote".to_owned()),
            source,
            None,
        );
        let mut stream = match parsed {
            Ok(stream) => stream,
            Err(diagnostics) => {
                for diagnostic in diagnostics { diagnostic.emit(); }
                return Err("Native quotation contains invalid Rust tokens.".to_owned());
            }
        };
        stream.desugar_doc_comments();
        encode_stream(&session, &stream, &mut Budget::new(limits), 0)
    })
}

fn encode_stream(session: &ParseSess, stream: &TokenStream, budget: &mut Budget<'_>, depth: usize) -> Result<Vec<Token>, String> {
    let mut output = Vec::new();
    for tree in stream.iter() {
        budget.reserve(depth)?;
        match tree {
            TokenTree::Delimited(span, _, delimiter, nested) => {
                let delimiter = match delimiter {
                    Delimiter::Parenthesis => "parentheses",
                    Delimiter::Bracket => "brackets",
                    Delimiter::Brace => "braces",
                    Delimiter::Invisible(_) => return Err("An authored quotation cannot contain an invisible compiler interpolation.".to_owned()),
                };
                output.push(Token {
                    data: TokenKindData::Group { delimiter, tokens: encode_stream(session, nested, budget, depth + 1)? },
                    source: source_range(session.source_map(), span.entire())?,
                });
            }
            TokenTree::Token(token, spacing) => {
                let data = match token.kind {
                TokenKind::Ident(name, raw) => TokenKindData::Identifier {
                    text: name.to_string(), raw: raw == IdentIsRaw::Yes,
                },
                TokenKind::Literal(_) => TokenKindData::Literal { text: pprust::token_to_string(token).into_owned() },
                TokenKind::Lifetime(name, raw) => {
                    budget.reserve(depth)?;
                    let range = source_range(session.source_map(), token.span)?;
                    output.push(Token {
                        data: TokenKindData::Punctuation { text: "'".to_owned(), joint: true },
                        source: SourceRange { start: range.start, end: range.start + 1 },
                    });
                    output.push(Token {
                        data: TokenKindData::Identifier { text: name.as_str().trim_start_matches('\'').to_owned(), raw: raw == IdentIsRaw::Yes },
                        source: SourceRange { start: range.start + 1, end: range.end },
                    });
                    continue;
                }
                TokenKind::Eof => continue,
                TokenKind::NtIdent(..) | TokenKind::NtLifetime(..) | TokenKind::DocComment(..) => {
                    return Err("Unnormalized compiler token in authored quotation.".to_owned());
                }
                _ if token.is_punct() => TokenKindData::Punctuation {
                    text: pprust::token_to_string(token).into_owned(),
                    joint: *spacing == Spacing::Joint,
                },
                _ => return Err("Unsupported native lexical token category.".to_owned()),
                };
                output.push(Token { data, source: source_range(session.source_map(), token.span)? });
            }
        }
    }
    Ok(output)
}
