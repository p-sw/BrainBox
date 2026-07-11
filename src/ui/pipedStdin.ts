// ponytail: one stdin drain for all interactive inputs so chained screens
// (Select → TextInput → …) share the same line queue under piped mode.

type Buffer = string[];
let pipedBuffer: Buffer | null = null;
let pipedSubscribers: Array<(line: string) => void> = [];

function drainPiped(stdin: NodeJS.ReadStream): void {
  if (pipedBuffer !== null) return;
  const buf: Buffer = [];
  pipedBuffer = buf;
  const tryRead = (): void => {
    let chunk: string | Buffer | null;
    while ((chunk = stdin.read()) !== null) {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) buf.push(line);
      }
    }
    if (buf.length === 0) {
      stdin.once("readable", tryRead);
      stdin.once("end", tryRead);
      return;
    }
    while (pipedSubscribers.length > 0 && buf.length > 0) {
      const next = pipedSubscribers.shift();
      if (!next) break;
      const line = buf.shift();
      if (line === undefined) break;
      next(line);
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
  if (pipedBuffer && pipedBuffer.length > 0) {
    const line = pipedBuffer.shift();
    if (line !== undefined) onLine(line);
  }
  return () => {
    pipedSubscribers = pipedSubscribers.filter((s) => s !== onLine);
  };
}
