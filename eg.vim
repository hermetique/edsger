" Vim syntax file
" Language: Edsger

if exists("b:current_syntax")
  finish
end

syn keyword egkeywords data where import
syn match egvariables "\v'[^ ]+\s|'[^ ]+$"
syn match egcomment "# .*$"

" syn match egnum "\v[+-]?\d+(\.\d+([eE][+-]?\d+)?)?"
syn match egstr "\v\"[^"]*\""
syn match egsyms "\v[:{}\(\)\[\]!.,;~?→←=><⇒≤≥λ≡≠+/*$|-]"

let b:current_syntax = "eg"
hi def link egkeywords Type
hi def link egvariables Identifier
" hi def link egnum Constant
hi def link egstr String
hi def link egcomment Comment
hi def link egsyms Statement
