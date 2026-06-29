import type { Brain } from "@/brain";
import type { BrainItemWithChannel } from "@/brain/manager";
import type { AvailabilityStatus } from "@/openrouter/schema";

export abstract class BaseChannel<
  BB extends BrainItemWithChannel = BrainItemWithChannel,
> {
  constructor(protected readonly brain: Brain<BB>) {}

  abstract init(brainbase: BrainItemWithChannel): Promise<void>;

  abstract send(text: string, opts?: { replyTo?: string }): Promise<void>;
  abstract setAvailability(status: AvailabilityStatus): Promise<void>;
}
