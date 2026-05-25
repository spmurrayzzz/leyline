# Environment

On macOS, Electron loads the login shell environment so model and tool variables such as `EXA_API_KEY` are available to pi extensions and tools.

PATH handling follows the shell environment. If loading fails or times out, provider and tool variables may be missing. Browser development differs because the Vite server inherits the shell that launched it.
