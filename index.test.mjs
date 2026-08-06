import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AssistantMessageComponent,
  discoverAndLoadExtensions,
  initTheme,
} from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("./index.ts", import.meta.url));
initTheme("dark", false);

async function emit(extension, type, event, context) {
  for (const handler of extension.handlers.get(type) ?? []) {
    await handler(event, context);
  }
}

function createContext() {
  const theme = {
    fg(_color, text) {
      return text;
    },
    italic(text) {
      return text;
    },
  };

  return {
    ui: {
      theme,
      setWorkingMessage() {},
    },
  };
}

test("keeps timing adjacent thinking blocks rendered under one collapsed label", async (t) => {
  const discoveryRoot = await mkdtemp(join(tmpdir(), "pi-thinking-timer-"));
  t.after(() => rm(discoveryRoot, { recursive: true, force: true }));

  const result = await discoverAndLoadExtensions(
    [extensionPath],
    discoveryRoot,
    join(discoveryRoot, "agent"),
  );
  assert.deepEqual(result.errors, []);

  const resolvedExtensionPath = await realpath(extensionPath);
  const extension = result.extensions.find(
    (candidate) => candidate.resolvedPath === resolvedExtensionPath,
  );
  assert.ok(extension, "thinking-timer extension should load");

  let now = 1_000;
  const originalDateNow = Date.now;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const context = createContext();
  const message = {
    role: "assistant",
    content: [{ type: "thinking", thinking: "First thought" }],
    timestamp: 42,
  };

  await emit(extension, "session_start", { type: "session_start", reason: "startup" }, context);

  try {
    await emit(
      extension,
      "message_update",
      {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "thinking_start",
          contentIndex: 0,
          partial: message,
        },
      },
      context,
    );

    const component = new AssistantMessageComponent(message, true);

    now = 14_100;
    await emit(
      extension,
      "message_update",
      {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "thinking_end",
          contentIndex: 0,
          content: "First thought",
          partial: message,
        },
      },
      context,
    );

    message.content.push({ type: "thinking", thinking: "Second thought" });
    now = 14_200;
    await emit(
      extension,
      "message_update",
      {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "thinking_start",
          contentIndex: 1,
          partial: message,
        },
      },
      context,
    );
    component.updateContent(message);

    now = 21_000;
    await emit(
      extension,
      "message_update",
      {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 1,
          delta: "Second thought",
          partial: message,
        },
      },
      context,
    );
    component.updateContent(message);

    const rendered = component.render(80).join("\n");
    assert.match(rendered, /Thinking\.\.\. 20\.0s/, rendered);

    message.content.push({ type: "text", text: "Answer" });
    now = 21_100;
    await emit(
      extension,
      "message_update",
      {
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: "text_start",
          contentIndex: 2,
          partial: message,
        },
      },
      context,
    );
    component.updateContent(message);

    now = 30_000;
    component.updateContent(message);
    const finalized = component.render(80).join("\n");
    assert.match(finalized, /Thinking\.\.\. 20\.1s/, finalized);
  } finally {
    await emit(
      extension,
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" },
      context,
    );
  }
});
