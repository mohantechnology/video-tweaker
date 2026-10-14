import { mp4MuxSelfCheck } from "./mp4-mux"
import { assembleDownloadSelfCheck, youtubeMediaSelfCheck } from "./youtube-media"

void (async () => {
  const errors = [...mp4MuxSelfCheck(), ...youtubeMediaSelfCheck(), ...(await assembleDownloadSelfCheck())]
  if (errors.length) {
    console.error(errors.join("\n"))
    process.exit(1)
  }
  console.log("youtube download checks passed")
})()
