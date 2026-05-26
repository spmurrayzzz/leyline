export const GOAL_STATE_TYPE = 'goal-state'

export function isGoalStateEvent(event) {
  return event?.type === 'message_end'
    && event.message?.role === 'custom'
    && event.message?.customType === GOAL_STATE_TYPE
}

export function goalStateFromSession(session) {
  const entries = session?.sessionManager?.getEntries?.() || []
  return goalStateFromEntries(entries)
}

export function goalStateFromEntries(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type !== 'custom') continue
    if (entry.customType !== GOAL_STATE_TYPE) continue
    return normalizeGoalState(entry.data)
  }
  return null
}

function normalizeGoalState(data) {
  const goal = data?.goal
  if (!goal || typeof goal.objective !== 'string') return null
  return {
    objective: goal.objective,
    status: typeof goal.status === 'string' ? goal.status : '',
    tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
    continuationLimit: Number(goal.continuationLimit || 0),
    continuationsUsed: Number(goal.continuationsUsed || 0),
    tokensUsed: Number(goal.tokensUsed || 0),
    timeUsedSeconds: currentGoalSeconds(goal),
    createdAt: Number(goal.createdAt || 0),
    updatedAt: Number(goal.updatedAt || 0),
  }
}

function currentGoalSeconds(goal) {
  const base = Number(goal.timeUsedSeconds || 0)
  if (goal.status !== 'active') return base
  if (typeof goal.activeSince !== 'number') return base
  return base + Math.max(0, Math.floor((Date.now() - goal.activeSince) / 1000))
}
