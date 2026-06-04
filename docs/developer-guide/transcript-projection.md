# Transcript projection

Transcript projection turns pi session entries from the current branch into UI-ready transcript entries.

Shared projection lives in `src/lib/transcript-projection.js`. It matches tool results to assistant `toolCall` blocks, renders markdown with raw HTML disabled, and supports export. In-app transcript styles in `src/style.css` and export styles in `server/pi-api.js` should stay visually in sync for message, tool, and thinking output.

## Markdown and Code Syntax Highlighting

Transcript text is rendered dynamically with robust markdown formatting and language-specific code block highlighting:

- **Markdown Rendering**: Handled via `markdown-it` with raw HTML rendering disabled to ensure security and clean presentation.
- **Code Block Highlighting**: 
  - Uses the `highlight.min.js` bundle packaged with the pi coding agent.
  - Due to the nature of the bundler (`var hljs = ...` definition), Leyline imports the raw source of the vendor script and evaluates it securely via `new Function` returning `hljs`.
  - Automatically identifies common code block languages (e.g., JavaScript, Python, Bash, JSON) and highlights them.
- **Visual Synchronization**: Syntax colors are defined as CSS variables (`--syntax-*`) in `src/style.css`. These variables are mirrored identically in `server/pi-api.js` to ensure that exported HTML transcripts display code blocks with the exact same high-quality color scheme as the live in-app workbench.

