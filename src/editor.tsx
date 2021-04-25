import jsx from "./jsx"
import * as Y from "yjs"
import { monaco, languages } from "./monaco"
import MonacoBinding from "./y-monaco"
import * as  yawareness from "y-protocols/awareness"
import { randomRgb } from "./utils"
import { setupWebrtc } from "./webrtc"

export async function start(clientId: string, roomId: string, container: HTMLDivElement) {

  const color = randomRgb()
  const name = clientId.substr(0, 4)
  let ext = "txt"

  const box: HTMLElement =
    <div className="tool-box">
      <span>Room {roomId}</span>
      {<select onchange={(e: any) => {
        monaco.editor.setModelLanguage(editor.getModel()!, e.target.value)
        const lang = monaco.languages.getLanguages().find(x => x.id === e.target.value)
        if (lang?.extensions) ext = lang.extensions[0]
      }}>
        {languages.map(x =>
          <option value={x.id}>
            {x.aliases && x.aliases[0] || x.id}
          </option>)}
      </select>}
      <input type="text" value={name} placeholder="Dislay name" onchange={(e: any) => {
        awareness.setLocalStateField("name", e.target.value || name)
      }} />
      <input type="color" value={color} onchange={(e: any) => {
        if (/#[0-9a-fA-F]{6}/.test(e.target.value))
          awareness.setLocalStateField("color", e.target.value)
      }} />
    </div>

  container.appendChild(box)

  const wrapper: HTMLElement = <div className="editor" />
  const editor = monaco.editor.create(wrapper)

  container.appendChild(wrapper)

  setTimeout(() => editor.layout())
  window.addEventListener("resize", () => editor.layout())

  const doc = new Y.Doc()
  const awareness = new yawareness.Awareness(doc)
  awareness.setLocalState({ name, clientId, color })

  new MonacoBinding(doc.getText(), editor, awareness)

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, () => {
    const text = doc.getText().toString()
    const filename = `Room ${roomId}.${ext}`
    const file = new File([new Blob([text])], filename)
    const url = URL.createObjectURL(file)
    const a: HTMLAnchorElement = <a href={url} download={filename} />
    a.click()
    URL.revokeObjectURL(url)
  })

  setupWebrtc(roomId, clientId, doc, awareness)
}
