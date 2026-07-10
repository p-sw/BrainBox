import { useEffect, useState } from "react";
import { Text, useInput, useStdin } from "ink";

export interface TextInputProps {
  prompt: string;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

// ponytail: piped mode (no TTY) drains the entire stdin buffer up front
// and hands one line at a time to whichever TextInput is mounted.
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

function PipedInput({
  prompt,
  initialValue = "",
  placeholder = "",
  onSubmit,
  stdin,
}: TextInputProps & { stdin: NodeJS.ReadStream }): React.ReactElement {
  const [value] = useState(initialValue);
  useEffect(() => {
    drainPiped(stdin);
    pipedSubscribers.push(onSubmit);
    // ponytail: if buffer already holds lines, fire newest subscriber
    // immediately so validation-error re-prompts do not deadlock.
    if (pipedBuffer && pipedBuffer.length > 0) {
      const line = pipedBuffer.shift();
      if (line !== undefined) onSubmit(line);
    }
    return () => {
      pipedSubscribers = pipedSubscribers.filter((s) => s !== onSubmit);
    };
  }, [stdin, onSubmit]);
  const shown = value.length > 0 ? value : placeholder;
  return (
    <Text>
      {prompt}
      {shown.length > 0 ? shown : <Text dimColor>{placeholder}</Text>}
    </Text>
  );
}

function RawInput({
  prompt,
  initialValue = "",
  placeholder = "",
  onSubmit,
}: TextInputProps): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "c") {
      process.exit(130);
    }
    if (input.length > 0 && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });
  const shown = value.length > 0 ? value : placeholder;
  return (
    <Text>
      {prompt}
      {shown.length > 0 ? shown : <Text dimColor>{placeholder}</Text>}
      <Text color="cyan">|</Text>
    </Text>
  );
}

// ponytail: branch on raw-mode support so ink useInput is never mounted
// on a non-TTY stdin (which would crash inside App.setRawMode).
export function TextInput(props: TextInputProps): React.ReactElement {
  const { isRawModeSupported, stdin } = useStdin();
  if (!isRawModeSupported) return <PipedInput {...props} stdin={stdin} />;
  return <RawInput {...props} />;
}
