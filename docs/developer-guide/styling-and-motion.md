# Styling and motion

Leyline's visual direction is dense, restrained, professional, and subtly purple-black: deep purple panels and borders, restrained violet accents, neutral charcoal transcript surfaces, warmer sidebar tones, and no decorative gradients.

Assistant labels use `Agent`, not `Leyline`.

Motion should feel like restrained desktop-app microinteraction. Prefer explicit transitions over `transition: all`, and animate opacity, transform, color, border, and background instead of layout.

## Transcript Message Animations

To elevate the feel of the session stream without adding noisy distraction, the transcript uses structured transitions for message arrivals:

- **Persisted Message Entrance (`message-enter`)**: When newly added entries arrive in the persisted timeline of an active session, they animate in using a 260ms `ease-emphasized` (`cubic-bezier(0.16, 1, 0.3, 1)`) transition. This translates the message up slightly (`translateY(6px` to `0`) and fades in its opacity. To avoid a bulk flash, this animation is bypassed during session switching and initial load.
- **Live-Turn Handoff Choreography**: Submitted prompts undergo a synchronized animation flow to make the transition between user entry and agent response seamless:
  - `live-user-handoff`: Subtle, instant reaction upon committing the prompt.
  - `live-assistant-wake`: Gentle fade-and-slide as the assistant begins streaming thoughts or text.
  - `live-tool-edge` & `live-tool-settle`: Snappy slide-and-snap transitions for tool executions.
- **Reduced Motion**: All animations respect the user's system preferences and are disabled/flattened when `prefers-reduced-motion: reduce` is active.

## Loading Skeleton Alignments

Skeletons represent destination content structure rather than generic progress bars:
- **Spatial Alignment**: The initialization/loading skeleton (`.transcript-skeleton-panel`) is top-aligned and centers exactly to the transcript column, mirroring the actual message and tool container geometry.
- **Visual Design**: The skeleton includes user-shaped, assistant-shaped, and tool-shaped rows with high-to-low progressive opacity decay and a vertical `mask-image` fade so only the top section is prominent.
- **Desynchronized Shimmer**: Shimmer waves are desynchronized across different rows to make the loading state feel more natural and organic.
- **State Guards**: Loading skeletons are strictly guarded. Startup prompt execution does not trigger the in-project empty skeleton, avoiding layered skeleton visuals.

