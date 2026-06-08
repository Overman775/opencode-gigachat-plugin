import type { createOpencodeClient } from "@opencode-ai/sdk";

type OpencodeClientInstance = ReturnType<typeof createOpencodeClient>;
type LogLevel = "debug" | "info" | "warn" | "error";

class PluginLogger {
  private client: OpencodeClientInstance | null = null;

  setClient(client: OpencodeClientInstance) {
    this.client = client;
  }

  log(message: string, metadata?: any) {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: any) {
    this.write("warn", message, metadata);
  }

  error(message: string, metadata?: any) {
    this.write("error", message, metadata);
  }

  private write(level: LogLevel, message: string, metadata?: any) {
    const isDebug = process.env.GIGACHAT_DEBUG === "true" || process.env.OPENCODE_DEBUG === "true";

    if (isDebug) {
      const msg = `[GigaCode] [${level.toUpperCase()}] ${message}`;
      if (level === "error") {
        console.error(msg, metadata !== undefined ? metadata : "");
      } else if (level === "warn") {
        console.warn(msg, metadata !== undefined ? metadata : "");
      } else {
        console.log(msg, metadata !== undefined ? metadata : "");
      }
    }

    if (this.client) {
      // Ensure metadata is a plain object or undefined
      let metaObj: Record<string, unknown> | undefined;
      if (metadata !== undefined) {
        if (typeof metadata === "object" && metadata !== null) {
          metaObj = {};
          for (const key of Object.keys(metadata)) {
            const val = (metadata as any)[key];
            metaObj[key] = typeof val === "object" ? JSON.stringify(val) : val;
          }
        } else {
          metaObj = { value: String(metadata) };
        }
      }

      this.client.app.log({
        body: {
          service: "gigacode-plugin",
          level,
          message,
          extra: metaObj
        }
      }).catch(() => {
        // Silently catch logging API failures to prevent crash loops
      });
    }
  }
}

export const logger = new PluginLogger();
