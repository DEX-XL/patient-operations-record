import { describe, expect, it } from "vitest";
import { normalizeHl7Sample, normalizeJson } from "./events";
import { advanceClock, controlClock, newClock, orderedEvents } from "./clock";
import { demoEvents, DEV_SCENARIOS } from "./scenarios";

// Generated from a narrow documented sample profile; never real hospital data.
function hl7(type: string, status = "P") {
  const msh = ["MSH", "^~\\&", "SYNTHETIC_DEMO", "DEMO", "REPLAY", "DEMO", "20261029070000", "", type, "sample-1", "T", "2.5.1"].join("|");
  const pv1 = Array<string>(20).fill(""); pv1[0] = "PV1"; pv1[2] = "I"; pv1[3] = "UNIT-A^101"; pv1[19] = "E-101";
  const obx = Array<string>(12).fill(""); obx[0] = "OBX"; obx[1] = "1"; obx[2] = "TX"; obx[3] = "BCX^Synthetic blood culture"; obx[5] = "Status only; no interpretation"; obx[11] = status;
  return [msh, "PID|1||P-101^^^SYNTHETIC", pv1.join("|"), "OBR|1||existing-order", obx.join("|"), "SCH|existing-or-slot"].join("\r");
}

describe("synthetic normalization", () => {
  it("keeps preliminary and final results distinct on the same order", () => {
    const pre = normalizeHl7Sample(hl7("ORU^R01", "P"), 100);
    const final = normalizeHl7Sample(hl7("ORU^R01", "F"), 200);
    expect(pre.status).toBe("preliminary"); expect(final.status).toBe("final");
    expect(pre.subjectId).toBe(final.subjectId);
  });
  it("does not silently promote absent/unknown result status", () => {
    expect(() => normalizeHl7Sample(hl7("ORU^R01", ""), 100)).toThrow("SAMPLE_RESULT_STATUS_REQUIRED");
    expect(() => normalizeHl7Sample(hl7("ORU^R01", "C"), 100)).toThrow("SAMPLE_RESULT_STATUS_REQUIRED");
  });
  it("normalizes admission, transfer and discharge notification without inferring vacancy", () => {
    expect(normalizeHl7Sample(hl7("ADT^A01"), 0).type).toBe("admit");
    expect(normalizeHl7Sample(hl7("ADT^A02"), 0).type).toBe("transfer");
    expect(normalizeHl7Sample(hl7("ADT^A03"), 0).type).toBe("discharge_notification");
  });
  it("recognizes existing appointment booking and rescheduling only", () => {
    expect(normalizeHl7Sample(hl7("SIU^S12"), 0).label).toContain("booked");
    expect(normalizeHl7Sample(hl7("SIU^S13"), 0).label).toContain("rescheduled");
    expect(() => normalizeHl7Sample(hl7("SIU^S99"), 0)).toThrow("UNSUPPORTED_HL7_SAMPLE_TYPE");
  });
  it("rejects unmarked senders, nonsynthetic identities and unsupported types", () => {
    expect(() => normalizeHl7Sample(hl7("ADT^A01").replace("SYNTHETIC_DEMO", "REAL_FEED"), 0)).toThrow("SYNTHETIC_SAMPLE_CONTRACT_REQUIRED");
    expect(() => normalizeHl7Sample(hl7("ADT^A01").replace("P-101", "NAME_REAL"), 0)).toThrow();
    expect(() => normalizeHl7Sample(hl7("MDM^T02"), 0)).toThrow("UNSUPPORTED_HL7_SAMPLE_TYPE");
  });
  it("does not discard a second observation silently", () => expect(() => normalizeHl7Sample(hl7("ORU^R01") + "\rOBX|2|TX|X||other||||||P", 0)).toThrow("SINGLE_OBSERVATION_SAMPLE_REQUIRED"));
  it("validates source spans rather than accepting dangling/out-of-range citations", () => {
    const signout = demoEvents().find((event) => event.spans)!;
    expect(() => normalizeJson({ ...signout, spans: [{ id: "bad", start: 0, end: 100_000 }] })).toThrow("INVALID_NOTE_SPAN");
    expect(() => normalizeJson({ ...signout, synthetic: false })).toThrow();
  });
  it("parses all six independent dev cases and both demo journeys", () => {
    expect(DEV_SCENARIOS.map((scenario) => scenario.id)).toHaveLength(6);
    expect(DEV_SCENARIOS.filter((scenario) => scenario.id.includes("appendicitis"))).toHaveLength(2);
    expect(DEV_SCENARIOS.filter((scenario) => scenario.id.includes("pneumonia"))).toHaveLength(2);
    expect(DEV_SCENARIOS.filter((scenario) => scenario.id.includes("heart-failure"))).toHaveLength(2);
    expect(new Set(demoEvents().map((event) => event.patientId))).toEqual(new Set(["P-101", "P-201"]));
    expect(demoEvents().every((event) => normalizeJson(event).synthetic)).toBe(true);
  });
});

describe("replay clock", () => {
  it("never advances while paused", () => {
    const result = advanceClock(newClock(42, 0), demoEvents(), 10_000);
    expect(result.applied).toEqual([]); expect(result.clock.simulatedMs).toBe(0);
  });
  it.each([1, 60, 2000] as const)("honors the %sx preset", (speed) => {
    const events = demoEvents();
    let clock = controlClock(newClock(42, 0), events, speed, 0).clock;
    clock = controlClock(clock, events, "play", 0).clock;
    expect(advanceClock(clock, events, 10).clock.simulatedMs).toBe(10 * speed);
  });
  it("pauses exactly on a trigger even after a long polling delay", () => {
    const events = demoEvents();
    const clock = { ...newClock(42, 0), playing: true, speed: 2000 as const, pauseReason: null };
    const result = advanceClock(clock, events, 100_000);
    expect(result.clock.pauseReason).toBe("trigger"); expect(result.clock.playing).toBe(false);
    expect(result.applied.at(-1)?.id).toBe("a-proposal-trigger");
    expect(result.applied.some((event) => event.id === "a-or-moved")).toBe(false);
    expect(result.clock.simulatedMs).toBe(130 * 60_000);
  });
  it("resumes beyond an already consumed trigger without replaying it", () => {
    const events = demoEvents();
    let result = advanceClock({ ...newClock(42, 0), playing: true, speed: 2000 }, events, 100_000);
    const seen = [...result.applied];
    result = controlClock(result.clock, events, "play", 100_000);
    result = advanceClock(result.clock, events, 200_000); seen.push(...result.applied);
    expect(result.applied.at(-1)?.id).toBe("p-night-signout");
    expect(new Set(seen.map((event) => event.id)).size).toBe(seen.length);
  });
  it("steps a single event and remains paused", () => {
    const result = controlClock(newClock(42, 0), demoEvents(), "step", 0);
    expect(result.applied).toHaveLength(1); expect(result.clock.cursor).toBe(1); expect(result.clock.playing).toBe(false);
  });
  it("does not count paused wall time after resuming", () => {
    const events = demoEvents();
    let clock = controlClock(newClock(42, 0), events, "play", 1000).clock;
    expect(advanceClock(clock, events, 1100).clock.simulatedMs).toBe(100);
  });
  it("is deterministic by seed and independent of file input order", () => {
    expect(orderedEvents(demoEvents(), 82)).toEqual(orderedEvents(demoEvents().reverse(), 82));
    const events = demoEvents(); const clock = { ...newClock(82, 0), playing: true, speed: 2000 as const };
    expect(advanceClock(clock, events, 100_000)).toEqual(advanceClock(clock, events, 100_000));
  });
  it("completes 48h in 86.4s at 2000x when triggers are disabled for timing measurement", () => {
    const events = demoEvents().map((event) => ({ ...event, trigger: false }));
    const clock = { ...newClock(1, 0), playing: true, speed: 2000 as const };
    const result = advanceClock(clock, events, 86_400);
    expect(result.clock.simulatedMs).toBe(48 * 60 * 60_000); expect(result.clock.pauseReason).toBe("complete");
    expect(result.applied).toHaveLength(events.length);
  });
  it("rejects reversed time, unsupported speed and duplicate event IDs", () => {
    expect(() => advanceClock(newClock(1, 10), [], 9)).toThrow("CLOCK_MOVED_BACKWARD");
    expect(() => controlClock(newClock(1, 0), [], 99 as 1, 0)).toThrow("INVALID_REPLAY_SPEED");
    const event = demoEvents()[0]; expect(() => orderedEvents([event, event], 1)).toThrow("DUPLICATE_EVENT_ID");
  });
});
