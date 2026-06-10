import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerEditTool } from "./src/edit";
import { registerReadTool } from "./src/read";
import { registerUndoTool, setCurrentTurn } from "./src/undo";
import { registerWriteTool } from "./src/write";

export default function (pi: ExtensionAPI): void {
  registerReadTool(pi);
  registerEditTool(pi);
  registerWriteTool(pi);
  registerUndoTool(pi);

  pi.on("turn_start", async (event) => {
    setCurrentTurn(event.turnIndex);
  });

  const debugValue = process.env.PI_HASHLINE_DEBUG;
  if (debugValue === "1" || debugValue === "true") {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("Hashline Edit mode active", "info");
    });
  }
}
