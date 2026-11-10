// StayHard widget loader for Scriptable.
// Paste this into Scriptable once. It downloads the latest StayHardWidget.js
// from GitHub Pages each time it runs, so widget changes never need a re-paste.
// If the download fails, it uses the last copy it saved on the phone.
const CODE_URL = "https://romkeymm.github.io/StayHard/StayHardWidget.js"
const fm = FileManager.local()
const cachePath = fm.joinPath(fm.documentsDirectory(), "stayhard-widget-cache.js")

let code
try {
  const req = new Request(CODE_URL + "?t=" + Date.now())
  req.timeoutInterval = 10
  code = await req.loadString()
  if (!code.includes("ListWidget")) throw new Error("bad download")
  fm.writeString(cachePath, code)
} catch (e) {
  code = fm.fileExists(cachePath) ? fm.readString(cachePath) : null
}

if (code) {
  await eval("(async () => {\n" + code + "\n})()")
} else {
  const w = new ListWidget()
  w.addText("StayHard: offline")
  Script.setWidget(w)
  Script.complete()
}
