import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { takePipedLine } from "@/ui/pipedStdin";

export interface SelectProps {
  prompt?: string;
  items: string[];
  /** Visible rows. Default 8. */
  limit?: number;
  onSelect: (value: string) => void;
}

export function filterItems(items: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.toLowerCase().includes(q));
}

/** Keep cursor roughly centered in a scrolling window. */
export function windowStart(
  cursor: number,
  total: number,
  limit: number,
): number {
  if (total <= limit) return 0;
  return Math.max(0, Math.min(cursor - Math.floor(limit / 2), total - limit));
}

function resolvePiped(items: string[], line: string): string | undefined {
  if (items.includes(line)) return line;
  const exact = items.find((i) => i.toLowerCase() === line.toLowerCase());
  if (exact) return exact;
  const filtered = filterItems(items, line);
  if (filtered.length === 1) return filtered[0];
  return undefined;
}

function PipedSelect({
  prompt = "",
  items,
  onSelect,
  stdin,
}: SelectProps & { stdin: NodeJS.ReadStream }): React.ReactElement {
  useEffect(() => {
    return takePipedLine(stdin, (line) => {
      const match = resolvePiped(items, line.trim());
      if (match) onSelect(match);
    });
  }, [stdin, onSelect, items]);

  return (
    <Box flexDirection="column">
      <Text>
        {prompt}
        <Text dimColor>(piped)</Text>
      </Text>
      <Text dimColor>
        matches ({items.length}/{items.length}):
      </Text>
      {items.slice(0, 8).map((item) => (
        <Text key={item}>  {item}</Text>
      ))}
    </Box>
  );
}

function RawSelect({
  prompt = "",
  items,
  limit = 8,
  onSelect,
}: SelectProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const filtered = useMemo(() => filterItems(items, query), [items, query]);
  const active = Math.min(cursor, Math.max(0, filtered.length - 1));
  const start = windowStart(active, filtered.length, limit);
  const visible = filtered.slice(start, start + limit);

  useInput((input, key) => {
    if (key.return) {
      const item = filtered[active];
      if (item) onSelect(item);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, Math.min(c, filtered.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) =>
        Math.min(filtered.length - 1, Math.min(c, filtered.length - 1) + 1),
      );
      return;
    }
    if (key.pageUp) {
      setCursor((c) => Math.max(0, Math.min(c, filtered.length - 1) - limit));
      return;
    }
    if (key.pageDown) {
      setCursor((c) =>
        Math.min(filtered.length - 1, Math.min(c, filtered.length - 1) + limit),
      );
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
      return;
    }
    if (key.ctrl && input === "c") {
      process.exit(130);
    }
    if (input.length > 0 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        {prompt}
        {query}
        <Text color="cyan">|</Text>
      </Text>
      <Text dimColor>
        matches ({filtered.length}/{items.length}) · ↑↓ · type to filter · enter
      </Text>
      {filtered.length === 0 ? (
        <Text dimColor>  (no matches)</Text>
      ) : (
        <>
          {start > 0 && <Text dimColor>  …</Text>}
          {visible.map((item, i) => {
            const idx = start + i;
            const selected = idx === active;
            return (
              <Text key={item} color={selected ? "cyan" : undefined}>
                {selected ? "> " : "  "}
                {item}
              </Text>
            );
          })}
          {start + visible.length < filtered.length && (
            <Text dimColor>  …</Text>
          )}
        </>
      )}
    </Box>
  );
}

export function Select(props: SelectProps): React.ReactElement {
  const { isRawModeSupported, stdin } = useStdin();
  if (!isRawModeSupported) return <PipedSelect {...props} stdin={stdin} />;
  return <RawSelect {...props} />;
}
