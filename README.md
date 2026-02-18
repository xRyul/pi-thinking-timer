# pi-thinking-timer

![Thinking Timer demo](https://raw.githubusercontent.com/xRyul/pi-thinking-timer/main/assets/demo.gif)

A small **pi** extension that shows a live timer next to the collapsed **Thinking** label.

Instead of only:

```
Thinking...
```

you’ll see something like:

```
Thinking... 6.5s
```

It updates live while the model is thinking and leaves the final duration when thinking ends.

> Note: This extension patches pi’s internal `AssistantMessageComponent` render/update behavior.
> If pi changes its internal UI structure, the extension may stop working (it should fail safely and simply show the default `Thinking...` text).

## Install

### Option A: Install from npm (recommended)

```bash
pi install npm:pi-thinking-timer
```

Then restart `pi` (or run `/reload`) and ensure the extension is enabled (use `pi config` if you manage resources explicitly).

### Option B: Try without installing (temporary)

```bash
pi -e npm:pi-thinking-timer
```

### Option C: Install from GitHub

```bash
pi install git:github.com/xRyul/pi-thinking-timer
```

## Usage

1. Use a model/thinking level that produces thinking blocks.
2. Collapse/expand thinking blocks with **Ctrl+T**.
3. When collapsed, the label will show the elapsed time.

There are no settings.

## Development

Clone and run pi with the local extension file:

```bash
git clone https://github.com/xRyul/pi-thinking-timer
cd pi-thinking-timer
pi -e ./thinking-timer.ts
```

## License

MIT
