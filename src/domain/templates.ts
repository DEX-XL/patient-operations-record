import { z } from "zod";
import ct from "../../config/templates/ct.json";
import lab from "../../config/templates/lab.json";
import or from "../../config/templates/or.json";
import discharge from "../../config/templates/discharge.json";
import { RoleSchema, type Person, type Task, type Dependency } from "./types";
import { ownerFor } from "./roster";

const StepSchema = z.object({
  id: z.string(), label: z.string(), ownerRole: RoleSchema,
  plannedMinutes: z.number().int().nonnegative(), expectedEvidence: z.enum(["order", "result", "schedule", "adt", "note_span", "attestation", "medication"]),
  expectedWindowMinutes: z.number().int().nonnegative(),
}).strict();
const TemplateSchema = z.object({ id: z.string(), projectKind: z.enum(["lab", "imaging", "or_case", "discharge"]), steps: z.array(StepSchema), dependencies: z.array(z.tuple([z.string(), z.string()])) }).strict();
export const TEMPLATES = [ct, lab, or, discharge].map((template) => {
  const parsed = TemplateSchema.parse(template);
  const ids = new Set(parsed.steps.map((step) => step.id));
  if (ids.size !== parsed.steps.length || parsed.dependencies.some(([from, to]) => !ids.has(from) || !ids.has(to))) throw new Error("INVALID_TEMPLATE");
  return parsed;
});
export function templateStep(key: string | undefined) {
  const [templateId, stepId] = key?.split(":") ?? [];
  return TEMPLATES.find((template) => template.id === templateId)?.steps.find((step) => step.id === stepId);
}
export function matchesTemplate(task: Task) {
  const step = templateStep(task.templateStep);
  return !!step && task.label === step.label && task.ownerRole === step.ownerRole && task.plannedMinutes === step.plannedMinutes && task.expectedEvidence === step.expectedEvidence && task.expectedWindowMinutes === step.expectedWindowMinutes;
}
export function expandTemplate(input: { templateId: string; encounterId: string; projectId: string; sourceOrderId: string; roster: readonly Person[] }): { tasks: Task[]; dependencies: Dependency[] } {
  const template = TEMPLATES.find((item) => item.id === input.templateId);
  if (!template) throw new Error("UNKNOWN_TEMPLATE");
  const id = (stepId: string) => `${input.projectId}:${stepId}`;
  return {
    tasks: template.steps.map((step) => ({
      id: id(step.id), encounterId: input.encounterId, projectId: input.projectId, templateStep: `${template.id}:${step.id}`,
      label: step.label, ownerRole: step.ownerRole, ownerId: ownerFor(step.ownerRole, input.encounterId, input.roster),
      state: template.dependencies.some(([, to]) => to === step.id) ? "blocked" : "ready",
      plannedMinutes: step.plannedMinutes, expectedEvidence: step.expectedEvidence,
      expectedWindowMinutes: step.expectedWindowMinutes, kind: "operational", sourceIds: [input.sourceOrderId],
    })),
    dependencies: template.dependencies.map(([from, to]) => ({ id: `${id(from)}>${id(to)}`, from: id(from), to: id(to), kind: "finish_to_start" })),
  };
}
