// ponytail: one stdin drain for all interactive inputs so chained screens
// (Select → TextInput → …) share the same line queue under piped mode.

type Buffer = string[];
let pipedBuffer: Buffer | null = null;
let pipedCarry = "";
let pipedSubscribers: Array<(line: string) => void> = [];
let listening = false;

function flushSubscribers(): void {
  if (!pipedBuffer) return;
  while (pipedSubscribers.length > 0 && pipedBuffer.length > 0) {
    const next = pipedSubscribers.shift();
    if (!next) break;
    const line = pipedBuffer.shift();
    if (line === undefined) break;
    next(line);
  }
}

function ingestChunk(text: string): void {
  if (!pipedBuffer) return;
  const combined = pipedCarry + text;
  const parts = combined.split(/\r?\n/);
  // Last part is incomplete until a trailing newline arrives.
  pipedCarry = parts.pop() ?? "";
  for (const line of parts) {
    if (line.length > 0) pipedBuffer.push(line);
  }
}

function drainPiped(stdin: NodeJS.ReadStream): void {
  if (pipedBuffer !== null) return;
  const buf: Buffer = [];
  pipedBuffer = buf;
  const tryRead = (): void => {
    listening = false;
    let chunk: string | Buffer | null;
    while ((chunk = stdin.read()) !== null) {
      ingestChunk(chunk.toString());
    }
    flushSubscribers();
    if (!stdin.readableEnded && !listening) {
      listening = true;
      stdin.once("readable", tryRead);
      stdin.once("end", tryRead);
    } else if (stdin.readableEnded && pipedCarry.length > 0) {
      // Final line without trailing newline.
      buf.push(pipedCarry);
      pipedCarry = "";
      flushSubscribers();
    }
  };
  tryRead();
}

/** Subscribe for the next piped line. Returns unsubscribe. */
export function takePipedLine(
  stdin: NodeJS.ReadStream,
  onLine: (line: string) => void,
): () => void {
  drainPiped(stdin);
  pipedSubscribers.push(onLine);
  flushSubscribers();
  return () => {
    pipedSubscribers = pipedSubscribers.filter((s) => s !== onLine);
  };
}
