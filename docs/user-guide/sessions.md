# Sessions

A pi session is a JSONL, tree-structured conversation log managed by pi. Leyline groups sessions by cwd/project in the sidebar.

You can select an existing session, create a session in a project, and delete or trash a session from the UI. Session routes use `/sessions/<encoded-id>` for selected sessions and `/` for the empty state. Legacy `?session=` routes are not supported.

Background runtime sessions can continue while you switch projects or view another transcript.
