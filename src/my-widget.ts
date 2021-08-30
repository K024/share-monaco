import { editor, IDisposable, ISelection, Selection } from "monaco-editor"
import { randomHsl } from "./utils"
import { monaco } from "./monaco"

export default class MyWidget implements editor.IContentWidget {

  id = Math.random().toString(36).substr(2)

  decorationClassName = "my-widget-decoration-" + this.id

  allowEditorOverflow = false
  suppressMouseDown = true

  el = document.createElement("div")
  labelEl = document.createElement("div")
  styleEl = document.createElement("style")

  decorations: string[] = []
  selection: Selection
  lineHeight = 0

  disposes: IDisposable[] = []

  color = ""
  label = ""

  constructor(
    readonly editor: editor.ICodeEditor,
    label: string,
    color = randomHsl()) {

    MyWidget.addGlobalCss()

    this.selection = monaco.Selection.liftSelection({
      selectionStartLineNumber: 1,
      selectionStartColumn: 1,
      positionColumn: 1,
      positionLineNumber: 1
    })

    const updateHeight = () => {
      const lineHeight = editor.getOptions().get(monaco.editor.EditorOptions.lineHeight.id)
      if (lineHeight !== this.lineHeight) {
        this.lineHeight = lineHeight
        this.updateLabel()
      }
    }
    updateHeight()
    this.disposes.push(editor.onDidChangeConfiguration(updateHeight))

    this.el.className = "share-monaco-widget-cursor"
    this.labelEl.innerText = label
    this.labelEl.className = "share-monaco-widget-label"
    this.el.appendChild(this.labelEl)

    let showTimeout: any
    this.el.addEventListener("pointerenter", () => {
      clearTimeout(showTimeout)
      this.labelEl.classList.add("show")
      showTimeout = setTimeout(() => {
        this.labelEl.classList.remove("show")
      }, 1300)
    })

    document.head.appendChild(this.styleEl)
    this.disposes.push({
      dispose: () => { document.head.removeChild(this.styleEl) }
    })

    this.setColor(color)
    this.setLabel(label)

    editor.addContentWidget(this)

    this.disposes.push({
      dispose: () => {
        editor.deltaDecorations(this.decorations, [])
      }
    })
  }

  static globalStyleEl: HTMLStyleElement | null = null
  static addGlobalCss() {
    if (MyWidget.globalStyleEl) return
    const style = MyWidget.globalStyleEl = document.createElement("style")
    style.innerHTML = `
      .share-monaco-widget-cursor {
        border-left: 2px solid;
        position: relative;
        width: 3px;
        box-sizing: border-box;
      }
      .share-monaco-widget-label {
        position: absolute;
        left: -2px;
        border-radius: 3px;
        padding: 0 3px 0;
        font-family: 'Consolas', 'Courier New', Courier, monospace;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        transition: opacity .2s ease;
        opacity: 0;
        pointer-events: none;
      }
      .share-monaco-widget-label.show {
        opacity: 0.95;
      }`
    document.head.appendChild(style)
  }

  static removeGlobalCss() {
    if (MyWidget.globalStyleEl)
      document.head.removeChild(MyWidget.globalStyleEl)
    MyWidget.globalStyleEl = null
  }

  getId() {
    return "my-overlay-" + this.id
  }

  getDomNode() {
    return this.el
  }

  getPosition() {
    return {
      position: this.selection.getPosition(),
      range: null,
      preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
    }
  }

  setColor(color: string) {
    if (this.color === color) return
    this.color = color
    this.styleEl.innerHTML = `
      .${this.decorationClassName} {
        border-radius: 3px;
        opacity: 0.12;
        background-color: ${color};
      }`
    this.el.style.borderLeftColor = color
    this.labelEl.style.backgroundColor = color
  }

  setLabel(label: string) {
    if (this.label === label) return
    this.label = this.labelEl.innerText = label
  }

  setSelection(selection: ISelection) {
    this.selection = monaco.Selection.liftSelection(selection)
    this.decorations = this.editor.deltaDecorations(this.decorations, [
      {
        range: this.selection,
        options: {
          className: this.decorationClassName,
        },
      },
      {
        range: monaco.Range.fromPositions(this.selection.getPosition()),
        options: {
          overviewRuler: {
            position: monaco.editor.OverviewRulerLane.Right,
            color: this.color
          }
        }
      }
    ])
    this.editor.layoutContentWidget(this)
    this.updateLabel()
  }

  updateLabel() {
    this.el.style.height = this.lineHeight + "px"
    if (this.selection.positionLineNumber <= 1) {
      this.labelEl.style.top = this.lineHeight + "px"
      this.labelEl.style.bottom = "auto"
    } else {
      this.labelEl.style.top = "auto"
      this.labelEl.style.bottom = this.lineHeight + "px"
    }
  }

  dispose() {
    this.editor.removeContentWidget(this)
    this.disposes.forEach(x => x.dispose())
    this.disposes.length = 0
  }
}
