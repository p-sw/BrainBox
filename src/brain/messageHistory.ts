export type MessageSender = "persona" | "user";

export interface MessageHistoryEntry {
  sender: MessageSender;
  time: Date;
  content: string;
}

function formatTime(time: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(
    time.getDate(),
  )} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

export function translateMessageHistory(
  personaName: string,
  entries: ReadonlyArray<MessageHistoryEntry>,
): string {
  return entries
    .map((entry) => {
      const label = entry.sender === "persona" ? personaName : "사용자";
      return `${label}@${formatTime(entry.time)}: ${entry.content}`;
    })
    .join("\n");
}
