# ChatLLM

A local web chat UI for [Ollama](https://ollama.com) — pick a model, chat, attach images or
text/code files, and keep your conversation history. Launches with one command.

## Requirements

- [Ollama](https://ollama.com) installed and running (`ollama serve`, or just open the app)
- At least one model pulled, e.g. `ollama pull llama3.2`
- For image understanding, pull a vision model, e.g. `ollama pull llava`
- Node.js 18+

## Run it from the terminal

You don't need to install anything globally — `server.js` is a self-contained Node script
with a `bin` entry, so the usual `npx`-style workflows all work.

**Run it directly from GitHub (no clone needed):**

```sh
npx github:ephraimemad/ChatLLM
```

`npx` fetches the repo, installs its (zero) dependencies, and runs the `llm-chat` bin —
which starts the server and opens your browser at `http://localhost:3000` (or the next
free port).

**Clone it and run from the project directory:**

```sh
git clone https://github.com/ephraimemad/ChatLLM.git
cd ChatLLM
npm start        # same as: node server.js
# or, equivalently:
npx .
```

**Use a custom port or a remote Ollama host:**

```sh
PORT=4000 OLLAMA_URL=http://localhost:11434 npx github:ephraimemad/ChatLLM
```

- `PORT` — preferred port to bind to (defaults to `3000`, auto-increments if taken)
- `OLLAMA_URL` — where Ollama is reachable (defaults to `http://localhost:11434`)

Once running, the server prints the URL it's listening on and where conversation
history is stored, and opens the UI in your default browser automatically.

## Features

- **Model picker** — lists every model you've pulled into Ollama
- **Streaming chat** — responses render token-by-token
- **Attachments** — drag & drop or pick images (sent inline for vision models like `llava`) or
  text/code files (their contents are appended to your message as a fenced block)
- **History** — conversations are saved to `~/.llm-chat/conversations.json`, listed in the
  sidebar, and can be reopened or deleted

## Notes

- This is a local single-user tool: it binds to `localhost` only, with no authentication.
- PDFs and other binary documents aren't parsed — only images and plain text/code files.
- Image understanding requires a vision-capable model; text models will ignore attached images.
