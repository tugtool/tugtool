// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree

use crate::parser::grammar::TokVec;
use crate::tokenizer::whitespace_parser::WhitespaceError;
use crate::tokenizer::TokError;
use peg::Parse;
use thiserror::Error;

#[allow(clippy::enum_variant_names)]
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParserError<'a> {
    #[error("tokenizer error: {0}")]
    TokenizerError(TokError<'a>, &'a str),
    #[error("parser error: {0}")]
    ParserError(
        peg::error::ParseError<<TokVec<'a> as Parse>::PositionRepr>,
        &'a str,
    ),
    #[error(transparent)]
    WhitespaceError(#[from] WhitespaceError),
    #[error("invalid operator")]
    OperatorError,
}
