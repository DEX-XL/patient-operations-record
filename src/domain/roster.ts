import type { Person, Role } from "./types";

// Demo identities only. A persona is not authentication or hospital SSO.
const encounters = ["E-101", "E-201"];
export const DEMO_ROSTER: readonly Person[] = [
  { id: "rn-charge", role: "charge_rn", unitId: "UNIT-A", encounterIds: encounters },
  { id: "md-hospitalist", role: "hospitalist", unitId: "UNIT-A", encounterIds: encounters },
  { id: "lab-owner", role: "lab", unitId: "UNIT-A", encounterIds: encounters },
  { id: "cm-owner", role: "case_management", unitId: "UNIT-A", encounterIds: encounters },
  { id: "md-surgeon", role: "surgeon", unitId: "UNIT-A", encounterIds: ["E-101"] },
  { id: "rad-owner", role: "radiology", unitId: "UNIT-A", encounterIds: encounters },
  { id: "transport-owner", role: "transport", unitId: "UNIT-A", encounterIds: encounters },
  { id: "or-owner", role: "or", unitId: "UNIT-A", encounterIds: ["E-101"] },
  { id: "pharmacy-owner", role: "pharmacy", unitId: "UNIT-A", encounterIds: encounters },
  { id: "evs-owner", role: "evs", unitId: "UNIT-A", encounterIds: encounters },
];
export function ownerFor(role: Role, encounterId: string, roster: readonly Person[] = DEMO_ROSTER) {
  const owner = roster.find((person) => person.role === role && person.encounterIds.includes(encounterId));
  if (!owner) throw new Error("NO_ASSIGNED_OWNER");
  return owner.id;
}
