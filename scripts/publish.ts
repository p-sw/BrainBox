#!/usr/bin/env bun
import { $ } from "bun";

await $`bun run build`;
await $`bun publish --access public`;
