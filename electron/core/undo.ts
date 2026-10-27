// ── Undo Stack: Reversible actions ka record ──────────────────────────────
interface UndoAction {
  id: string
  description: string
  undoFn: () => Promise<string> | string
  timestamp: number
}

const undoStack: UndoAction[] = []
const MAX_STACK_SIZE = 50   // Sirf aakhri 50 actions

// ── Register new undo action ───────────────────────────────────────────────
export function pushUndo(
  description: string,
  undoFn: () => Promise<string> | string,
): void {
  const action: UndoAction = {
    id: `undo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    description,
    undoFn,
    timestamp: Date.now(),
  }
  undoStack.push(action)
  console.log(`[Undo] 📝 Registered: ${description} (stack: ${undoStack.length})`)

  // Stack size limit
  if (undoStack.length > MAX_STACK_SIZE) {
    undoStack.shift()
  }
}

// ── Undo last action ──────────────────────────────────────────────────────
export async function undoLast(): Promise<string> {
  if (undoStack.length === 0) {
    return 'Nothing to undo — no recent actions.'
  }

  const action = undoStack.pop()!
  console.log(`[Undo] ⏪ Undoing: ${action.description}`)

  try {
    const result = await action.undoFn()
    console.log(`[Undo] ✅ Result: ${result}`)
    return result
  } catch (e: any) {
    console.error(`[Undo] ❌ Failed:`, e)
    return `Could not undo "${action.description}": ${e?.message || String(e)}`
  }
}

// ── List what can be undone ───────────────────────────────────────────────
export function undoHistory(): string[] {
  if (undoStack.length === 0) {
    return ['No actions to undo — the stack is empty.']
  }
  return [...undoStack]
    .reverse()
    .map((a, i) => {
      const time = new Date(a.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      return `${i + 1}. ${a.description} (${time})`
    })
}

// ── Clear stack ───────────────────────────────────────────────────────────
export function clearUndoStack(): void {
  undoStack.length = 0
  console.log('[Undo] Stack cleared')
}

// ── Count ─────────────────────────────────────────────────────────────────
export function undoCount(): number {
  return undoStack.length
}