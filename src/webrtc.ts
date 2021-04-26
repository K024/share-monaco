import { fromByteArray, toByteArray } from "base64-js"
import * as Y from "yjs"
import * as  yawareness from "y-protocols/awareness"
import { post } from "./utils"

// https://gist.github.com/mondain/b0ec1cf5f60ae726202e#gistcomment-3238034
import serverlist from "./stun.txt?raw"

let smeeUrl = import.meta.env["VITE_SMEE_IO_URL"]
if (!smeeUrl || typeof smeeUrl !== "string") smeeUrl = "https://smee.io"
if (smeeUrl.endsWith("/")) smeeUrl = smeeUrl.substr(0, smeeUrl.length - 1)

const iceServers = serverlist.split(/\r?\n/g).filter(Boolean).map(x => ({ urls: `stun:${x}` }))

function randServers(len = 20) {
  const randServer = () => iceServers[(iceServers.length * Math.random()) | 0]
  return Array(len).fill(undefined).map(randServer)
}

function setupChannel(channel: RTCDataChannel, doc: Y.Doc, awareness: yawareness.Awareness, remoteId: string) {
  function send(type: string, data?: Uint8Array) {
    if (channel.readyState === "open")
      channel.send(JSON.stringify({ type, data: data && fromByteArray(data) }))
  }
  channel.onmessage = e => {
    const { type, data } = JSON.parse(e.data)
    const databytes = data && toByteArray(data)
    if (type === "awareness")
      yawareness.applyAwarenessUpdate(awareness, databytes, "remote")
    else if (type === "update")
      Y.applyUpdate(doc, databytes, "remote")
    else if (type === "sync") {
      const update = Y.encodeStateAsUpdate(doc, databytes)
      send("update", update)
      const aware = yawareness.encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])
      send("awareness", aware)
    }
  }
  function docupdate(update: Uint8Array, origin: any) {
    if (origin !== "remote")
      send("update", update)
  }
  doc.on("update", docupdate)
  function awupdate(_: any, origin: any) {
    if (origin === "local") {
      const update = yawareness.encodeAwarenessUpdate(awareness, [awareness.clientID])
      send("awareness", update)
    }
  }
  awareness.on("update", awupdate)
  channel.onerror = channel.onclose = () => {
    doc.off("update", docupdate)
    awareness.off("update", awupdate)
    yawareness.removeAwarenessStates(awareness, [...awareness.getStates()]
      .filter(([_, v]) => v.clientId === remoteId).map(x => x[0]), "remote")
  }
  function sync() {
    if (channel.readyState !== "open") return
    send("sync", Y.encodeStateVector(doc))
    setTimeout(sync, Math.random() * 10_000 + 5_000)
  }
  sync()
}

export function setupWebrtc(
  roomId: string,
  clientId: string,
  doc: Y.Doc,
  awareness: yawareness.Awareness) {

  const roomUrl = smeeUrl + "/share-monaco-room-" + roomId
  const replyUrl = smeeUrl + "/share-monaco-reply-" + clientId
  const room = new EventSource(roomUrl)
  const reply = new EventSource(replyUrl)

  const connections = new Map<string, RTCPeerConnection>()


  room.onmessage = e => {
    const { clientId: remoteId, replyUrl: remoteUrl } = JSON.parse(e.data).body
    if (remoteId === clientId) return

    // step 1, local
    if (connections.has(remoteId)) return
    console.log("step 1, remote:", remoteId)
    const conn = new RTCPeerConnection({ iceServers: randServers() })
    conn.onicecandidate = e => {
      if (e.candidate)
        post(remoteUrl, { clientId, ice: e.candidate.toJSON(), replyUrl })
    }

    // important: create channel on local (or connection won't initiate)
    const channel = conn.createDataChannel("message")
    channel.onopen = () => {
      console.log("channel opened, remote:", remoteId)
      setupChannel(channel, doc, awareness, remoteId)
    }

    conn.createOffer().then(offer => {
      post(remoteUrl, { clientId, offer, replyUrl })
      conn.setLocalDescription(offer)
    })

    connections.set(remoteId, conn)
    Object.assign(window, { conn })

    conn.onconnectionstatechange = () => {
      if (["closed", "disconnected", "failed"].includes(conn.connectionState)) {
        console.log(conn.connectionState, "from remote:", remoteId)
        connections.delete(remoteId)
      } else if (conn.connectionState === "connected") {
        console.log("connected from remote:", remoteId)
      }
    }
  }

  const pendingIce = new Map<string, any[]>()

  reply.onmessage = e => {
    const { clientId: remoteId, replyUrl: remoteUrl, offer, ice, answer } = JSON.parse(e.data).body
    if (remoteId === clientId) return

    if (offer) {
      // step 2, remote
      if (connections.has(remoteId)) return
      console.log("step 2, remote:", remoteId)
      const conn = new RTCPeerConnection({ iceServers: randServers() })
      conn.onicecandidate = e => {
        if (e.candidate)
          post(remoteUrl, { clientId, ice: e.candidate.toJSON(), replyUrl })
      }
      conn.setRemoteDescription(offer)
        .then(() => conn.createAnswer())
        .then(answer => {
          conn.setLocalDescription(answer)
          post(remoteUrl, { clientId, answer, replyUrl })
        })

      connections.set(remoteId, conn)
      Object.assign(window, { conn })

      // wait channel on remote
      conn.ondatachannel = e => {
        console.log("got channel from remote:", remoteId)
        e.channel.onopen = () => {
          console.log("channel opened, remote:", remoteId)
          setupChannel(e.channel, doc, awareness, remoteId)
        }
      }

      conn.onconnectionstatechange = () => {
        if (["closed", "disconnected", "failed"].includes(conn.connectionState)) {
          console.log(conn.connectionState, "from remote:", remoteId)
          connections.delete(remoteId)
          pendingIce.delete(remoteId)
        } else if (conn.connectionState === "connected") {
          console.log("connected from remote:", remoteId)
        }
      }
      const list = pendingIce.get(remoteId) || []
      if (list.length) {
        console.log("flush pending ices", list.length)
        list.forEach(ice => conn.addIceCandidate(ice))
        pendingIce.delete(remoteId)
      }
    }

    if (ice) {
      console.log("ice from remote:", remoteId)
      const conn = connections.get(remoteId)
      if (conn) {
        conn.addIceCandidate(ice)
      } else {
        const list = pendingIce.get(remoteId) || []
        pendingIce.set(remoteId, [...list, ice])
        setTimeout(() => pendingIce.delete(remoteId), 20_000)
      }
    }

    if (answer) {
      // step 3, local
      const conn = connections.get(remoteId)
      if (!conn) return
      console.log("step 3, remote:", remoteId)
      conn.setRemoteDescription(answer)
      // all settled
    }
  }

  function broadcast() {
    post(roomUrl, { clientId, replyUrl })
    setTimeout(broadcast, Math.random() * 20_000 + 10_000)
  }
  broadcast()
}
