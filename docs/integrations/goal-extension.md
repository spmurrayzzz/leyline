# Goal extension

The bundled goal extension lives at `.pi/extensions/goal/index.ts` and is injected through `resourceLoaderOptions.additionalExtensionPaths`. Browser runtime startup filters duplicate global goal extensions.

User commands include `/goal <objective>`, `/goal --tokens 80K <objective>`, `/goal --limit 5 <objective>`, `/goal pause`, `/goal resume`, and `/goal clear`.

Model tools include `get_goal`, `update_goal`, and optional `create_goal` when `PI_ENABLE_CREATE_GOAL=1` is set. The extension handles continuation behavior, budget limits, and persistence.
