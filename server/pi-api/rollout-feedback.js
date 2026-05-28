import { mkdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const FEEDBACK_LABELS = new Set(['helpful', 'unhelpful'])

export function readRolloutFeedbackForSession(cwd, sessionPath, sessionId) {
  if (!cwd || !sessionPath || !sessionId) return {}

  const db = openDb()
  try {
    const rows = db.prepare(`
      SELECT entry_id, label, feedback_text, updated_at
      FROM rollout_feedback
      WHERE cwd = ? AND session_path = ? AND session_id = ?
    `).all(cwd, sessionPath, sessionId)

    return Object.fromEntries(rows.map((row) => [
      row.entry_id,
      {
        cwd,
        sessionId,
        sessionPath,
        entryId: row.entry_id,
        label: row.label,
        feedbackText: row.feedback_text || '',
        updatedAt: row.updated_at,
      },
    ]))
  } finally {
    db.close()
  }
}

export function applyRolloutFeedback(entries, cwd, sessionPath, sessionId) {
  const feedback = readRolloutFeedbackForSession(cwd, sessionPath, sessionId)
  return entries.map((entry) => ({
    ...entry,
    rolloutFeedback: feedback[entry.id]?.label || '',
    rolloutFeedbackText: feedback[entry.id]?.feedbackText || '',
  }))
}

export async function setRolloutFeedback({
  cwd,
  entryId,
  feedbackText = '',
  label,
  sessionId,
  sessionPath,
}) {
  if (!cwd) throw new Error('Project cwd is required')
  if (!sessionPath) throw new Error('Session path is required')
  if (!sessionId) throw new Error('Session id is required')
  if (!entryId) throw new Error('Entry id is required')
  if (label && !FEEDBACK_LABELS.has(label)) {
    throw new Error('Invalid feedback label')
  }
  const note = String(feedbackText || '').trim()

  await mkdir(dirname(dbPath()), { recursive: true })

  const db = openDb()
  try {
    const updatedAt = Date.now()

    if (!label) {
      db.prepare(`
        DELETE FROM rollout_feedback
        WHERE cwd = ?
          AND session_path = ?
          AND session_id = ?
          AND entry_id = ?
      `).run(cwd, sessionPath, sessionId, entryId)
      return null
    }

    db.prepare(`
      INSERT INTO rollout_feedback (
        cwd,
        session_path,
        session_id,
        entry_id,
        label,
        feedback_text,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cwd, session_path, session_id, entry_id) DO UPDATE SET
        label = excluded.label,
        feedback_text = excluded.feedback_text,
        updated_at = excluded.updated_at
    `).run(cwd, sessionPath, sessionId, entryId, label, note, updatedAt)

    return {
      cwd,
      sessionId,
      sessionPath,
      entryId,
      label,
      feedbackText: note,
      updatedAt,
    }
  } finally {
    db.close()
  }
}

function openDb() {
  mkdirSync(dirname(dbPath()), { recursive: true })
  const db = new DatabaseSync(dbPath())
  db.exec(`
    CREATE TABLE IF NOT EXISTS rollout_feedback (
      cwd TEXT NOT NULL,
      session_path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      label TEXT NOT NULL CHECK (label IN ('helpful', 'unhelpful')),
      feedback_text TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (cwd, session_path, session_id, entry_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rollout_feedback_session
      ON rollout_feedback(session_id, updated_at DESC);
  `)
  ensureFeedbackTextColumn(db)
  return db
}

function ensureFeedbackTextColumn(db) {
  const columns = db.prepare('PRAGMA table_info(rollout_feedback)').all()
  if (columns.some((column) => column.name === 'feedback_text')) return
  db.exec("ALTER TABLE rollout_feedback ADD COLUMN feedback_text TEXT NOT NULL DEFAULT ''")
}

function dbPath() {
  return join(leylineDataDir(), 'memory.sqlite')
}

function leylineDataDir() {
  return join(homedir(), '.local', 'share', 'leyline')
}
