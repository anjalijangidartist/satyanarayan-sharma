#!/usr/bin/env node
"use strict";

const { hashPassword } = require("../lib/auth");

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Run this command in a terminal, or pass the password as an argument."));
      return;
    }
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdin.on("data", onData);
  });
}

async function main() {
  let password = process.argv[2];
  if (!password) {
    password = await promptHidden("Password: ");
    const confirm = await promptHidden("Confirm password: ");
    if (password !== confirm) throw new Error("Passwords did not match.");
  }
  if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
  const hash = await hashPassword(password);
  process.stdout.write(`\nPORTAL_PASSWORD_HASH=${hash}\n`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
