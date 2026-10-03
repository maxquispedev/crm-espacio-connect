/** Fixture H.264 sintética del self-test 020. Solo tests, nunca runtime/upload. */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function generateCommercialVideo() {
  const directory = await mkdtemp(path.join(tmpdir(), "commercial-e2e-video-"));
  const file = path.join(directory, "synthetic-demo.mp4");
  try {
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "color=c=blue:s=160x120:r=10", "-t", "1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-y", file]);
  } catch {
    throw new Error("Fixture MP4 pendiente: ffmpeg con libx264 no disponible. Instalar en el entorno de pruebas; no se añade al runtime");
  }
  return file;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log(await generateCommercialVideo());
}
