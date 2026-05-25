# Tools and thinking

Assistant text is rendered as markdown with raw HTML disabled. Thinking and model rows show reasoning traces and model context where available.

Tool rows are collapsed by default and can be expanded. Labels are matched to assistant `toolCall` blocks where possible, with path and command chips for reads, writes, edits, and bash calls. Skill prompt payloads render as compact rows that can unfurl.

Live tool rows reconcile with persisted transcript entries when the session detail refreshes.
