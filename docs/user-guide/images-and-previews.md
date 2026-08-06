# Images and previews

Leyline supports pasted prompt images and transcript previews for tool output.

## Attach an image to a prompt

1. Copy one or more images.
2. Paste them into the composer.
3. Select **×** to remove an unwanted image.
4. Send the prompt.

Leyline accepts PNG, JPEG, GIF, and WebP image data. The composer has no fixed image count or byte limit.

Leyline shows a warning when the selected model does not support images. Remove the images or select a compatible model before submission.

Shell commands and `/compact` cannot include images.

## Read prompt images

Images sent with a user message appear below that message. Each image uses its data from the session content.

## Expand a tool preview

Select a collapsed tool row. Leyline can show these preview types:

- Image output from an image read.
- File content from a file read.
- A before-and-after diff.
- A patch.
- Plain text or formatted JSON when no structured preview is available.

An inline file preview shows up to 400 lines. It reports the number of clipped lines when more content exists.

## Open a fullscreen preview

![Fullscreen diff preview for an edited source file](/screenshots/preview-fullscreen.png)

*Fullscreen mode uses the complete projected preview data.*

1. Select the fullscreen action in the tool header.
2. Inspect the full available preview.
3. Select **×** or the backdrop to close it.

The fullscreen view uses the available file, image, patch, diff, JSON, or plain-text data. Select **Copy** to copy the available tool output.
