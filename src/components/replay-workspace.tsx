"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, ChevronRight, ClipboardCheck, Clock3, GitBranch, LayoutGrid, Pause, Play, RotateCcw, ShieldCheck, SkipForward, X } from "lucide-react";
import type { Source } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Mode } from "./workspace-ui";
import { friendly, PATIENTS, replayTime, type AgentMode, type AgentView, type ReplayView } from "./workspace-types";
import { UnitPanes, PatientDetails, ReviewInbox, TracePanel } from "./workspace-panels";

type Section = "unit" | "patient" | "inbox" | "trace";
export function ReplayWorkspace({ initialPatientId, initialMode }: { initialPatientId?: string; initialMode?: AgentMode }) {
  const [replay, setReplay] = useState<ReplayView | null>(null), [agent, setAgent] = useState<AgentView | null>(null);
  const [section, setSection] = useState<Section>(initialPatientId ? "patient" : "unit"), [patientId, setPatientId] = useState(initialPatientId ?? "P-101");
  const [mode, setMode] = useState<AgentMode>(initialMode ?? "RULES BASELINE"), [persona, setPersona] = useState("rn-charge"), [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [source, setSource] = useState<Source | null>(null);
  const [ownedRun, setOwnedRun] = useState<string | null>(null);
  const refreshBusy = useRef(false), alive = useRef(true), driving = useRef(false), lastTrigger = useRef("");
  const clearOwnedRun = useCallback((id: string) => {
    setOwnedRun((current) => current === id ? null : current);
    try { if (sessionStorage.getItem("por-driving-run") === id) sessionStorage.removeItem("por-driving-run"); } catch { /* In-memory ownership remains sufficient when storage is unavailable. */ }
  }, []);
  const sourceDialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!source) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sourceDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSource(null); }
      if (event.key === "Tab") {
        const controls = sourceDialog.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [source]);
  const refresh = useCallback(async () => {
    if (refreshBusy.current) return; refreshBusy.current = true;
    try {
      const responses = await Promise.all([fetch("/api/replay/state", { cache: "no-store", signal: AbortSignal.timeout(10_000) }), fetch("/api/agent", { cache: "no-store", signal: AbortSignal.timeout(10_000) })]);
      if (responses.some((response) => !response.ok)) throw new Error("Shared state is temporarily unavailable. The last received state is retained.");
      const [state, metadata] = await Promise.all(responses.map((response) => response.json()));
      if (alive.current) { setReplay(state); setAgent(metadata); setError(""); }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Shared state unavailable"); }
    finally { refreshBusy.current = false; }
  }, []);
  const post = useCallback(async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    const result = await response.json(); if (!response.ok) throw new Error(friendly(result.error ?? "COMMAND_REJECTED", result.issues ?? [])); return result;
  }, []);
  const act = useCallback(async (url: string, body: unknown, success?: string) => {
    setBusy(true); setNotice("");
    try { const result = await post(url, body); if (success) setNotice(success); await refresh(); return result; }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Action rejected"); }
    finally { setBusy(false); }
  }, [post, refresh]);
  useEffect(() => { alive.current = true; void refresh(); const timer = setInterval(() => void refresh(), 1000); return () => { alive.current = false; clearInterval(timer); }; }, [refresh]);
  useEffect(() => { try { setOwnedRun(sessionStorage.getItem("por-driving-run")); } catch { /* No persisted run to resume. */ } }, []);
  useEffect(() => {
    // An observer/keyless tab must not claim a CLI run using different funding
    // settings. Only the initiating tab drives it; a reload resumes its marker.
    const run = agent?.runs.find((item) => item.id === ownedRun);
    if (run && !["ready", "calling"].includes(run.status)) { clearOwnedRun(run.id); return; }
    if (!run || run.status !== "ready" || driving.current) return; driving.current = true;
    void (async () => { try { let current = run; while (alive.current && current.status === "ready") { current = await post("/api/agent", { action: "step", runId: current.id }); await refresh(); } if (!["ready", "calling"].includes(current.status)) clearOwnedRun(current.id); } catch (reason) { if (alive.current) setNotice(reason instanceof Error ? reason.message : "Run stopped; inspect its trace"); } finally { driving.current = false; } })();
  }, [agent?.runs, ownedRun, post, refresh, clearOwnedRun]);
  const reconcile = useCallback(async (encounterId: string) => {
    const result = await act("/api/agent", { action: "start", encounterId, actorId: persona, mode });
    if (result?.status === "ready") { setOwnedRun(result.id); try { sessionStorage.setItem("por-driving-run", result.id); } catch { /* Current tab still drives the run. */ } }
    if (result?.errorCode) setNotice(friendly(result.errorCode)); else if (result?.status === "staged") setNotice("A validated proposal is ready in the review inbox.");
  }, [act, mode, persona]);
  useEffect(() => {
    if (!automatic || !replay || replay.clock.pauseReason !== "trigger" || busy) return;
    const event = replay.timeline.at(-1), key = `${replay.epoch}:${event?.id}`;
    if (!event?.trigger || lastTrigger.current === key) return; lastTrigger.current = key; void reconcile(event.encounterId);
  }, [automatic, replay, busy, reconcile]);
  const graphs = replay?.panes.charge_rn ?? [], current = graphs.find((graph) => graph.patientId === patientId);
  const activeRun = agent?.runs.some((run) => ["ready", "calling"].includes(run.status));
  const citations = (ids: string[]) => <span className="citations">{ids.map((id) => <button key={id} title={`Inspect source ${id}`} onClick={() => setSource(graphs.flatMap((graph) => graph.sources).find((item) => item.id === id) ?? null)}>{id}</button>)}</span>;
  const openPatient = (id: string) => { setPatientId(id); setSection("patient"); };
  return <div className="app-shell">
    <aside className="app-sidebar"><Link className="app-brand" href="/"><span className="brand-symbol">p.</span><span>patient operations<br /><b>record</b></span></Link><div className="unit-label"><span className="live-dot" /> SYNTHETIC UNIT A<small>2 patients · 4 department views</small></div><nav aria-label="Workspace">{([["unit", LayoutGrid, "Unit replay"], ["patient", GitBranch, "Patient workspace"], ["inbox", ClipboardCheck, "Review inbox"], ["trace", Activity, "Trace & ledger"]] as const).map(([id, Icon, label]) => <button key={id} className={section === id ? "nav-active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon size={17} />{label}{id === "inbox" && Boolean(agent?.proposals.length) && <span className="nav-count">{agent?.proposals.length}</span>}</button>)}</nav><div className="sidebar-bottom"><ShieldCheck size={20} /><strong>People decide.</strong><p>Every proposed change is validated before a person accepts it.</p><small>Demo personas · no hospital SSO<br />No EHR or clinical order connection</small></div></aside>
    <main className="app-main"><header className="app-topbar"><span className="breadcrumb">Unit A <ChevronRight size={13} />{section === "unit" ? "Shared replay" : section === "patient" ? patientId : section === "inbox" ? "Human review" : "Execution evidence"}</span><label className="persona-label">Acting as <select aria-label="Demo persona" value={persona} onChange={(event) => setPersona(event.target.value)}><option value="rn-charge">Charge RN</option><option value="md-hospitalist">Hospitalist</option><option value="lab-owner">Laboratory</option><option value="cm-owner">Case management</option></select></label></header>
      <div className="workspace-content"><div className="page-heading"><div><p className="eyebrow">PATIENT FLOW / SHIFT CONTINUITY</p><h1>{section === "unit" ? "Keep the next step in view." : section === "patient" ? `${patientId} · ${PATIENTS[patientId].name}` : section === "inbox" ? "Review before anything changes." : "Follow every proposal to its source."}</h1><p>{section === "unit" ? "One shared clock. Four views of the same unfinished work." : section === "patient" ? "Source facts, operational dependencies and cited drafts." : section === "inbox" ? "Accept the exact batch or reconcile again when its version changes." : "Visible tools, local cost and a human action trail."}</p></div><Mode mode={replay?.mode ?? "UNAVAILABLE"} /></div>
      <section className="replay-toolbar" aria-label="Replay controls"><div className="clock-readout"><Clock3 size={17} /><strong>{replay ? replayTime(replay.clock.simulatedMs) : "Loading shared clock"}</strong><span>{activeRun ? "Paused for agent" : replay?.clock.pauseReason === "trigger" ? "Sign-out trigger" : replay?.clock.playing ? "Playing" : "Paused"}</span></div><div className="replay-buttons"><button className="primary-button" disabled={busy || activeRun || !replay} onClick={() => void act("/api/replay/state", { action: replay?.clock.playing ? "pause" : "play" })}>{replay?.clock.playing ? <Pause size={15} /> : <Play size={15} />}{replay?.clock.playing ? "Pause" : "Play"}</button><button className="button" disabled={busy || activeRun || replay?.clock.playing || !replay} onClick={() => void act("/api/replay/state", { action: "step" })}><SkipForward size={15} />Next event</button><select aria-label="Replay speed" value={replay?.clock.speed ?? 1} disabled={busy || activeRun} onChange={(event) => void act("/api/replay/state", { action: Number(event.target.value) })}><option value={1}>1× speed</option><option value={60}>60× speed</option><option value={2000}>2000× demo</option></select><button className="icon-button" aria-label="Reset synthetic replay" disabled={busy || activeRun} onClick={() => { lastTrigger.current = ""; void act("/api/replay/state", { action: "reset" }, "Replay reset; spending ledger and audit retained."); }}><RotateCcw size={15} /></button></div></section>
      <section className="agent-toolbar"><div><span className="agent-label"><Activity size={16} />Reconciliation assistant</span><select aria-label="Agent execution mode" value={mode} onChange={(event) => setMode(event.target.value as AgentMode)}><option>RULES BASELINE</option><option>LIVE META</option><option>RECORDED META</option></select></div><label className="auto-label"><input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} />Run at sign-out triggers</label><button className="button" disabled={busy || activeRun || !current} onClick={() => current && void reconcile(current.encounterId)}>Reconcile {patientId}<ArrowRight size={14} /></button></section>
      {error && <div className="message error-message" role="alert">{error}</div>}{notice && <div className="message" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></div>}{activeRun && <div className="message">The shared clock is paused during this bounded agent run.</div>}
      {section === "unit" && <UnitPanes replay={replay} busy={busy} persona={persona} act={act} citations={citations} openPatient={openPatient} openInbox={() => setSection("inbox")} />}
      {section === "patient" && <PatientDetails persona={persona} graph={current} replay={replay} patientId={patientId} selectPatient={setPatientId} busy={busy} citations={citations} act={act} />}
      {section === "inbox" && <ReviewInbox agent={agent} graphs={graphs} persona={persona} busy={busy} active={Boolean(activeRun)} act={act} citations={citations} reconcile={reconcile} />}
      {section === "trace" && <TracePanel agent={agent} />}
      <footer className="app-footer"><span>Synthetic observer console · role filters are implemented; hospital authentication is not connected.</span><span>Meta requests remain guarded by the persistent ledger.</span></footer></div>
    </main>{source && <div className="source-backdrop" onClick={() => setSource(null)}><aside ref={sourceDialog} className="source-drawer" role="dialog" aria-modal="true" aria-label="Source evidence" onClick={(event) => event.stopPropagation()}><header><h2>Source evidence</h2><button className="icon-button" aria-label="Close source evidence" onClick={() => setSource(null)}><X size={18} /></button></header><Mode mode="SIMULATED EVENT" /><code>{source.id}</code><Badge>{source.kind} · {source.status}</Badge>{source.kind === "note_span" && <p className="source-note">Unsigned/copied note text is context, not an order or completion event.</p>}<pre>{source.text}</pre><h3>Normalized facts</h3>{source.statements.length ? source.statements.map((statement, index) => <p key={index}>{statement}</p>) : <p>No draftable structured facts are inferred from this note span.</p>}</aside></div>}
  </div>;
}
