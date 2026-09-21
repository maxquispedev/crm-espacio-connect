import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_DELAY_MS,
  MAX_FOLLOW_UP_ATTEMPTS,
  MAX_RUN_ATTEMPTS,
  classifyFollowUpReason,
  hasMoreCommercialAttempts,
  nextFollowUpDelay,
  shouldReactivateDormant,
  shouldStartFollowUp,
} from "@/server/sales/follow-ups/policy";

const HOUR = 60 * 60 * 1000;

const auto = {
  lane: "auto" as const,
  nextAction: "ask_more_questions" as const,
  shouldReply: true,
};

describe("política de follow-ups", () => {
  it("cadencias awaiting_reply 6h → +18h → +48h", () => {
    expect(FOLLOW_UP_DELAY_MS.awaiting_reply[1]).toBe(6 * HOUR);
    expect(FOLLOW_UP_DELAY_MS.awaiting_reply[2]).toBe(18 * HOUR);
    expect(FOLLOW_UP_DELAY_MS.awaiting_reply[3]).toBe(48 * HOUR);
    expect(nextFollowUpDelay("awaiting_reply", 1)).toBe(6 * HOUR);
    expect(nextFollowUpDelay("awaiting_reply", 2)).toBe(18 * HOUR);
    expect(nextFollowUpDelay("awaiting_reply", 3)).toBe(48 * HOUR);
  });

  it("cadencias after_demo y after_price 20h → +52h → +96h", () => {
    expect(FOLLOW_UP_DELAY_MS.after_demo).toEqual(FOLLOW_UP_DELAY_MS.after_price);
    expect(nextFollowUpDelay("after_demo", 1)).toBe(20 * HOUR);
    expect(nextFollowUpDelay("after_demo", 2)).toBe(52 * HOUR);
    expect(nextFollowUpDelay("after_price", 3)).toBe(96 * HOUR);
  });

  it("máximo 3 intentos comerciales; scheduled_wait no encadena", () => {
    expect(MAX_FOLLOW_UP_ATTEMPTS).toBe(3);
    expect(hasMoreCommercialAttempts("awaiting_reply", 1)).toBe(true);
    expect(hasMoreCommercialAttempts("awaiting_reply", 2)).toBe(true);
    expect(hasMoreCommercialAttempts("awaiting_reply", 3)).toBe(false);
    expect(hasMoreCommercialAttempts("scheduled_wait", 1)).toBe(false);
    expect(nextFollowUpDelay("scheduled_wait", 1)).toBeNull();
    expect(nextFollowUpDelay("awaiting_reply", 4)).toBeNull();
  });

  it("retries técnicos tope 3, distintos del intento comercial", () => {
    expect(MAX_RUN_ATTEMPTS).toBe(3);
  });

  it("clasifica present_price / demos / resto", () => {
    expect(
      classifyFollowUpReason({ ...auto, lane: "auto_close", nextAction: "present_price" })
    ).toBe("after_price");
    expect(
      classifyFollowUpReason({ ...auto, nextAction: "show_operations_demo" })
    ).toBe("after_demo");
    expect(
      classifyFollowUpReason({
        ...auto,
        nextAction: "show_online_enrollment_demo",
      })
    ).toBe("after_demo");
    expect(classifyFollowUpReason(auto)).toBe("awaiting_reply");
    expect(
      classifyFollowUpReason({ ...auto, lane: "human", nextAction: "schedule_call" })
    ).toBeNull();
  });

  it("START solo AUTO/AUTO_CLOSE con reply; no HUMAN/STOP/WAIT ni sin reply", () => {
    expect(shouldStartFollowUp(auto)).toBe(true);
    expect(shouldStartFollowUp({ ...auto, lane: "auto_close" })).toBe(true);
    expect(shouldStartFollowUp({ ...auto, shouldReply: false })).toBe(false);
    expect(shouldStartFollowUp({ ...auto, lane: "human" })).toBe(false);
    expect(shouldStartFollowUp({ ...auto, lane: "stop" })).toBe(false);
    expect(shouldStartFollowUp({ ...auto, lane: "wait" })).toBe(false);
  });

  it("DORMANT se reactiva solo con pipeline open", () => {
    expect(
      shouldReactivateDormant({
        lane: "stop",
        followUpReason: "no_reply_exhausted",
        pipelineKind: "open",
      })
    ).toBe(true);
    expect(
      shouldReactivateDormant({
        lane: "stop",
        followUpReason: "no_reply_exhausted",
        pipelineKind: "lost",
      })
    ).toBe(false);
    expect(
      shouldReactivateDormant({
        lane: "stop",
        followUpReason: "disqualified",
        pipelineKind: "open",
      })
    ).toBe(false);
    expect(
      shouldReactivateDormant({
        lane: "human",
        followUpReason: "no_reply_exhausted",
        pipelineKind: "open",
      })
    ).toBe(false);
  });
});
