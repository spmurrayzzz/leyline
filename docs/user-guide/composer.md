# Composer

Use the composer to submit text prompts and image attachments to the selected session.

Shell commands are submitted with `!` and `!!`. The slash command picker exposes pi commands and prompt helpers. Follow-up and steering submissions are queued using the backend's one-at-a-time behavior.

Leyline warns when images are attached to a model without vision support. The composer is disabled while activating, compacting, or running states make submission unsafe. The stop button interrupts the selected runtime session.

## Voice Input (Dictation)

The composer supports voice dictation to quickly draft prompts. When supported by your environment, a microphone button in the composer allows you to toggle dictation on and off. 

- **Browser**: Supported in compatible browsers (such as Google Chrome) using the native Web Speech API.
- **Electron**: Unsupported, as Chromium in Electron does not include the proprietary Google speech components required for the native Web Speech API. The microphone button is disabled in the desktop application.

