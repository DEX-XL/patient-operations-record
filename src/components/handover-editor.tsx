"use client";

import { useRef, useState } from "react";
import { Check, FilePenLine } from "lucide-react";
import type { Graph } from "@/domain/types";
import { replayTime } from "./workspace-types";

export type HandoverEditorProps = {
  graph: Graph;
  persona: string;
  busy?: boolean;
  onSaved?: () => void | Promise<void>;
};

const failures: Record<string, string> = {
  STALE_VERSION: "The patient record changed. Your text is still here. Review the latest record, then save again.",
  SCOPE_DENIED: "Only the assigned nurse or hospitalist demo persona can save this handover.",
  LOAD_PATIENT_FIRST: "Open the patient record first, then try saving again.",
  PAUSE_REPLAY_FIRST: "Pause the demonstration clock before adding a handover.",
  CLOCK_LOCKED_DURING_AGENT_RUN: "Wait for the current assistant review to finish before saving this handover.",
  HANDOVER_COMMAND_CONFLICT: "This save request was already used for different text. Edit the note and try again.",
};

export function HandoverEditor(props: HandoverEditorProps) {
  return <HandoverForm key={`${props.graph.encounterId}:${props.persona}`} {...props} />;
}

function HandoverForm({ graph, persona, busy = false, onSaved }: HandoverEditorProps) {
  const [text, setText] = useState("");
  const [syntheticAcknowledged, setSyntheticAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const commandId = useRef<string | null>(null);
  const mayWrite = persona === "rn-charge" || persona === "md-hospitalist";
  const notes = [...new Map(graph.sources.filter((source) => source.kind === "note_span").map((source) => [source.text, source])).values()].reverse()
    .sort((left, right) => (right.occurredAtMs ?? 0) - (left.occurredAtMs ?? 0));

  async function save() {
    if (saving || busy || !mayWrite || !syntheticAcknowledged || !text.trim()) return;
    setSaving(true); setMessage(""); setFailed(false);
    try {
      commandId.current ??= crypto.randomUUID();
      const response = await fetch("/api/handovers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          synthetic: true,
          encounterId: graph.encounterId,
          actorId: persona,
          expectedVersion: graph.version,
          commandId: commandId.current,
          text: text.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(failures[result.error] ?? "The handover could not be saved. Your text is retained; try again.");
      commandId.current = null;
      setText(""); setSyntheticAcknowledged(false);
      setMessage("Handover saved to the shared record. It is unsigned context for the next review; no task or order was created.");
      try { await onSaved?.(); }
      catch { setMessage("Handover saved. Refresh the page to see the updated shared record."); }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "The handover could not be saved. Your text is retained.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="surface handover-editor" aria-labelledby={`handover-title-${graph.patientId}`}>
    <div className="section-title">
      <div><h2 id={`handover-title-${graph.patientId}`}>Shift handover</h2><p>Record what the next shift needs to follow up. Every saved note stays attached to this patient.</p></div>
      <span><FilePenLine size={16} aria-hidden="true" /> Unsigned staff context</span>
    </div>
    {notes.length > 0 && <div className="handover-source-list">
      <h3>Latest handover</h3>
      <p className="handover-raw-note">{notes[0].text}</p>
      <small>{notes[0].id.startsWith("staff-handover:") ? "Staff-entered synthetic note" : "Synthetic scenario note"}{notes[0].occurredAtMs !== undefined ? ` · ${replayTime(notes[0].occurredAtMs)}` : ""}</small>
      {notes.length > 1 && <details><summary>{notes.length - 1} earlier handover{notes.length > 2 ? "s" : ""}</summary>{notes.slice(1).map((note) => <div key={note.id}><p className="handover-raw-note">{note.text}</p><small>{note.occurredAtMs !== undefined ? replayTime(note.occurredAtMs) : "Recorded context"}</small></div>)}</details>}
    </div>}
    <label htmlFor={`handover-input-${graph.patientId}`} className="handover-input-label">Add a handover for {graph.patientId}</label>
    <textarea
      id={`handover-input-${graph.patientId}`}
      aria-describedby={`handover-help-${graph.patientId}`}
      placeholder="Write a synthetic shift handover: pending results, existing arrangements and who needs to follow up."
      value={text}
      maxLength={2000}
      rows={4}
      disabled={!mayWrite || saving || busy}
      onChange={(event) => { setText(event.target.value); commandId.current = null; setMessage(""); }}
    />
    <p id={`handover-help-${graph.patientId}`} className="source-note">Synthetic information only. This saves a note, not an order, proof of completion or a final EHR document. New wording needs a fresh Live Meta review when available, or an explicitly selected Rules baseline; an old recording will not be substituted.</p>
    {!mayWrite && <p className="source-note">Switch to Charge RN or Hospitalist to add a handover in this demonstration.</p>}
    <div className="handover-save-row">
      <label className="handover-acknowledgement"><input type="checkbox" checked={syntheticAcknowledged} disabled={!mayWrite || saving || busy} onChange={(event) => setSyntheticAcknowledged(event.target.checked)} /> This note contains synthetic information only.</label>
      <small aria-live="polite">{text.length}/2,000</small>
      <button className="primary-button" disabled={!mayWrite || saving || busy || !syntheticAcknowledged || !text.trim()} onClick={() => void save()}><Check size={14} aria-hidden="true" />{saving ? "Saving handover…" : "Save handover"}</button>
    </div>
    {message && <p className={failed ? "error-text" : "handover-saved"} role={failed ? "alert" : "status"}>{message}</p>}
  </section>;
}
