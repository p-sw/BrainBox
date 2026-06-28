import type { Brain } from "@/brain";
import type { AvailabilityStatus } from "@/openrouter/schema";

export interface BaseChannel {
  readonly brain: Brain;

  init(): Promise<void>;

  send(text: string, opts?: { replyTo?: string }): Promise<void>;
  setAvailability(status: AvailabilityStatus): Promise<void>;
}
