"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, ChevronRight, ClipboardCheck, Clock3, FileText, LayoutGrid, Pause, Play, RotateCcw, Settings2, ShieldCheck, SkipForward, Users, X } from "lucide-react";
import type { Source } from "@/domain/types";
import { DEMO_ROSTER } from "@/domain/roster";
import { isAssigned, scopedGraph } from "@/domain/scope";
import { Badge } from "@/components/ui/badge";
import { Mode } from "./workspace-ui";
import { friendly, PATIENTS, replayTime, ROLES, type AgentMode, type AgentView, type ReplayView } from "./workspace-types";
import { PatientBoard, DepartmentWorklist, UnitPanes, PatientDetails, ReviewInbox, TracePanel } from "./workspace-panels";

type Section = "unit" | "patient" | "inbox" | "departments" | "trace";
export function ReplayWorkspace({ initialPatientId, initialMode }: { initialPatientId?: string; initialMode?: AgentMode }) {
  const [replay, setReplay] = useState<ReplayView | null>(null), [agent, setAgent] = useState<AgentView | null>(null);
  const [section, setSection] = useState<Section>(initialPatientId ? "patient" : "unit"), [patientId, setPatientId] = useState(initialPatientId ?? "P-101");
  const [mode, setMode] = useState<AgentMode>(initialMode ?? "RULES BASELINE"), [persona, setPersona] = useState("rn-charge"), [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [source, setSource] = useState<Source | null>(null);
  const [ownedRun, setOwnedRun] = useState<string | null>(null);
  const [guide, setGuide] = useState<"handover" | "surgery" | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
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
  useEffect(() => { let cancelled = false; void fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(5_000) }).then((response) => response.ok ? response.json() : null).then((health) => { if (!cancelled) setLiveEnabled(health?.liveEnabled === true); }).catch(() => { /* Live stays unavailable until the deployment reports it enabled. */ }); return () => { cancelled = true; }; }, []);
  useEffect(() => {
    // An observer/keyless tab must not claim a CLI run using different funding
    // settings. Only the initiating tab drives it; a reload resumes its marker.
    const run = agent?.runs.find((item) => item.id === ownedRun);
    if (run && !["ready", "calling"].includes(run.status)) { if (["failed", "exhausted"].includes(run.status)) setNotice(`Review stopped. ${run.errorCode ? friendly(run.errorCode) : "The assistant reached its run limit."} No changes from this run were applied.`); clearOwnedRun(run.id); return; }
    if (!run || run.status !== "ready" || driving.current) return; driving.current = true;
    void (async () => { try { let current = run; while (alive.current && current.status === "ready") { current = await post("/api/agent", { action: "step", runId: current.id }); await refresh(); } if (current.status === "staged") { setSection("inbox"); setNotice("Suggested changes are ready for your review."); } else if (["failed", "exhausted"].includes(current.status)) setNotice(`Review stopped. ${current.errorCode ? friendly(current.errorCode) : "The assistant reached its run limit."} No changes from this run were applied.`); if (!["ready", "calling"].includes(current.status)) clearOwnedRun(current.id); } catch (reason) { if (alive.current) setNotice(reason instanceof Error ? reason.message : "Run stopped; inspect its trace"); } finally { driving.current = false; } })();
  }, [agent?.runs, ownedRun, post, refresh, clearOwnedRun]);
  const canUseAgent = ["rn-charge", "md-hospitalist", "lab-owner", "cm-owner"].includes(persona);
  const reconcile = useCallback(async (encounterId: string, explicitMode?: AgentMode) => {
    if (!canUseAgent) { setNotice("Switch to Charge nurse, Hospitalist, Laboratory or Case management to use the handover assistant."); return; }
    const chosenMode = explicitMode ?? mode;
    if (explicitMode) setMode(explicitMode);
    const result = await act("/api/agent", { action: "start", encounterId, actorId: persona, mode: chosenMode });
    if (result?.status === "ready") { setOwnedRun(result.id); try { sessionStorage.setItem("por-driving-run", result.id); } catch { /* Current tab still drives the run. */ } }
    if (result?.errorCode) setNotice(friendly(result.errorCode)); else if (result?.status === "staged") { setNotice("Suggested changes are ready. Review the sources, then accept or reject them."); setSection("inbox"); }
  }, [act, mode, persona, canUseAgent]);
  useEffect(() => {
    if (!automatic || !canUseAgent || !replay || replay.clock.pauseReason !== "trigger" || busy) return;
    const event = replay.timeline.at(-1), key = `${replay.epoch}:${event?.id}`;
    if (!event?.trigger || lastTrigger.current === key) return; lastTrigger.current = key; void reconcile(event.encounterId);
  }, [automatic, replay, busy, reconcile, canUseAgent]);
  const selectedActor = DEMO_ROSTER.find((actor) => actor.id === persona)!;
  const graphs = (replay?.panes.charge_rn ?? []).filter((graph) => isAssigned(selectedActor, graph)).map((graph) => scopedGraph(graph, selectedActor));
  const current = graphs.find((graph) => graph.patientId === patientId);
  const hasStaffNote = current?.sources.some((item) => item.kind === "note_span" && item.id.startsWith("staff-handover:")) ?? false;
  const selectPersona = (id: string) => { const actor = DEMO_ROSTER.find((item) => item.id === id); if (!actor) return; setPersona(id); setAutomatic(false); if (!actor.encounterIds.includes(patientId.replace("P-", "E-"))) setPatientId(actor.encounterIds[0].replace("E-", "P-")); };
  const activeRun = agent?.runs.some((run) => ["ready", "calling"].includes(run.status));
  const citations = (ids: string[]) => <span className="citations">{ids.map((id) => <button key={id} title={`Inspect source ${id}`} onClick={() => setSource(graphs.flatMap((graph) => graph.sources).find((item) => item.id === id) ?? null)}>{id}</button>)}</span>;
  const openPatient = (id: string) => { if (!graphs.some((graph) => graph.patientId === id)) { setNotice("This demo persona is not assigned to that patient. Switch to an assigned role to open the record."); return; } setPatientId(id); setSection("patient"); };
  const loadExample = async (example: "handover" | "surgery") => {
    setBusy(true); setLoadingExample(true); setNotice(""); setAutomatic(false); setMode("RECORDED META"); lastTrigger.current = "";
    try {
      let state: ReplayView = await post("/api/replay/state", { action: "reset" });
      const target = example === "handover" ? "p-night-signout" : "a-proposal-trigger";
      for (let step = 0; state.timeline.at(-1)?.id !== target; step++) {
        if (step >= 24) throw new Error("The example could not reach its handover event. Please restart the example.");
        state = await post("/api/replay/state", { action: "step" });
      }
      await post("/api/replay/state", { action: "pause" });
      setPatientId(example === "handover" ? "P-201" : "P-101"); setGuide(example); setSection("patient");
      setNotice("Example loaded. Read the handover below, then choose Review handover. No new model call was made.");
      await refresh();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "The example could not be loaded."); }
    finally { setBusy(false); setLoadingExample(false); }
  };
  const reviewCount = agent?.proposals.filter((proposal) => proposal.baseVersion === graphs.find((graph) => graph.encounterId === proposal.encounterId)?.version).length ?? 0;
  const headings: Record<Section, [string, string]> = {
    unit: ["Every patient. One clear next step.", "See what is unfinished, who owns it, and what needs to happen next."],
    patient: [`${patientId} · ${PATIENTS[patientId]?.name ?? "Patient"}`, "Follow the recorded work from handover to completion."],
    inbox: ["Review suggested changes", "Check the source and owner before a suggestion becomes shared work."],
    departments: ["Work across departments", "The same patient record, organized for each team."],
    trace: ["How this demonstration works", "Evidence for reviewers and developers. These controls are separate from patient work."],
  };
  return <div className="app-shell">
    <aside className="app-sidebar">
      <Link className="app-brand" href="/"><span className="brand-symbol">p.</span><span>patient operations<br /><b>record</b></span></Link>
      <div className="unit-label"><span className="live-dot" /> UNIT A<small>Synthetic inpatient workspace</small></div>
      <nav aria-label="Workspace">{([["unit", LayoutGrid, "Patient board"], ["inbox", ClipboardCheck, "Review changes"], ["departments", Users, "Department work"]] as const).map(([id, Icon, label]) => <button key={id} className={section === id || (id === "unit" && section === "patient") ? "nav-active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon size={18} />{label}{id === "inbox" && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><ShieldCheck size={20} /><strong>You stay in control.</strong><p>The assistant suggests. Staff review and accept each change.</p><button className="technical-link" onClick={() => setSection("trace")}><Activity size={14} /> Technical evidence</button><small>Demo data only<br />No hospital systems connected</small></div>
    </aside>
    <main className="app-main">
      <header className="app-topbar"><span className="breadcrumb">Unit A <ChevronRight size={13} />{section === "patient" ? <button className="text-button" onClick={() => setSection("unit")}>Patient board</button> : section === "unit" ? "Patient board" : section === "departments" ? "Department work" : section === "inbox" ? "Review changes" : "Technical evidence"}{section === "patient" && <><ChevronRight size={13} />{patientId}</>}</span><label className="persona-label">Viewing as <select aria-label="Demo persona" value={persona} onChange={(event) => selectPersona(event.target.value)}>{DEMO_ROSTER.map((actor) => <option key={actor.id} value={actor.id}>{actor.role === "charge_rn" ? "Charge nurse" : ROLES[actor.role]}</option>)}</select></label></header>
      <div className="workspace-content">
        <div className="page-heading"><div><p className="eyebrow">PATIENT OPERATIONS</p><h1>{headings[section][0]}</h1><p>{headings[section][1]}</p></div>{replay && <span className="shift-stamp"><Clock3 size={15} />{replayTime(replay.clock.simulatedMs)}<small>synthetic timeline</small></span>}</div>
        {error && <div className="message error-message" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Try again</button></div>}
        {notice && <div className="message" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></div>}
        {activeRun && <div className="message" role="status">The assistant is checking the record. The demonstration clock is paused until the suggestions are ready.</div>}
        {section === "unit" && <>
          <section className="start-here" aria-label="Start here"><div><p className="eyebrow">NEW HERE? START WITH ONE HANDOVER</p><h2>A promise in a note needs an owner.</h2><p>A night handover mentions a pending blood culture and follow-up arrangements. See how those words become source-linked work that another department can pick up.</p><ol className="guide-steps"><li><span>1</span>Read the handover</li><li><span>2</span>Review the suggestions</li><li><span>3</span>See the team update</li></ol><button className="primary-button" disabled={busy || activeRun || !replay || !canUseAgent} onClick={() => void loadExample("handover")}>{loadingExample ? "Loading example…" : "Try the handover example"}<ArrowRight size={16} /></button></div><div className="start-note"><FileText size={21} /><span>Example · unsigned sign-out</span><blockquote>“f/u BCx, home O2 eval mentioned by day team before dc, PCP 1-2 wk. No arrangement task or booked visit recorded.”</blockquote><p>Context to check with its author. This is not a new order.</p><Mode mode="RECORDED META" /></div></section>
          <PatientBoard replay={replay} graphsOverride={graphs} agent={agent} openPatient={openPatient} openInbox={() => setSection("inbox")} />
          <button className="text-button example-alternative" disabled={busy || activeRun || !replay || !canUseAgent} onClick={() => void loadExample("surgery")}>Or explore the surgical handover and changed OR schedule <ArrowRight size={14} /></button>
        </>}
        {section === "patient" && <>
          {guide && <div className="guide-ribbon"><span><b>Example in progress</b> · Read the note → review the suggested work → accept the exact changes.</span><button className="text-button" onClick={() => setGuide(null)}>Hide guide</button></div>}
          <section className="handover-review" aria-label="Handover assistant"><div><span className="eyebrow">HANDOVER ASSISTANT</span><h2>Turn the sign-out into owned follow-through.</h2><p>{current?.sources.some((item) => item.kind === "note_span") ? "Check the original note below. The assistant compares its commitments with the existing record, then suggests changes for your review." : "A handover note appears when the demonstration reaches a sign-out event. Use an example from the patient board to begin."}</p><Mode mode={mode} /><span className="mode-explanation">{mode === "RECORDED META" ? "Genuine captured Meta output; playback makes no new model call." : mode === "RULES BASELINE" ? "Deterministic rules; no model call." : liveEnabled ? "New Meta API requests, subject to server-side credentials and funding checks." : "Live Meta is unavailable on this deployment. Choose Recorded Meta or Rules baseline in Demonstration controls."}</span></div><div className="handover-actions"><button className="primary-button" disabled={busy || activeRun || !canUseAgent || !current || (mode === "LIVE META" && !liveEnabled) || (hasStaffNote && mode === "RECORDED META") || !current.sources.some((item) => item.kind === "note_span")} onClick={() => current && void reconcile(current.encounterId)}>Review handover <ArrowRight size={15} /></button>{reviewCount > 0 && <button className="button" onClick={() => setSection("inbox")}>Open {reviewCount} suggested {reviewCount === 1 ? "change" : "batches"}</button>}</div></section>
          {hasStaffNote && mode === "RECORDED META" && <section className="new-note-choice" aria-label="Review a staff-entered note"><div><strong>This handover has new staff-entered text.</strong><p>The recorded Meta example belongs to an earlier note. Choose a fresh check explicitly; this app will not reuse that recording for your new wording.</p></div><div className="button-row"><button className="primary-button" disabled={busy || activeRun || !canUseAgent || !current} onClick={() => current && void reconcile(current.encounterId, "RULES BASELINE")}>Check with rules instead <ArrowRight size={14} /></button>{liveEnabled && <button className="button" disabled={busy || activeRun || !canUseAgent || !current} onClick={() => current && void reconcile(current.encounterId, "LIVE META")}>Request a fresh Live Meta check</button>}</div></section>}
          {!canUseAgent && <p className="role-help">You are viewing assigned {ROLES[selectedActor.role].toLowerCase()} work. A charge nurse or hospitalist reviews the handover and approves proposed changes.</p>}
          <DepartmentWorklist graphs={current ? [current] : []} persona={persona} busy={busy || Boolean(activeRun)} act={act} />
          <PatientDetails persona={persona} graph={current} replay={replay} patientId={patientId} allowedPatientIds={graphs.map((graph) => graph.patientId)} selectPatient={setPatientId} busy={busy || Boolean(activeRun)} citations={citations} act={act} onSaved={refresh} />
        </>}
        {section === "departments" && <><DepartmentWorklist graphs={graphs} persona={persona} busy={busy || Boolean(activeRun)} act={act} /><UnitPanes replay={replay} busy={busy} persona={persona} act={act} citations={citations} openPatient={openPatient} openInbox={() => setSection("inbox")} /></>}
        {section === "inbox" && <ReviewInbox agent={agent} graphs={graphs} persona={persona} busy={busy} active={Boolean(activeRun)} act={act} citations={citations} reconcile={reconcile} />}
        {section === "trace" && <TracePanel agent={agent} />}
        <details className="demo-settings"><summary><Settings2 size={15} /><span>Demonstration controls</span><small>Replay events and assistant mode</small></summary><p>This is a shared synthetic unit. Changing or restarting the replay changes the example record for everyone viewing this demo. It never writes to a hospital system.</p>
          <section className="replay-toolbar" aria-label="Replay controls"><div className="clock-readout"><Clock3 size={17} /><strong>{replay ? replayTime(replay.clock.simulatedMs) : "Loading timeline"}</strong><span>{activeRun ? "Paused for assistant" : replay?.clock.pauseReason === "trigger" ? "Handover reached" : replay?.clock.playing ? "Playing" : "Paused"}</span></div><div className="replay-buttons"><button className="primary-button" disabled={busy || activeRun || !replay} onClick={() => void act("/api/replay/state", { action: replay?.clock.playing ? "pause" : "play" })}>{replay?.clock.playing ? <Pause size={15} /> : <Play size={15} />}{replay?.clock.playing ? "Pause" : "Play"}</button><button className="button" disabled={busy || activeRun || replay?.clock.playing || !replay} onClick={() => void act("/api/replay/state", { action: "step" })}><SkipForward size={15} />Next event</button><select aria-label="Replay speed" value={replay?.clock.speed ?? 1} disabled={busy || activeRun} onChange={(event) => void act("/api/replay/state", { action: Number(event.target.value) })}><option value={1}>1× speed</option><option value={60}>60× speed</option><option value={2000}>2000× demo</option></select><button className="icon-button" aria-label="Reset synthetic replay" disabled={busy || activeRun} onClick={() => { lastTrigger.current = ""; setGuide(null); void act("/api/replay/state", { action: "reset" }, "The synthetic timeline was restarted. Prior activity remains in technical evidence."); }}><RotateCcw size={15} /></button></div></section>
          <section className="agent-toolbar"><div><span className="agent-label"><Activity size={16} />Assistant mode</span><select aria-label="Agent execution mode" value={mode} onChange={(event) => setMode(event.target.value as AgentMode)}><option>RULES BASELINE</option><option disabled={!liveEnabled}>LIVE META</option><option>RECORDED META</option></select></div><label className="auto-label"><input type="checkbox" checked={automatic} disabled={!canUseAgent} onChange={(event) => setAutomatic(event.target.checked)} />Run at sign-out triggers</label><button className="button" disabled={busy || activeRun || !canUseAgent || !current || (mode === "LIVE META" && !liveEnabled) || (hasStaffNote && mode === "RECORDED META")} onClick={() => current && void reconcile(current.encounterId)}>Review {patientId}<ArrowRight size={14} /></button></section>
          {!liveEnabled && <p className="source-note">Live Meta is disabled on this deployment. Recorded Meta replays genuine captured output; Rules baseline runs locally. New or edited notes cannot be matched to an unrelated recording.</p>}
        </details>
        <footer className="app-footer"><span>Synthetic demonstration · no patient data or hospital connection.</span><button className="text-button" onClick={() => setSection("trace")}>View technical evidence <ArrowRight size={12} /></button></footer>
      </div>
    </main>{source && <div className="source-backdrop" onClick={() => setSource(null)}><aside ref={sourceDialog} className="source-drawer" role="dialog" aria-modal="true" aria-label="Source evidence" onClick={(event) => event.stopPropagation()}><header><h2>Original source</h2><button className="icon-button" aria-label="Close source evidence" onClick={() => setSource(null)}><X size={18} /></button></header><Mode mode="SIMULATED EVENT" /><code>{source.id}</code><Badge>{source.kind} · {source.status}</Badge>{source.kind === "note_span" && <p className="source-note">This note is context to check with its author. It does not create an order or confirm completed work.</p>}<pre>{source.text}</pre><h3>Facts recorded in this source</h3>{source.statements.length ? source.statements.map((statement, index) => <p key={index}>{statement}</p>) : <p>No structured facts are inferred from this note span.</p>}</aside></div>}
  </div>;
}
