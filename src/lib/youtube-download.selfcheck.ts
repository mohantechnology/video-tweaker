import { mp4MuxSelfCheck } from "./mp4-mux"
import { youtubeMediaSelfCheck } from "./youtube-media"

const errors = [...mp4MuxSelfCheck(), ...youtubeMediaSelfCheck()]
if (errors.length) {
  console.error(errors.join("\n"))
  process.exit(1)
}
console.log("youtube download checks passed")
