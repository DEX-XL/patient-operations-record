import { GitBranch } from "lucide-react";
export function Mode({ mode }: { mode: string }) { return <span className={`mode-chip ${mode === "UNAVAILABLE" ? "mode-off" : mode === "LIVE META" ? "mode-live" : ""}`}><i />{mode}</span>; }
export function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><GitBranch size={28} strokeWidth={1.3} /><h3>{title}</h3><p>{text}</p></div>; }
export function PaneTitle({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <header className="pane-title"><span className="pane-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div><span className="role-scoped">Scoped</span></header>; }
