import { logger } from "@/utils/logger";

interface GreetOptions {
  uppercase?: boolean;
  count?: string;
}

export function greet(name: string, options: GreetOptions) {
  const message = `Hello, ${name}!`;
  const output = options.uppercase ? message.toUpperCase() : message;
  const count = Math.max(1, parseInt(options.count ?? "1", 10));

  for (let i = 0; i < count; i++) {
    logger.success(output);
  }
}
