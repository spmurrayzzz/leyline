# Vision agent integration

Leyline bundles `.pi/extensions/vision-agent/index.ts`. The extension registers the `vision_agent` tool so a model can inspect image files through a separate image-capable model.

The composer uses the same child-session path when the active parent model cannot receive attached images.

## Tool contract

The tool accepts these fields:

```json
{
  "path": "screenshots/current.png",
  "question": "What error does this screen show?",
  "model": "anthropic/claude-sonnet-4-6",
  "cwd": "/workspace/project"
}
```

- `path` is a required absolute path or a path relative to `cwd`.
- `question` is optional. The child answers it before it gives surrounding detail.
- `model` is an optional model ID, `provider/model-id`, or `inherit` value.
- `cwd` is optional and defaults to the parent session working directory.

The tool accepts PNG, JPEG, GIF, and WebP files. It returns the child model's final text and includes child-session, usage, model, and error data in the tool result.

## Model selection

The tool selects a model in this order:

1. The `model` value in the tool call.
2. A session vision override.
3. A project vision override.
4. The global vision model.

The value `inherit` selects the parent model. It succeeds only when that model supports image input.

The **Vision agent** drawer stores overrides in the `vision_overrides` table in `~/.local/share/leyline/memory.sqlite`. The drawer lists only models that report image input support.

## Thinking selection

The drawer stores model and thinking values independently at each scope. Each value uses session, project, then global precedence. A scope can contain a thinking value without a model value.

The **Thinking mode** card appears when the effective vision model supports reasoning. It provides the model's supported levels, **Match parent session**, and **Default (no override)**. **Match parent session** resolves to the parent session's current thinking level when the vision child starts.

A session fork copies both values from its session override.

## Composer delegation

Before Leyline submits an image to a parent model without image support, it completes these actions:

1. Resolve the session, project, or global vision model and thinking value.
2. Run one hidden vision child for each attached image.
3. Build a text block from the returned descriptions.
4. Submit the original prompt and images to pi for transcript persistence.
5. Replace the images with the description block in parent-model context.

The composer shows **Describing image…** during this preflight. It shows the selected vision model before submission.

Leyline does not delegate images for extension slash commands because a handled extension command does not start a parent-model turn. When the active model lacks image support, the composer blocks those attachments. Do not attach images to an extension slash command.

## Persisted context replacement

`installVisionDelegationContext()` wraps the parent session's `agent.transformContext` function. A pending record covers the first model request before pi has finished writing the custom entry.

After pi saves the user message, Leyline appends a `leyline-vision-delegation` custom entry. The entry stores the image signature, generated description, user-message timestamp, and user entry ID.

At each later model boundary, the wrapper reloads these records from the active branch. It removes matched image blocks from parent-model context and adds the stored description. The persisted user message keeps its original text and images through reloads and branch changes.

## Child runtime

The server creates each vision child through the normal subagent runtime path. The child has these constraints:

- Its model must support image input.
- Its active tool allowlist is empty.
- Its thinking level uses the effective vision override when one is set.
- Its session contains the `leyline-subagent-session` marker and stays hidden from the sidebar.
- Its JSONL history keeps the vision prompt and image.
- A session-local settings override permits image input without changing the user's persisted pi image setting.

The configured model provider receives the image and prompt. Provider authentication must be available to the Leyline server process. Leyline does not delete the hidden child session after execution.

## Cancellation

A prompt request owns an abort controller while vision preflight runs. A session interrupt or request disconnect cancels unfinished vision children.

An individual child failure becomes a `Vision delegation failed` block. Other image children continue, and Leyline starts the parent prompt after all image runs finish.

The direct vision execution route also aborts its child when the HTTP connection closes before completion.

## Internal routes

The integration uses these routes:

1. `GET /api/pi/vision/config` reads visible overrides for the browser.
2. `PUT|DELETE /api/pi/vision/override` changes one scope. PUT accepts optional `model` and `thinking` values. DELETE removes both values.
3. `POST /api/pi/vision/resolve` resolves stored configuration for the extension.
4. `POST /api/pi/vision` runs one vision child.

See the [API reference](../reference/api#vision-agent-routes) for request and response contracts.
