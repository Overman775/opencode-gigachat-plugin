#!/usr/bin/env node

import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("\n=== GigaChat Credentials Encoder ===");
console.log("This script helps you generate the Base64 credentials string for your GigaCode plugin\n");

rl.question("Enter your Sber Studio Client ID: ", (clientId) => {
  rl.question("Enter your Sber Studio Client Secret: ", (clientSecret) => {
    const rawCreds = `${clientId.trim()}:${clientSecret.trim()}`;
    const base64Creds = Buffer.from(rawCreds).toString("base64");
    
    console.log("\n--- Generated Base64 Credentials ---");
    console.log(base64Creds);
    console.log("\n--- Add these options directly into your ~/.config/opencode/opencode.json file ---");
    console.log(JSON.stringify({
      provider: {
        gigacode: {
          options: {
            baseURL: "https://api.gigachat.local/v1",
            credentials: base64Creds,
            scope: "GIGACHAT_API_PERS"
          }
        }
      }
    }, null, 2));
    console.log("\n====================================\n");
    
    rl.close();
  });
});
