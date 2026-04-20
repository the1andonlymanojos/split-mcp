# splitwise-mcp

A small MCP server that lets an AI assistant (ChatGPT, Claude, Cursor, etc.) read and manage your Splitwise account in natural language: "what do I owe Alex this month?", "add ₹196 for groceries, split evenly with the roommates", "settle up with Priya".

## Why

Splitwise has a great data model but a clunky app for the things I actually do most often: quickly logging an expense mid-conversation, or asking a question about who owes what. An LLM with direct Splitwise access removes the tap-tap-tap and turns both into one sentence.

It is also a good excuse to build a real OAuth-backed MCP server end to end, Splitwise login and all, rather than a toy that hardcodes an API key.

## Run

```bash
bun install
bun run dev
```

Then point your MCP client at `http://localhost:3000/mcp`.
