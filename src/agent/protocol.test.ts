import { describe, expect, it, vi } from "vitest";
import { agentRequest, consumeAgentResponse, newAgentState } from "./protocol";
import { validateBoundedRequest } from "./transport";
import { createToolHandler, promptContext } from "./tools";
import { devContext } from "@/eval/dev-context";
import { DEV_SCENARIOS } from "@/replay/scenarios";

const response = (output: Record<string, unknown>[]) => ({ id: "resp_mock", status: "completed", output });
const call = (name: string, args: unknown, call_id = "call_1") => ({ id: `fc_${call_id}`, type: "function_call", call_id, name, arguments: JSON.stringify(args), status: "completed" });
describe("Responses tool protocol without paid calls", () => {
  it("sets bounded, stateless serial Spark requests", () => {
    const { body, promptHash } = agentRequest(newAgentState({ synthetic: true }, 0), 1);
    expect(body).toMatchObject({ model: "muse-spark-1.3", store: false, tool_choice: "auto", parallel_tool_calls: false, max_output_tokens: 4096 });
    expect(body.include).toEqual(["reasoning.encrypted_content"]); expect(promptHash).toHaveLength(64);
    expect(validateBoundedRequest(body).model).toBe("muse-spark-1.3");
  });
  it("preserves encrypted reasoning, phase and matching call/output IDs", async () => {
    const state = newAgentState({ synthetic: true }, 0);
    const encrypted = { type: "reasoning", id: "rs_mock", encrypted_content: "opaque_test_cipher", summary: [] };
    const commentary = { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Inspecting supplied facts." }] };
    const handler = vi.fn(async () => ({ ok: true, result: { facts: [] } }));
    const next = await consumeAgentResponse(state, response([encrypted, commentary, call("get_notes", {})]), handler, 1);
    expect(next.input).toEqual(expect.arrayContaining([encrypted, commentary, expect.objectContaining({ type: "function_call", call_id: "call_1" }), expect.objectContaining({ type: "function_call_output", call_id: "call_1" })]));
    expect(next.status).toBe("ready"); expect(next.functions).toBe(1); expect(next.requests).toBe(1);
    expect(JSON.stringify(next.trace)).not.toContain("opaque_test_cipher");
    expect(validateBoundedRequest(agentRequest(next, 2).body)).toBeTruthy();
  });
  it("handles a plain text response without inventing a proposal", async () => {
    const tool = vi.fn();
    const next = await consumeAgentResponse(newAgentState({}, 0), response([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "No supported change." }] }]), tool, 1);
    expect(next.status).toBe("complete"); expect(tool).not.toHaveBeenCalled();
  });
  it("pairs malformed-JSON and unknown-tool errors for possible revision", async () => {
    const next = await consumeAgentResponse(newAgentState({}, 0), response([{ ...call("get_notes", {}), arguments: "{bad" }, call("write_order", {}, "call_2")]), vi.fn(), 1);
    expect(next.trace.every((trace) => !trace.ok)).toBe(true);
    expect(next.input.filter((item) => item.type === "function_call_output")).toHaveLength(2);
  });
  it("stops duplicate call IDs and missing encrypted reasoning before tool execution", async () => {
    const tool = vi.fn();
    const next = await consumeAgentResponse(newAgentState({}, 0), response([call("get_notes", {}), call("get_notes", {})]), tool, 1);
    expect(next.status).toBe("failed"); expect(tool).not.toHaveBeenCalled();
    expect((await consumeAgentResponse(newAgentState({}, 0), response([{ type: "reasoning", id: "rs_missing" }]), tool, 1)).status).toBe("failed");
  });
  it("enforces request, function, context and elapsed-time limits", async () => {
    expect(() => agentRequest({ ...newAgentState({}, 0), requests: 6 }, 1)).toThrow("RUN_EXHAUSTED");
    expect(() => agentRequest(newAgentState({}, 0), 90_001)).toThrow("RUN_EXHAUSTED");
    expect(() => newAgentState({ large: "x".repeat(17_000) })).toThrow("CONTEXT_TOO_LARGE");
    const tool = vi.fn();
    expect((await consumeAgentResponse({ ...newAgentState({}, 0), functions: 6 }, response([call("get_notes", {})]), tool, 1)).status).toBe("exhausted");
    expect(tool).not.toHaveBeenCalled();
  });
  it("stages only validated actions and rejects unsupported draft text with feedback", async () => {
    const { graph, actor, roster } = devContext(DEV_SCENARIOS[2]);
    const tools = createToolHandler({ graph, actor, roster, proposalId: "model-test" });
    const rejected = await tools.call("stage_document_draft", { draft_json: JSON.stringify({ kind: "handover", lines: [{ text: "Patient walked 400 feet.", sourceIds: [graph.sources[2].id] }] }) });
    expect(rejected.ok).toBe(false); expect(tools.getProposal()).toBeNull();
    const accepted = await tools.call("stage_document_draft", { draft_json: JSON.stringify({ kind: "handover", lines: [{ text: graph.sources[2].statements[0], sourceIds: [graph.sources[2].id] }] }) });
    expect(accepted.ok).toBe(true); expect(tools.getProposal()?.actions).toHaveLength(1);
    const next = await consumeAgentResponse(newAgentState(promptContext(graph, actor), 0), response([call("get_notes", {})]), tools.call, 1);
    expect(next.trace[0].ok).toBe(true);
  });
  it("does not assemble hidden note spans for a lab persona", () => {
    const { graph, roster } = devContext(DEV_SCENARIOS[2]);
    graph.sources[0].visibleTo = ["hospitalist", "charge_rn"];
    const context = promptContext(graph, roster.find((person) => person.role === "lab")!);
    expect(JSON.stringify(context)).not.toContain("f/u BCx");
  });
  it("forbids expensive models, extra tokens, built-ins and image/file input", () => {
    const body = agentRequest(newAgentState({}, 0), 1).body;
    expect(() => validateBoundedRequest({ ...body, model: "muse-wonder-1.0" })).toThrow("INVALID_OR_UNBOUNDED_REQUEST");
    expect(() => validateBoundedRequest({ ...body, max_output_tokens: 1_000_000 })).toThrow("INVALID_OR_UNBOUNDED_REQUEST");
    expect(() => validateBoundedRequest({ ...body, tools: [{ type: "web_search" }] })).toThrow("INVALID_OR_UNBOUNDED_REQUEST");
    expect(() => validateBoundedRequest({ ...body, input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/x.png" }] }] })).toThrow("NON_TEXT_INPUT_FORBIDDEN");
  });
});
