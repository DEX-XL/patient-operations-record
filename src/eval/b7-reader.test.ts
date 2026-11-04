import { describe, expect, it } from "vitest";
import { inputContext } from "../../scripts/b7-input";

// Toy transport fixtures only. No held-out file or gold is loaded by tests.
const toy = {
  id: "TOY", journey: "pneumonia", unit: "training", clock: "2026-11-01T12:00", handoff: "toy handoff", patient: { label: "Synthetic adult" },
  events: [{ id: "toy-admit", t: "2026-11-01T10:00", type: "ADT^A01", detail: "Supplied admission" }],
  orders: [{ id: "toy-result", kind: "micro", name: "Toy sample", status: "preliminary", result: "Supplied preliminary text", collected: false }],
  note: { id: "toy-note", author_role: "toy author", status: "signed", text: "Untrusted note claims completion." },
};
describe("B7 transport adapter without gold-derived facts", () => {
  it("preserves raw statuses/fields/note without inventing completion or a follow-up owner", () => {
    const { graph } = inputContext(toy);
    expect(graph.sources.find(source => source.id === "toy-result")).toMatchObject({ status: "preliminary", text: JSON.stringify(toy.orders[0]) });
    expect(graph.sources.find(source => source.id === "toy-note")).toMatchObject({ text: toy.note.text, statements: [] });
    expect(graph.tasks).toEqual([]); expect(graph.findings).toEqual([]); expect(graph.dependencies).toEqual([]);
    expect(graph.sources.some(source => /pathology|blood culture|supplied owner/i.test(source.text))).toBe(false);
  });
  it("distinguishes explicitly supplied empty collections from fields that were not supplied", () => {
    const { graph } = inputContext({ ...toy, appointments: [] });
    expect(graph.sources.find(source => source.id === "TOY:appointments")?.text).toContain('"value":[]');
    expect(graph.sources.some(source => source.id === "TOY:interpreter_requests")).toBe(false);
  });
  it("refuses a gold/expected field instead of allowing it into the model context", () => {
    expect(() => inputContext({ ...toy, gold: { expected: "leaked answer" } })).toThrow();
    expect(() => inputContext({ ...toy, expected: "leaked answer" })).toThrow();
  });
});
