# Motivations

Terminals are still the right interface for many agent workflows, but they
start to break down when agent work becomes concurrent. After a couple of
sessions, the problem is no longer just switching between tabs or tmux panes.
Each running surface carries its own state: sessions, branches, tool calls,
worktrees, sandboxes, environments, rollouts, and the surrounding project
context needed to make sense of it all.

Leyline is an experiment in making that lifecycle visible without turning the
interface into a noisy dashboard. The goal is to provide one place where agent
runtime, history, and related state can be inspected when needed, while leaving
terminal-native workflows available as an escape hatch.

It is also inspired by pi's minimalist, self-editing approach to software.
Agent interfaces feel inherently personal, much like editor, shell, or window
manager configurations. There probably is not a single ideal interface for
everyone. Leyline is intended to be opinionated, malleable, and dogfooded
daily: first to reduce my own agent workflow pain, and eventually to explore
what a more adaptable agent workspace could become.

This is not intended to replace an IDE. When the task is hand-writing code with
deep editor and LSP integration, an IDE is still the better tool. The goal here
is to provide a focused surface for supervising, understanding, and adapting
agent-driven work.
