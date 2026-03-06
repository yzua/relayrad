import { parseRelayList } from "./relay-parser";
import type { RelayRecord } from "./relay-types";

export async function loadRelaysFromMullvadCli(): Promise<RelayRecord[]> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;

  try {
    proc = Bun.spawn(["mullvad", "relay", "list"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new Error(formatSpawnError(error));
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `mullvad relay list failed (exit ${exitCode}): ${stderr.trim() || "no stderr output"}`,
    );
  }

  if (stdout.trim().length === 0) {
    throw new Error("mullvad relay list failed: command returned empty output");
  }

  const relays = parseRelayList(stdout);
  if (relays.length === 0) {
    throw new Error(
      "mullvad relay list failed: output format is unsupported or malformed",
    );
  }

  return relays;
}

function formatSpawnError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "mullvad relay list failed: unable to start process";
  }

  const lowerMessage = error.message.toLowerCase();
  if (
    lowerMessage.includes("enoent") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("no such file")
  ) {
    return "mullvad relay list failed: `mullvad` command not found in PATH";
  }

  return `mullvad relay list failed: ${error.message}`;
}
