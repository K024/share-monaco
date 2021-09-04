import "./style.css"
import jsx from "./jsx"

const randId = () => Math.random().toString(36).substr(2).toUpperCase()
const room = new URL(window.location.href).searchParams.get("room")

const app = document.getElementById("app")!

const tip =
  <p className="tip">
    <b>WARN</b>: No data is persisted and there's NO guarantee on data secrecy
    <br />
    since everyone could connect to <a href="https://smee.io" target="_blank">smee.io</a> endpoint.
    <br />
    For more information, please visit <a href="https://github.com/K024/share-monaco" target="_blank">K024/share-monaco</a>.
  </p>

if (!room) {
  const input: HTMLInputElement =
    <input type="text" name="room" placeholder="Room Id" autocomplete="off" />
  const home: HTMLElement =
    <div className="home">
      <h1 className="title">Share Monaco</h1>
      <form>
        {input}
        <button type="button" onclick={() => input.value = randId()}>Random</button>
        <button type="submit">Go</button>
      </form>
      {tip}
    </div>
  app.appendChild(home)
} else {
  const clientId = randId()
  const container: HTMLDivElement = <div className="container" />
  app.appendChild(container)
  const loading: HTMLDivElement = <div className="lds-facebook"><div /><div /><div /></div>
  container.appendChild(loading)
  document.title = `Room ${room} - Share Monaco`
  import("./editor").then(editor => {
    container.removeChild(loading)
    return editor.start(clientId, room, container)
  }).then(() => {
    container.appendChild(tip)
  })
}
