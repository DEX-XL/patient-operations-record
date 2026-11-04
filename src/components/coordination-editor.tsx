"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import type { Graph } from "@/domain/types";
import { DEMO_ROSTER } from "@/domain/roster";
import { isAssigned } from "@/domain/scope";
import { ROLES } from "./workspace-types";

export type CoordinationEditorProps = {
  graph: Graph;
  persona: string;
  busy?: boolean;
  onSaved?: () => void | Promise<void>;
};

const errors: Record<string, string> = {
  STALE_VERSION: "The patient record changed. Your form is retained. Review the latest record, then propose it again.",
  SCOPE_DENIED: "Only the assigned Charge RN or Hospitalist can propose this task.",
  INVALID_OWNER: "Choose a department owner assigned to this patient.",
  SOURCE_REQUIRED: "Choose an existing source and an order-linked project visible to your role.",
  EXISTING_PROJECT_REQUIRED: "Choose an existing order-linked project for this patient. This form does not create orders.",
  INVALID_PREREQUISITE: "The prerequisite must be an existing operational task for this patient.",
  CLINICAL_PHRASE: "Use this form for operational coordination, not treatment instructions or clinical orders.",
  INVALID_COORDINATION_INPUT: "Check the task name, owner, existing order and planned duration.",
  DUPLICATE_PROPOSAL: "This request is already saved. Open Review changes to inspect it; it has not been submitted twice.",
};

export function CoordinationEditor({ graph, persona, busy = false, onSaved }: CoordinationEditorProps) {
  const [label, setLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dependsOnTaskId, setDependsOnTaskId] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState("10");
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const commandId = useRef<string | null>(null);
  const actor = DEMO_ROSTER.find((person) => person.id === persona);
  const mayWrite = persona === "rn-charge" || persona === "md-hospitalist";
  const sources = graph.sources.filter((source) => actor && source.visibleTo.includes(actor.role));
  const projects = graph.projects.filter((project) => sources.some((source) => source.id === project.sourceOrderId));
  const owners = DEMO_ROSTER.filter((person) => isAssigned(person, graph));
  const prerequisites = graph.tasks.filter((task) => task.kind === "operational");
  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0];
  const selectedSourceId = sources.some((source) => source.id === sourceId) ? sourceId : selectedProject?.sourceOrderId ?? "";
  const selectedOwnerId = owners.some((owner) => owner.id === ownerId) ? ownerId : "";
  const minutes = Number(plannedMinutes);
  const validMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;

  useEffect(() => {
    setLabel(""); setProjectId(""); setSourceId(""); setOwnerId(""); setDependsOnTaskId("");
    setPlannedMinutes("10"); setAcknowledged(false); setMessage(""); setFailed(false); commandId.current = null;
  }, [graph.encounterId]);

  function edited() { commandId.current = null; setMessage(""); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || busy || !mayWrite || !acknowledged || !selectedProject || !selectedSourceId || !selectedOwnerId || !label.trim() || !validMinutes) return;
    setSaving(true); setMessage(""); setFailed(false);
    try {
      commandId.current ??= crypto.randomUUID();
      const response = await fetch("/api/coordination", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ synthetic: true, encounterId: graph.encounterId, actorId: persona, expectedVersion: graph.version,
          commandId: commandId.current, projectId: selectedProject.id, sourceId: selectedSourceId, ownerId: selectedOwnerId,
          label: label.trim(), plannedMinutes: minutes, ...(dependsOnTaskId ? { dependsOnTaskId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(errors[result.error] ?? errors[result.issues?.[0]] ?? "The task could not be proposed. Your form is retained; check the record and try again.");
      commandId.current = null; setLabel(""); setAcknowledged(false);
      setMessage("Task proposed. Open Review changes to approve it before it appears in the department's worklist.");
      try { await onSaved?.(); } catch { /* The proposal is already persisted; a later shared-state refresh will show it. */ }
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "The task could not be proposed. Your form is retained.");
    } finally { setSaving(false); }
  }

  const disabled = !mayWrite || saving || busy;
  return <section className="surface coordination-editor" aria-labelledby={`coordination-title-${graph.patientId}`}>
    <div className="section-title"><div><h2 id={`coordination-title-${graph.patientId}`}>Coordinate existing work</h2><p>Give an existing patient workflow a named owner and a clear next step.</p></div><Link2 size={18} aria-hidden="true" /></div>
    <p className="source-note">A staff-authored operational task, linked to an existing order. It needs human approval and does not create a test, prescription, appointment or clinical order.</p>
    {!mayWrite && <p className="source-note">Switch to Charge RN or Hospitalist to propose coordination work.</p>}
    {!projects.length ? <p className="empty-text">No existing order-linked project is visible yet. Advance the synthetic example until an order arrives.</p> : <form onSubmit={(event) => void submit(event)} className="coordination-form">
      <label className="coordination-wide">Next operational step<input aria-label="Next operational step" type="text" maxLength={240} required value={label} placeholder="For example: confirm transport for the existing CT booking" disabled={disabled} onChange={(event) => { setLabel(event.target.value); edited(); }} /></label>
      <label>Existing order or workflow<select aria-label="Existing order or workflow" required value={selectedProject?.id ?? ""} disabled={disabled} onChange={(event) => { setProjectId(event.target.value); setSourceId(""); edited(); }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}</select></label>
      <label>Department owner<select aria-label="Department owner" required value={selectedOwnerId} disabled={disabled} onChange={(event) => { setOwnerId(event.target.value); edited(); }}><option value="">Choose an assigned owner</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{ROLES[owner.role]}</option>)}</select></label>
      <label className="coordination-wide">Supporting source<select aria-label="Supporting source" required value={selectedSourceId} disabled={disabled} onChange={(event) => { setSourceId(event.target.value); edited(); }}>{sources.map((source) => <option key={source.id} value={source.id}>{source.kind.replaceAll("_", " ")} · {source.text.slice(0, 120)}</option>)}</select></label>
      <label>Starts after<select aria-label="Starts after" value={dependsOnTaskId} disabled={disabled} onChange={(event) => { setDependsOnTaskId(event.target.value); edited(); }}><option value="">No prerequisite</option>{prerequisites.map((task) => <option key={task.id} value={task.id}>{task.label} · {task.state.replaceAll("_", " ")}</option>)}</select></label>
      <label>Planned task duration (minutes)<input aria-label="Planned task duration in minutes" type="number" min={1} max={1440} step={1} required value={plannedMinutes} disabled={disabled} onChange={(event) => { setPlannedMinutes(event.target.value); edited(); }} /><small>A staff-entered estimate, not a clinical or discharge prediction.</small></label>
      <div className="coordination-wide handover-save-row"><label className="handover-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={(event) => setAcknowledged(event.target.checked)} /> Synthetic operational coordination only.</label><button className="primary-button" type="submit" disabled={disabled || !acknowledged || !label.trim() || !selectedOwnerId || !validMinutes}>{saving ? "Saving proposal…" : "Propose task"}<ArrowRight size={14} aria-hidden="true" /></button></div>
    </form>}
    {message && <p className={failed ? "error-text" : "handover-saved"} role={failed ? "alert" : "status"}>{message}</p>}
  </section>;
}
