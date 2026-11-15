/** Starts the sports + intramural background pollers once per Node.js server (src/server/pollers.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPollers } = await import("./server/pollers");
    startPollers();
  }
}
