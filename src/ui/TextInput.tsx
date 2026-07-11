import { useEffect, useState } from "react";
import { Text, useInput, useStdin } from "ink";
import { takePipedLine } from "@/ui/pipedStdin";

export interface TextInputProps {
  prompt: string;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
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
    return takePipedLine(stdin, onSubmit);
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
  // ponytail: remount-equivalent when prompt/initialValue change so multi-stage
  // forms (onboard name→seed, extras fields) don't leak the previous value.
  useEffect(() => {
    setValue(initialValue);
  }, [prompt, initialValue]);
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
