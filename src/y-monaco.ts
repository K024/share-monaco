// https://github.com/yjs/y-monaco
// The MIT License (MIT)
// Copyright (c) 2019 Kevin Jahns <kevin.jahns@protonmail.com>.
// see https://github.com/yjs/y-monaco/blob/master/LICENSE

import * as Y from "yjs"
import { monaco } from "./monaco"
import { editor, IDisposable, SelectionDirection } from "monaco-editor"
import { createMutex } from "./utils"
import { Awareness } from "y-protocols/awareness"
import MyWidget from "./my-widget"

class RelativeSelection {
  constructor(
    public start: Y.RelativePosition,
    public end: Y.RelativePosition,
    public direction: SelectionDirection) {
  }
}

function createRelativeSelection(editor: editor.ICodeEditor, type: Y.Text) {
  const selection = editor.getSelection()
  if (selection !== null) {
    const monacoModel = editor.getModel()!
    const startPos = selection.getStartPosition()
    const endPos = selection.getEndPosition()
    const start = Y.createRelativePositionFromTypeIndex(type, monacoModel.getOffsetAt(startPos))
    const end = Y.createRelativePositionFromTypeIndex(type, monacoModel.getOffsetAt(endPos))
    return new RelativeSelection(start, end, selection.getDirection())
  }
  return null
}

function createMonacoSelection(editor: editor.ICodeEditor, type: Y.Text, relSel: RelativeSelection) {
  const start = Y.createAbsolutePositionFromRelativePosition(relSel.start, type.doc!)
  const end = Y.createAbsolutePositionFromRelativePosition(relSel.end, type.doc!)
  if (start !== null && end !== null && start.type === type && end.type === type) {
    const monacoModel = editor.getModel()!
    const startPos = monacoModel.getPositionAt(start.index)
    const endPos = monacoModel.getPositionAt(end.index)
    return monaco.Selection.createWithDirection(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column, relSel.direction)
  }
  return null
}

export default class MonacoBinding {

  disposes: IDisposable[] = []

  constructor(
    public ytext: Y.Text,
    public editor: editor.ICodeEditor,
    public awareness?: Awareness) {

    const doc = ytext.doc!
    const monacoModel = editor.getModel()!
    const mux = createMutex()

    let savedSelection: RelativeSelection | undefined

    const beforeAllTransactions = () => {
      mux(() => {
        const rsel = createRelativeSelection(editor, ytext)
        if (rsel !== null) {
          savedSelection = rsel
        }
      })
    }
    doc.on("beforeAllTransactions", beforeAllTransactions)
    this.disposes.push({
      dispose() {
        doc.off("beforeAllTransactions", beforeAllTransactions)
      }
    })

    const ytextChangeListener = (event: Y.YTextEvent) => {
      mux(() => {
        let index = 0
        event.delta.forEach(op => {
          monacoModel
          if (op.retain !== undefined) {
            index += op.retain
          } else if (op.insert !== undefined) {
            const pos = monacoModel.getPositionAt(index)
            const range = new monaco.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
            monacoModel.applyEdits([{ range, text: op.insert as string }])
            // monacoModel.pushEditOperations([], [{ range, text: op.insert as string }], () => null)
            index += op.insert.length
          } else if (op.delete !== undefined) {
            const pos = monacoModel.getPositionAt(index)
            const endPos = monacoModel.getPositionAt(index + op.delete)
            const range = new monaco.Selection(pos.lineNumber, pos.column, endPos.lineNumber, endPos.column)
            monacoModel.applyEdits([{ range, text: "" }])
            // monacoModel.pushEditOperations([], [{ range, text: "" }], () => null)
          } else {
            throw new Error("Unexpected delta operation")
          }
        })
        monacoModel.pushStackElement()
        if (savedSelection) {
          const sel = createMonacoSelection(editor, ytext, savedSelection)
          if (sel) editor.setSelection(sel)
        }
        renderDecorators()
      })
    }
    ytext.observe(ytextChangeListener)
    this.disposes.push({
      dispose() {
        ytext.unobserve(ytextChangeListener)
      }
    })

    monacoModel.setValue(ytext.toString())

    this.disposes.push(monacoModel.onDidChangeContent(event => {
      // apply changes from right to left
      mux(() => {
        doc.transact(() => {
          event.changes
            .sort((a, b) => b.rangeOffset - a.rangeOffset)
            .forEach(change => {
              ytext.delete(change.rangeOffset, change.rangeLength)
              ytext.insert(change.rangeOffset, change.text)
            })
        }, this)
      })
    }))

    const decorators = new Map<number, MyWidget>()
    this.disposes.push({
      dispose() {
        decorators.forEach(x => x.dispose())
      }
    })
    function renderDecorators() {
      if (awareness) {
        const states = awareness.getStates()
        states.forEach((state, clientID) => {
          if (clientID === awareness.clientID) return
          let widget = decorators.get(clientID)
          if (!widget) {
            widget = new MyWidget(editor, state.name || "" + clientID)
            decorators.set(clientID, widget)
          }
          if (state.name)
            widget.setLabel(state.name)
          if (state.color)
            widget.setColor(state.color)
          if (state.selection) {
            const selection = createMonacoSelection(editor, ytext, state.selection)
            if (selection) widget.setSelection(selection)
          }
        })
        decorators.forEach((widget, clientId) => {
          if (!states.has(clientId)) {
            widget.dispose()
            decorators.delete(clientId)
          }
        })
      }
    }

    if (awareness) {
      this.disposes.push(editor.onDidChangeCursorSelection(() => {
        awareness.setLocalStateField("selection", createRelativeSelection(editor, ytext))
      }))
      awareness.on("change", renderDecorators)
      this.disposes.push({
        dispose() {
          awareness.off("change", renderDecorators)
        }
      })
    }

    monacoModel.onWillDispose(() => {
      this.dispose()
    })
  }

  onTextUpdated?: () => void

  dispose() {
    this.disposes.forEach(x => x.dispose())
    this.disposes.length = 0
  }
}
