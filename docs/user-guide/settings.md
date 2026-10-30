# Settings

**Settings** manages app preferences and defaults for the selected backend. Project and session overrides have separate drawers.

## Open Settings

Select **Open settings** at the bottom of the sidebar. In Electron, use **Settings…**, **Command+,** on macOS, or **Ctrl+,** on Linux.

The modal has these categories:

| Category | Applies to |
| --- | --- |
| **Display** | Transcript display across Leyline windows. |
| **Connections** | Network access for the native backend, saved connections, and the default connection. Each window selects its own active backend. |
| **Dictation** | Dictation method and client preferences. Local speech model settings belong to the speech host. |
| **Files** | File actions on the selected backend. |
| **Agent defaults** | Session titles and global subagent and vision defaults on the selected backend. |
| **Runtime** | Idle runtime cleanup on the selected backend. |
| **Models & providers** | Pi provider credentials, custom providers, model definitions, and catalog overrides on the selected backend. |
| **MCP servers** | Pi's global MCP configuration on the selected backend. |

**Files**, **Runtime**, **Models & providers**, and **MCP servers** appear only when the selected backend supports them. On narrow screens, use **Category** to select a page.

Dictation is available in the browser and Electron. Browser dictation stays the default in normal web browsers. **Local models** is also available in normal web browsers and Electron. See [Dictation](./dictation) for setup and processing details.

In **Dictation**, choose **Browser dictation** or **Local models**. Browser speech recognition is managed by the browser and may use an online service. Local models run on this computer in Electron, or on the Leyline server in a browser. In a browser, microphone audio goes to the server that serves the app, independent of the selected agent backend.

For local models, select and download a model explicitly. Parakeet supports English. Whisper Turbo is multilingual, with English or language detection in Settings. Model, language, and keep-warm settings belong to the speech host. Microphone, method, and shortcut preferences stay on the client. The microphone opens only for dictation or an explicit test. **Keep model ready** keeps the model in memory, not the microphone.

Trace capture has no category in this modal. Open **Session traces** or the sidebar **Trace explorer** button, then expand **Capture new runs** in the footer. See [Tracing](./tracing#control-capture).

Global pi configuration stays in pi's files. Leyline stores display preferences, connections, agent defaults and overrides, and runtime cleanup settings in its own `memory.sqlite` database. See [Configuration storage](../reference/environment#pi-configuration-storage).

## Manage backend connections

![Connections category in the global Settings modal](../assets/screenshots/backend-connections.png)

Open **Connections** to see the native backend and each saved connection. The native backend supplied the current Leyline app. You cannot edit or remove it.

To add a connection:

1. Select **Add connection**.
2. Enter a name.
3. Enter the backend URL.
4. Select **Test**.
5. Select **Save**.

The URL must use `http` or `https`. It can contain a hostname, an IP address, a port, and a base path. Do not add `/api/pi`; Leyline adds that path.

Each saved connection has these actions:

- **Use**: Select the backend for the current window.
- **Test**: Check the server identity and API version.
- **Make default**: Select the backend for fresh windows.
- **Edit**: Change the connection name or URL.
- **Remove**: Delete a connection that is not active in the current window.

Saved connections and the default are app-wide. New Electron windows inherit the source window's active backend unless you open a different backend in that window.

Command-click, Ctrl-click, or middle-click a backend choice in the sidebar or **Connections** to open Home on that backend. Electron opens a new window and leaves the source window unchanged.

When you select another backend in the current window, Leyline reloads that window. An active agent run continues on the previous backend. Leyline clears an unsent composer draft after confirmation.

::: warning
The Leyline backend API does not have authentication. Do not expose the server to an untrusted network. Settings routes can change credentials and execute configured commands.
:::

Traces and their capture setting also belong to the selected backend. The trace explorer does not combine data across connections. Trace input and output can contain private data, so protect access to the backend. See [Trace privacy](./tracing#keep-trace-data-private).

### Share the native backend

![Network access enabled with a saved proxy port and copyable sharing URLs](../assets/screenshots/network-access.png)

1. Open **Settings → Connections** on the computer that runs Leyline.
2. Turn on **Allow network access**.
3. Select **Copy** beside an address that the other device can reach.
4. Open that URL in the other device's browser.

For Tailscale, use the address for this computer's Tailscale interface. Both devices need network access to that address and port.

These controls share the **native backend**, even when the current window uses a saved remote connection. Network access is off by default. Sharing uses a separate listener on all IPv4 interfaces, including Wi-Fi and Tailscale.

To set a fixed port:

1. Enter a whole number from 1 through 65535 in **Proxy port**.
2. Select **Apply**.

Leave **Proxy port** blank and select **Apply** for automatic selection. An automatic port can change after you enable sharing again or restart Leyline. A fixed port stays the same across restarts.

You can save a port while sharing is off. **Apply** changes only the port, not the switch. Leyline saves both settings and restores them at startup.

Changes apply immediately without changing the local app's address or interrupting local clients and running agents. Changing an active port or turning access off disconnects remote clients and their terminals. After a port change, use the new sharing URL to reconnect.

If a port is unavailable, Leyline shows an error. A failed change keeps the previous listener and saved port.

::: warning
Use trusted networks only. The API has no authentication. Anyone who can reach the sharing URL can access files, change settings, and run commands. Sharing is not restricted to Tailscale.
:::

If startup configuration already exposes the origin, the toggle does not close that separate access path. Settings shows a notice in this case.

Opening the sharing URL serves both the app and API from one origin. No extra allowed-origin setting is necessary. A UI on a different non-loopback origin still needs `LEYLINE_SERVER_ALLOWED_ORIGINS`. See [Environment variables](../reference/environment).

## Manage models and providers

![Provider connection settings with authentication and endpoint controls](../assets/screenshots/models-providers.png)

Open **Models & providers**. Select a provider in the searchable list, or use the **Provider** selector on a narrow screen. Each provider has **Models** and **Connection** tabs.

The list includes built-in providers, custom configuration, and providers from extensions available in the current project. Configuration changes apply globally on the selected backend.

API keys are optional for custom compatible endpoints. Leave the key unset when the endpoint does not need one. Leyline does not require a placeholder key.

### Sign in to a provider

1. Select the provider.
2. Open **Connection**.
3. Select the applicable **Sign in** method.
4. Follow pi's prompts in the Settings panel.
5. Open the authorization link if the provider requests browser login.

Credentials stay on the selected backend. Saved secrets do not appear in the provider details. Authentication prompts and replies do not enter the conversation transcript or shared runtime WebSocket.

**Configured** means saved configuration or credentials are available. It does not confirm account access. Use [Test connection](#test-a-model-connection) to check a model request. Sign-in does not select a model. Use the composer to change the active model.

Use **Sign out** to remove the saved credential through pi. Environment credentials and API-key references can still apply. Removing a reference from `models.json` does not sign out a stored credential.

If a runtime retains older provider URLs, Leyline rejects sign-in before it saves new credentials. Pi shares credentials across sessions. Without this check, an older runtime could send new credentials to a previous endpoint.

Wait for active work to finish, then reload each affected session and retry. A backend restart also clears old runtimes, but clears pending **Up next** tasks. See [Sign-in safety](../reference/troubleshooting#provider-sign-in-is-blocked-after-an-endpoint-change).

### Add or edit a custom provider

1. Select **Add provider**.
2. Enter a unique **Provider ID** without spaces or `/`.
3. Enter the **Base URL** and select the **API format**.
4. Set the display name, authorization-header behavior, or API-key reference as needed.
5. Select **Save provider**.

The base URL must use HTTP or HTTPS without credentials, query parameters, or a fragment. To change an existing provider, open **Connection**, then select **Edit configuration**. Existing provider IDs cannot change.

Saving a provider does not add model definitions. Open **Models**, then select **Add custom model** to add a model. The provider form's **Model ID to test** checks a model without saving its definition.

An API-key reference accepts `$NAME`, `${NAME}`, a literal key, or `!command`. A bare `NAME` is a literal key. Commands execute on the backend when pi resolves the value. Use only commands that you trust.

Saved references stay hidden. Keep the current reference, replace it, or remove it explicitly. Unchanged fields keep their saved values.

**Remove provider configuration** removes the saved configuration, including fields outside this form. It does not remove built-in or extension definitions, or sign out stored credentials.

Pi 0.99.1 can retain cached model URLs after a Radius gateway URL changes. Leyline therefore rejects changes to existing Radius gateway URLs. Configure a different provider ID through pi for a different gateway. This editor does not create Radius OAuth configuration.

### Manage model definitions and overrides

![Provider Models tab with custom model definitions and catalog controls](../assets/screenshots/provider-models.png)

Open **Models** to search model names or IDs.

- **Add custom model** creates a definition for an endpoint. Set the provider's base URL and API format first.
- **Override** changes metadata for a catalog model.
- **Edit** changes an existing custom definition or override.
- **Reset override** removes all saved overrides for that model, including fields outside the form.
- **Delete custom model** removes the custom definition.

The editor uses the workspace width and temporarily hides the provider list. Its sections share one draft:

| Section | Fields |
| --- | --- |
| **Model** | Model ID, display name, context window, maximum output tokens, and supported input. |
| **Thinking & compatibility** | Reasoning support, the thinking level map, and developer-role support. |
| **Pricing** | Input, output, cache-read, and cache-write costs in USD per million tokens. |

**Save model**, **Save override**, and **Test connection** stay below the fields. Changing sections keeps your unsaved values. Validation opens the section that contains an invalid field and focuses that field.

Model IDs can contain `/` and must match the endpoint. An existing model ID cannot change. **Reset override** and **Delete custom model** are inside **Model → Effective metadata and saved overrides**.

Only changed fields are written. Unedited fields, other compatibility options, and nested pricing tiers stay intact. A save or deletion fails if it leaves invalid model configuration.

**Refresh catalog** requests the provider's catalog through pi. The **Refresh** button beside **Models & providers** reloads the settings view and extension registrations. Neither action reloads open conversation runtimes.

On Home, saved changes refresh the model choices. Valid explicit model and thinking selections remain selected. For an existing session, use [Reload runtime](#reload-the-runtime).

Model-picker visibility controls and other pi settings are not part of this page.

### Find a configuration in the catalog

![Catalog search with provider variants, selected import fields, and a fixed Copy into draft button](../assets/screenshots/model-catalog.png)

1. Open **Add custom model**, **Edit**, or **Override**.
2. Select **Find in catalog**.
3. Enter a model name or ID, then select **Search** or press Enter.
4. Select a provider variant and review its values.
5. Clear any import groups that you do not want.
6. Select **Copy into draft**.
7. Adjust the copied fields for your endpoint, then save.

Lookup searches the backend's cached pi catalog and shows up to 20 matches. **Refresh** requests a network update without discarding the model draft. If refresh fails, Leyline warns when results still come from the cache. You can also enter values manually.

Results and review scroll separately. Search, **Back to editor**, and **Copy into draft** stay visible. Escape returns to the editor before it cancels the draft.

The review offers these import groups when the entry supplies them:

- **Model details**: Display name, supported input, context window, maximum output, and reasoning support. New custom models also receive the catalog ID.
- **Thinking level map**: The provider values and unsupported levels for that entry.
- **Developer role**: Whether the endpoint accepts developer messages.

**Model details** starts selected. Missing model-detail fields leave your draft unchanged. Review imported values before saving. Costs, endpoint, API format, credentials, and other compatibility flags never copy.

![Model section populated from the catalog, with the imported ID still editable](../assets/screenshots/model-editor.png)

Copy opens **Model** when **Model details** is selected. Otherwise, it opens **Thinking & compatibility**. A new model's copied ID can include a provider prefix, such as `qwen/`. Edit it to match the ID served by your endpoint. Existing model IDs stay unchanged, including when you create a new override.

A catalog entry describes one provider's deployment. Check its token limits and template behavior against your server. Copy does not save configuration, contact the model endpoint, or select a conversation model.

### Set thinking and developer-role compatibility

![Thinking and compatibility section with a Qwen thinking map and developer role disabled](../assets/screenshots/model-thinking.png)

Open **Thinking & compatibility**. Enable **Reasoning support** to edit the map for `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

| Behavior | Saved value | Effect |
| --- | --- | --- |
| **Provider default** | Key omitted | Use pi's inherited behavior for that level. |
| **Unsupported** | `null` | Remove the level from the composer's choices. |
| **Send value** | A string | Map the pi level to the value your endpoint accepts. |

For example, **Send value** with `none` writes `"off": "none"`. This differs from **Unsupported**, which writes `"off": null`. Setting every row to **Provider default** removes the saved map.

**Developer role** has three choices: **Provider default**, **Supported**, and **Not supported**. Select **Not supported** when the chat template requires system messages instead of developer messages. **Provider default** removes that model's explicit flag. Other compatibility settings remain unchanged.

### Test a model connection

**Test connection** sends a short generation request through the selected backend. It is optional. A failed test does not block saving or model selection.

To test saved settings, open **Models** and select **Test connection** beside the model.

To test a provider before saving:

1. Open **Add provider** or **Edit configuration**.
2. Enter the connection settings.
3. Enter an endpoint model ID in **Model ID to test**.
4. Select **Test connection** beside **Save provider**.

![Provider editor with unsaved connection settings and a successful test beside Save](../assets/screenshots/provider-connection-test.png)

The model editor also has **Test connection** beside **Save model** or **Save override**. It uses the current **Model ID** and unsaved form values.

![Tabbed model editor with test feedback beside the fixed Save and Test connection controls](../assets/screenshots/model-connection-test.png)

Progress, **Cancel**, and the result appear beside Save/Test. In the model editor, these controls stay visible below the current section. The form keeps its unsaved values. Changing a field clears the previous result.

A test does not save form values, select a model, reload a live session, or add conversation messages. Removing a draft key reference still preserves stored credentials. Native OAuth can refresh saved tokens during a test; cancellation cannot undo that refresh.

Tests request up to 16 output tokens, disable automatic retries, and allow 30 seconds for the probe after settings runtime setup. A test can incur a charge or load a local model. Success confirms the short request, not every model capability.

This pi version cannot enforce those limits for:

- Codex models using `openai-codex-responses`.
- Direct OpenAI Responses with ChatGPT-subscription authentication.
- `openai-responses` models with `supportsMaxOutputTokens: false`.
- Bedrock, whose native automatic retries cannot be disabled.

Leyline explains why a test is unavailable before it sends the test generation request. These limits do not prevent normal model use.

Virtual model tests route to a physical model first. Provider editors require a physical **Model ID to test**. Draft endpoint or API changes cannot use a stored OAuth login. Tests can also be blocked by the [provider URL safety check](../reference/troubleshooting#provider-sign-in-is-blocked-after-an-endpoint-change).

Tests apply the same thinking-map and developer-role reset rules as Save. Some legacy provider extensions cannot expose their inherited defaults. If Leyline cannot resolve a reset, save the model first, then test its saved settings from **Models**.

## Manage MCP servers

![MCP server configuration with explicit connection and sign-in actions](../assets/screenshots/mcp-servers.png)

Open **MCP servers** to manage pi's global `mcp.json` on the selected backend. Opening the page lists configuration without starting server connections.

### Add or edit a server

1. Select **Add server**.
2. Enter a name with letters, digits, underscores, or hyphens.
3. Select **Remote HTTP** or **Local process (stdio)**.
4. Enter the server URL or command.
5. Set tool exposure, timeout, and enabled state as needed.
6. Select **Save server**.

For stdio, enter one argument per line without shell quotes. The command runs on the selected backend, which can be a different computer. **Working directory** and environment variables apply to that process.

HTTP servers can use request headers and **Advanced OAuth configuration**. Native OAuth requires a compatible HTTP server without a configured `Authorization` header. The advanced fields do not establish OAuth support by themselves.

Tool exposure has these options:

- **Deferred (tool search)**: Pi discovers tools on demand through tool search.
- **Direct (always available)**: Tools enter the normal tool list.
- **Hidden**: Tools stay outside model discovery.

Leyline does not load Codemode. Existing pi exposure values outside these options remain unchanged unless you select another value.

Use **Edit server** to change a server. Its saved name cannot change. Changing transport removes fields that belong to the previous transport. The form lists those fields before you save.

Saved arguments, header values, environment values, and client secrets stay hidden. Blank replacement values keep saved secrets and arguments. Use the explicit removal controls to delete them.

Saving, deleting, or changing **Enabled** does not start or stop connections in open sessions. Reload those sessions to apply the configuration.

### Check a connection or sign in

Select **Check connection** to open a temporary connection and inspect the reported tools. For stdio, this starts the configured command on the selected backend. A check can connect a disabled server without changing its saved enabled state.

**Last check** describes the temporary connection. It does not show the health of connections in open sessions. Diagnostic text excludes raw server output that could contain secrets.

For an eligible HTTP server, select **Sign in** and follow pi's prompts. **Sign out** removes native OAuth credentials without requiring a live connection. Aliases for the same normalized server URL share native OAuth credentials.

**Cancel** stops the settings operation and closes its temporary resources. It cannot undo credential changes that pi already saved. Reload open sessions after authentication or configuration changes.

## Handle external configuration changes

Leyline preserves unknown fields, JSONC comments in `models.json`, and configuration symlinks. It checks each file's revision before a save or draft connection test.

If another process changes the file, the save fails instead of overwriting that edit. Refresh settings, review the current values, and apply the change again. Refresh asks before it discards unsaved form changes.

## Configure file actions

Open **Files** when the selected backend supports file actions.

1. Enter an **Editor command**, such as `code --wait` or `nvim`.
2. Select **Open editor in**: **Automatic**, **Desktop**, or **Leyline terminal**.
3. Select **Save**.

Leave the command blank to use `$EDITOR` on that backend. **Automatic** uses the Leyline terminal for recognized terminal editors. **Desktop** launches the editor on the backend's desktop.

Leyline appends the file path to the command. Optional arguments are supported, but shell operators and substitutions are not. File actions run on the selected backend. A remote backend does not launch an editor on the browser's computer.

See [Images and previews](./images-and-previews#preview-a-local-file) for local file links and outside-project approval.

## Set the thought display default

1. Open **Display**.
2. For **Thoughts**, select **Collapsed** or **Expanded**.

The setting controls the initial state of each new **Thought** or **Thinking** row. If no setting is saved, Leyline uses **Collapsed**. Existing rows keep their current state. This setting does not change the model's thinking level.

## Set automatic session titles

![Session title settings with a title model and independent thinking mode](../assets/screenshots/session-title-settings.png)

Automatic titles are off by default. A **Title model** is required before you can enable them.

1. Open **Settings → Agent defaults → Session titles**.
2. Choose a **Title model**.
3. Set **Thinking mode** if needed.
4. Turn on **Automatic titles**.

**Thinking mode** defaults to the title model's lowest supported mode, independently of the conversation's thinking level. These settings apply to all projects on the selected backend, with no project or session overrides.

Each title request sends up to 1,024 characters from your first message to the chosen provider and can incur charges. It does not change the conversation model or thinking level. See [Automatic session titles](./sessions#automatic-session-titles) for eligible sessions, progress, and manual names.

## Manage the vision agent

![Agent defaults with the image-capable vision model and thinking controls](../assets/screenshots/vision-agent.png)

Open **Agent defaults** to set the vision model for all projects on the selected backend. Under **Vision agent**, select an image-capable **Vision model**. If **Thinking mode** appears, select a level or **Match parent session**.

Project and session overrides use their own surfaces:

- **Project actions → Project settings → Settings**: Override values for that project.
- **Session details** in the workbench header: Override values for the current session. Forks copy these overrides.

Model and thinking values inherit independently, in session, project, then global order. The displayed effective value starts at the scope of the open surface. A global default does not include a project or session override.

Select the inherited option to remove a project or session override. In **Agent defaults**, **None configured** removes the global model. **Default (no override)** removes its thinking value.

Before a session exists, configure global defaults or project overrides. Session overrides require a selected session.

When the active model cannot receive images, Leyline tells it to call `vision_agent`. See [Images and previews](./images-and-previews) for image handling and storage.

## Manage subagent models

Open **Agent defaults** and find **Subagents** to set global model defaults. Use **Project settings** or **Session details** for narrower overrides. See [Subagents](./subagents) for precedence and inheritance.

## Set subagent batch size

Open **Agent defaults → Subagents**. Change **Batch size** to a positive whole number. Leave the field to save it. The default is 4. The value must be a positive safe integer.

For a session override, open **Session details → Subagents**. Select **Use global default** to remove that override. Forks copy the override. There is no project batch-size override.

Batch size limits concurrent subagents within each batch, not total work across a session or backend. Changes apply to future groups and parallel calls without reload. Running groups keep their size. See [Configure batch size](./subagents#configure-batch-size) for execution behavior.

## Configure idle runtime cleanup

1. Open **Settings → Runtime → Idle cleanup**.
2. Set **Idle timeout (minutes)** to a whole number from 0 through 1440.
3. Select **Save**.

The default is 5 minutes. Set 0 to disable cleanup. This setting applies to all projects on the selected backend.

Cleanup closes idle runtimes and their MCP processes without deleting sessions. Sessions open in connected windows stay loaded. Sessions with active work, queued or held tasks, or pending approvals also stay loaded. Reopen a session to restore its history and connections.

## Inspect runtime state

Select **Session details** in the workbench header. In Electron on macOS, **Command+Shift+E** opens or closes this drawer. The shortcut does nothing on Home.

![Session details with read-only runtime state, subagent batch size, and model overrides](../assets/screenshots/session-details.png)

The **Runtime** section shows the model, thinking level, enabled tool count, context usage, and event connection state. These values are read-only. Change the active model and thinking level in the composer.

## Inspect session state

Scroll to **Session** in **Session details** to see the project, session ID, CWD, path, and message count. Use **Copy session ID**, **Copy CWD**, or **Copy path** to copy a value.

For project metadata and session management, open [Project settings](./projects-and-search#open-project-settings).

## Reload the runtime

**Reload runtime** is at the bottom of the sidebar, beside **Open settings**. Provider and MCP save notices also offer **Reload selected session** when the selected session is idle.

Reload recreates the selected runtime with current pi resources and configuration. It does not reload every open or background session. Reload is disabled without a selected session or during active work.

Pending **Up next** tasks stay held after reload. Select **Resume** when you are ready to send them. A backend restart clears those unsent tasks.
