import type { Brain } from "@/brain";
import type { AvailabilityStatus } from "@/openrouter/schema";

export abstract class BaseChannel {
  constructor(public readonly brain: Brain) {}

  abstract init(): Promise<void>;

  abstract send(text: string, opts?: { replyTo?: string }): Promise<void>;

  abstract setAvailability(status: AvailabilityStatus): Promise<void>;
}