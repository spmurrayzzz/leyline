# Vision Agent Extension

Gives agents an image-inspection tool even when the current model has no vision
support. The `vision_agent` tool reads an image file and delegates the actual
visual understanding to a separate vision-capable model running as a child
session.

## Requirements

Like the subagent extension, this extension calls Leyline's local API at
`/api/pi/vision/resolve` and `/api/pi/vision`. It takes a path to an image file,
reads it, and hands the image bytes to a child session whose model supports
image input. The child session is hidden from the sidebar with the same
`leyline-subagent-session` marker Leyline uses for subagent children.

## Tool

```json
{
  "path": "screenshots/current.png",
  "question": "What error does this screen show?",
  "model": "anthropic/claude-sonnet-4-6"
}
```

- `path`: image file to inspect (PNG, JPEG, GIF, WebP). Required.
- `question`: optional; the vision agent answers this directly first.
- `model`: optional override, a model id, `provider/model-id`, or `inherit`.
- `cwd`: optional working directory for the image path.

## Model selection

The `vision_agent` tool needs a model that accepts image input. The model is
chosen in this order:

1. Tool-call `model`
2. Session vision override
3. Project vision override
4. Global default vision model

If no model is selected anywhere, the tool returns a clear error. Leyline
Settings shows a Vision group where the default model and project/transcript
overrides are stored. Only models with image input support appear as options.

## Prompt images without vision

Leyline's composer behaves the same on the home screen and in a transcript.
When a user attaches an image and the active model has no image support,
Leyline:

1. Delegates each image to the vision subagent for a text description.
2. Appends the description to the prompt text sent to the parent model.
3. Keeps the original prompt and image in the transcript while a request-local
   context transform replaces the image with its description for the parent
   model.

The composer shows a notice whenever a model without image support is active
and an image is attached, so delegation is visible before you submit.